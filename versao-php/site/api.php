<?php
// API do Potato Chat. No lugar do Socket.IO, o navegador usa HTTP:
//   welcome → diz à tela de login se ainda dá para criar conta (e, com ?convite=, quem convidou);
//   login   → entra (ou cria a conta: nos dois primeiros acessos, ou com um convite);
//   avatar  → foto de perfil;
//   wallpaper → papel de parede da conversa;
//   upload  → recebe a foto ou o arquivo de uma mensagem (a mensagem vai depois, pelo ops);
//   file    → entrega a foto ou o arquivo de uma mensagem;
//   watch-upload / watch-file → recebe (em pedaços) e entrega o vídeo do aparelho da Watch Party;
//   transcribe → transcreve uma mensagem de voz (se a chave estiver no config.php);
//   connect → entra na sala e recebe o histórico;
//   ops     → envia ações (mensagem, reação, leitura, digitando, sinalização da chamada…);
//   poll    → espera por novidades (long polling) e recebe os eventos da conversa.

declare(strict_types=1);

ini_set('display_errors', '0');
require __DIR__ . '/lib/potato.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

function respond(int $status, $body): void
{
    http_response_code($status);
    echo encode($body);
    exit;
}

function input(): array
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') throw new HttpError(405, 'Use POST.');
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > MAX_BODY) throw new HttpError(413, 'Dados grandes demais.');
    $raw = (string) file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
    if (strlen($raw) > MAX_BODY) throw new HttpError(413, 'Dados grandes demais.');
    $data = json_decode($raw, true);
    if (!is_array($data)) throw new HttpError(400, 'Requisição inválida.');
    return $data;
}

function health(): array
{
    return transaction(function () {
        sweep();
        return ['ok' => true, 'people' => count(people())];
    });
}

// A conversa que o navegador está vendo (room), ou a padrão (veja pick_room).
function input_room(string $name, array $input): ?array
{
    return pick_room($name, str($input['room'] ?? '')) ?? pick_room($name, '');
}

function connect(array $input): array
{
    return transaction(function () use ($input) {
        $session = authenticate($input);
        $conn = conn_id($input);
        $name = $session['name'];
        sweep();
        attach($conn, $name, $input);
        $result = [
            'me' => $name,
            'cursor' => last_seq(),
            'wait' => poll_wait(),
            'history' => history($name, input_room($name, $input)),
            'presence' => presence($name),
        ];
        // Renova a sessão de quem usa sempre: ninguém precisa digitar a senha de novo.
        if ($session['expiresAt'] - now_ms() < (SESSION_DAYS - 30) * DAY_MS) {
            $result['session'] = ['token' => issue_token($name), 'name' => $name];
        }
        return $result;
    });
}

function ops(array $input): array
{
    $list = $input['ops'] ?? null;
    if (!is_array($list) || count($list) > 50) throw new HttpError(400, 'Ações inválidas.');
    // O catálogo da Watch Party só lê o YouTube (leva um ou dois segundos): fica fora da trava, para não segurar o chat.
    $data = $list[0]['data'] ?? null;
    if (count($list) === 1 && str($list[0]['event'] ?? '') === 'watch' && is_array($data) && str($data['op'] ?? '') === 'search') {
        authenticate($input);
        return ['results' => [watch_catalog($data)]];
    }
    // A pesquisa na conversa só lê: também fica fora da trava.
    if (count($list) === 1 && str($list[0]['event'] ?? '') === 'search' && is_array($data)) {
        $session = authenticate($input);
        $room = pick_room($session['name'], str($list[0]['room'] ?? ''));
        return ['results' => [search_messages($room['id'] ?? '', str($data['query'] ?? ''), str($data['before'] ?? ''))]];
    }
    return transaction(function () use ($input, $list) {
        $session = authenticate($input);
        $conn = conn_id($input);
        // O aviso de saída da chamada ao fechar a aba não deve recriar a conexão.
        $current = find_client($conn);
        $attached = $current || ($input['attach'] ?? true) !== false;
        if ($attached) attach($conn, $session['name'], $input);
        $client = $attached ? find_client($conn)['client'] : 'web';
        $results = [];
        foreach ($list as $op) {
            $event = is_array($op) ? str($op['event'] ?? '') : '';
            // Cada ação vale na conversa que estava aberta quando foi feita (o navegador manda junto).
            $me = ['conn' => $conn, 'name' => $session['name'], 'client' => $client, 'room' => pick_room($session['name'], is_array($op) ? str($op['room'] ?? '') : '')];
            $results[] = $attached || in_array($event, ['call-ended', 'call-leave'], true) ? act($me, $event, $op['data'] ?? null) : null;
        }
        return ['results' => $results];
    });
}

function poll(array $input): array
{
    $wait = poll_wait();
    @set_time_limit($wait + 20);
    $cursor = max(0, (int) ($input['cursor'] ?? 0));
    $only = is_array($input['only'] ?? null) ? array_map('str', $input['only']) : null;
    $conn = conn_id($input);

    $collect = function () use (&$cursor, $conn, $only): array {
        $client = find_client($conn);
        $rows = query('SELECT * FROM ' . t('events') . ' WHERE seq > ? ORDER BY seq LIMIT 500', [$cursor])->fetchAll();
        $events = [];
        foreach ($rows as $row) {
            $cursor = (int) $row['seq'];
            if (!$client || !event_for($row, $conn, $client)) continue;
            if ($only !== null && !in_array($row['type'], $only, true)) continue;
            $events[] = ['type' => $row['type'], 'data' => $row['data'] === null ? null : json_decode($row['data'])];
        }
        return $events;
    };
    $name = '';
    $reply = function (array $events, ?array $history = null) use (&$cursor, &$name, $wait): array {
        $result = ['events' => $events, 'cursor' => $cursor, 'presence' => presence($name), 'wait' => $wait];
        return $history ? $result + ['history' => $history] : $result;
    };

    // Primeiro: sinal de vida, limpeza de conexões mortas e o que já estiver esperando.
    $first = transaction(function () use ($input, $conn, &$cursor, &$name, $collect, $reply) {
        $session = authenticate($input);
        $name = $session['name'];
        sweep();
        $isNew = attach($conn, $name, $input);
        // Este aparelho está buscando novidades: o que mandaram para esta pessoa chegou (✓✓ cinza para quem mandou).
        mark_delivered($name);
        $last = last_seq();
        $oldest = first_seq();
        // Conexão esquecida pelo servidor ou eventos perdidos: manda o histórico de novo.
        if ($isNew || $cursor > $last || ($cursor < $last && $oldest > $cursor + 1)) {
            $cursor = $last;
            return $reply([], history($name, input_room($name, $input)));
        }
        $events = $collect();
        return $events ? $reply($events) : null;
    });
    if ($first) return $first;

    $deadline = microtime(true) + $wait;
    $swept = microtime(true);
    while (microtime(true) < $deadline) {
        usleep(300000);
        if (microtime(true) - $swept >= 5) {
            $swept = microtime(true);
            transaction('sweep');
        }
        if (last_seq() <= $cursor) continue;
        $events = $collect();
        if ($events) return $reply($events);
    }
    return $reply($collect());
}

// Foto de perfil. O endereço só chega a quem está logado e muda a cada troca: pode ficar no cache.
function avatar(string $key): void
{
    $photo = find_avatar($key);
    if (!$photo) throw new HttpError(404, 'Foto não encontrada.');
    header('Content-Type: ' . $photo['type']);
    header('Content-Length: ' . strlen($photo['data']));
    header('Cache-Control: private, max-age=31536000, immutable');
    echo $photo['data'];
    exit;
}

// Foto ou arquivo de uma mensagem: o corpo da requisição é o próprio arquivo; a sessão e o nome vão nos cabeçalhos.
// Depois o navegador manda a mensagem com a chave devolvida aqui.
function upload(): array
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') throw new HttpError(405, 'Use POST.');
    return transaction(function () {
        $session = authenticate(['token' => $_SERVER['HTTP_X_POTATO_TOKEN'] ?? '']);
        $max = file_max();
        $length = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
        if ($length > $max) throw new HttpError(413, 'Arquivo grande demais (máximo de ' . round($max / 1048576, 1) . ' MB).');
        $raw = (string) file_get_contents('php://input', false, null, 0, $max + 1);
        // Corpo vazio com tamanho declarado: o PHP descartou (passou do post_max_size da hospedagem).
        if ($raw === '' || strlen($raw) !== $length) throw new HttpError($length > 0 ? 413 : 400, $length > 0 ? 'Arquivo grande demais para o servidor.' : 'Arquivo vazio.');
        return save_file($session['name'], rawurldecode((string) ($_SERVER['HTTP_X_POTATO_NAME'] ?? '')), $raw);
    });
}

// Watch Party: um pedaço do vídeo do aparelho. O corpo é o pedaço; a sessão, a conversa, o nome, o tamanho total, a
// chave (vazia no primeiro) e onde o pedaço começa vão nos cabeçalhos. Fora da trava do banco: um pedaço leva segundos
// para chegar e não pode segurar o chat. Pedaço repetido ou fora de ordem não grava: a resposta diz quanto já chegou
// (received) e o navegador continua dali.
function watch_upload(): array
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') throw new HttpError(405, 'Use POST.');
    @set_time_limit(600);
    $name = authenticate(['token' => $_SERVER['HTTP_X_POTATO_TOKEN'] ?? ''])['name'];
    $length = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    $offset = (int) ($_SERVER['HTTP_X_POTATO_OFFSET'] ?? 0);
    $key = str($_SERVER['HTTP_X_POTATO_KEY'] ?? '');
    if ($length < 1 || $length > watch_chunk()) throw new HttpError(413, 'Pedaço grande demais para o servidor.');
    if ($key === '') {
        $room = pick_room($name, str($_SERVER['HTTP_X_POTATO_ROOM'] ?? ''));
        $size = (int) ($_SERVER['HTTP_X_POTATO_SIZE'] ?? 0);
        if (!$room) return ['ok' => false, 'error' => 'Escolha uma conversa.'];
        if ($size > WATCH_FILE_MAX) return ['ok' => false, 'error' => 'Vídeo grande demais (máximo de ' . round(WATCH_FILE_MAX / 1073741824) . ' GB).'];
        if ($offset !== 0 || $size < $length) throw new HttpError(400, 'Envio inválido.');
        prune_watch_files($room['id']);
        if (!is_dir(WATCH_DIR) && !@mkdir(WATCH_DIR, 0755, true)) throw new HttpError(500, 'O servidor não deixou criar a pasta filmes.');
        // Ninguém abre a pasta direto: o vídeo só sai por api.php?action=watch-file.
        if (!is_file(WATCH_DIR . '/.htaccess')) {
            @file_put_contents(WATCH_DIR . '/.htaccess', "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
            @file_put_contents(WATCH_DIR . '/index.html', '');
        }
        $file = ['key' => bin2hex(random_bytes(16)), 'owner' => $name, 'room' => $room['id'], 'name' => clean_file_name(rawurldecode((string) ($_SERVER['HTTP_X_POTATO_NAME'] ?? ''))), 'size' => $size, 'type' => '', 'at' => now_ms()];
        save_watch_file($file);
    } else {
        $file = find_watch_file($key);
        if (!$file || !same_name($file['owner'], $name)) return ['ok' => false, 'error' => 'Esse envio não está mais no servidor. Escolha o vídeo de novo.'];
    }
    $path = watch_file_path($file['key']);
    // Um handle só, para gravar e ler (no Windows, a trava do flock vale até para outro handle do mesmo PHP).
    $out = @fopen($path, 'c+b');
    if (!$out) throw new HttpError(500, 'O servidor não deixou gravar o vídeo.');
    try {
        flock($out, LOCK_EX);
        fseek($out, 0, SEEK_END);
        $received = (int) ftell($out);
        if ($offset !== $received || $received + $length > $file['size']) return ['ok' => true, 'key' => $file['key'], 'received' => $received];
        $in = fopen('php://input', 'rb');
        $copied = (int) stream_copy_to_stream($in, $out, $length);
        fflush($out);
        // Chegou pela metade (a conexão caiu) ou o disco encheu: o pedaço sai e o navegador tenta de novo.
        if ($copied !== $length) {
            ftruncate($out, $received);
            return ['ok' => false, 'key' => $file['key'], 'received' => $received, 'error' => 'O servidor não conseguiu gravar o vídeo (pode estar sem espaço).'];
        }
        if ($received === 0) {
            // Pelos primeiros bytes (o tipo informado pelo navegador não vale): só vídeo ou som passam.
            fseek($out, 0);
            $kind = sniff_file((string) fread($out, $length));
            if (!in_array($kind['kind'], ['video', 'audio'], true)) {
                fclose($out);
                $out = null;
                drop_watch_file($file['key']);
                return ['ok' => false, 'error' => 'Esse arquivo não é um vídeo que o navegador toca (use MP4, WebM ou MOV).'];
            }
            $file['type'] = $kind['type'];
        }
        $file['at'] = now_ms();
        save_watch_file($file);
        return ['ok' => true, 'key' => $file['key'], 'received' => $received + $length];
    } finally {
        if ($out) fclose($out);
    }
}

// Transcrição de uma mensagem de voz. Fora do ops: a API de transcrição leva alguns segundos e não pode
// segurar a fila de ações (nem a trava do banco) enquanto responde.
function transcribe(array $input): array
{
    @set_time_limit(120);
    return transcribe_message(str($input['id'] ?? ''), authenticate($input)['name']);
}

// Entrega o arquivo. Imagem, vídeo e áudio abrem no chat; o resto sempre baixa.
// O endereço só chega a quem está logado e a chave é aleatória (igual à foto de perfil).
// Faixas de bytes (Range) deixam o vídeo avançar e tocar no iPhone.
function serve_file(string $key, bool $download): void
{
    $file = find_file($key);
    if (!$file) throw new HttpError(404, 'Arquivo não encontrado (talvez a mensagem tenha sido apagada).');
    $data = (string) $file['data'];
    $size = strlen($data);
    $inline = !$download && in_array($file['kind'], ['image', 'video', 'audio'], true);
    $ascii = preg_replace('/[^A-Za-z0-9._ -]/u', '_', $file['name']) ?? 'arquivo';
    header('Content-Type: ' . ($inline ? $file['type'] : 'application/octet-stream'));
    header('Content-Disposition: ' . ($inline ? 'inline' : 'attachment') . "; filename=\"$ascii\"; filename*=UTF-8''" . rawurlencode($file['name']));
    // Mesmo que alguém mande um HTML disfarçado, ele não roda dentro do site.
    header("Content-Security-Policy: default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
    header('Cache-Control: private, max-age=31536000, immutable');
    [$start, $end] = byte_range($size);
    echo substr($data, $start, $end - $start + 1);
    exit;
}

// A faixa de bytes pedida (Range), já com o 206, o Content-Range e o Content-Length; sem Range, o arquivo inteiro.
// cap: o máximo numa resposta (o navegador pede o resto sozinho).
function byte_range(int $size, int $cap = PHP_INT_MAX): array
{
    header('Accept-Ranges: bytes');
    $start = 0;
    $end = $size - 1;
    if (preg_match('/^bytes=(\d*)-(\d*)$/', (string) ($_SERVER['HTTP_RANGE'] ?? ''), $range) && ($range[1] !== '' || $range[2] !== '')) {
        if ($range[1] === '') {
            $start = max(0, $size - (int) $range[2]);
        } else {
            $start = (int) $range[1];
            if ($range[2] !== '') $end = min($end, (int) $range[2]);
        }
        if ($start > $end) {
            http_response_code(416);
            header("Content-Range: bytes */$size");
            exit;
        }
        $end = min($end, $start + $cap - 1);
        http_response_code(206);
        header("Content-Range: bytes $start-$end/$size");
    }
    header('Content-Length: ' . ($end - $start + 1));
    return [$start, $end];
}

// O vídeo do aparelho da Watch Party, do disco. Até 8 MB por resposta: ninguém prende o PHP da hospedagem por uma hora
// baixando o filme inteiro de uma vez. O endereço só chega a quem está na conversa e a chave é aleatória.
function serve_watch_file(string $key): void
{
    $file = find_watch_file($key);
    $path = $file ? watch_file_path($file['key']) : '';
    if (!$file || !is_file($path) || filesize($path) < $file['size']) throw new HttpError(404, 'Esse vídeo não está mais no servidor.');
    header('Content-Type: ' . ($file['type'] ?: 'video/mp4'));
    header("Content-Security-Policy: default-src 'none'; sandbox");
    header('Cache-Control: private, max-age=86400');
    [$start, $end] = byte_range((int) $file['size'], WATCH_CHUNK);
    @set_time_limit(0);
    $in = fopen($path, 'rb');
    fseek($in, $start);
    for ($left = $end - $start + 1; $left > 0 && !connection_aborted(); $left -= strlen($piece)) {
        $piece = (string) fread($in, min(1048576, $left));
        if ($piece === '') break;
        echo $piece;
        flush();
    }
    exit;
}

// Papel de parede (só quem escolheu recebe o endereço, que muda a cada foto).
function wallpaper(string $key): void
{
    $photo = find_wallpaper($key);
    if (!$photo) throw new HttpError(404, 'Papel de parede não encontrado.');
    header('Content-Type: ' . $photo['type']);
    header('Content-Length: ' . strlen($photo['data']));
    header('Cache-Control: private, max-age=31536000, immutable');
    echo $photo['data'];
    exit;
}

// Aviso de saída (aba fechada ou recarregada), enviado com navigator.sendBeacon.
function disconnect(array $input): void
{
    transaction(function () use ($input) {
        $session = verify_token($input['token'] ?? null);
        $conn = conn_id($input);
        $client = find_client($conn);
        if ($session && (!$client || same_name($client['name'], $session['name']))) drop($conn, true);
    });
}

try {
    switch ($_GET['action'] ?? '') {
        case 'health':
            respond(200, health());
        case 'welcome':
            respond(200, welcome(str($_GET['convite'] ?? '')));
        case 'avatar':
            avatar(str($_GET['k'] ?? ''));
        case 'wallpaper':
            wallpaper(str($_GET['k'] ?? ''));
        case 'file':
            serve_file(str($_GET['k'] ?? ''), isset($_GET['dl']));
        case 'upload':
            respond(200, upload());
        case 'watch-upload':
            respond(200, watch_upload());
        case 'watch-file':
            serve_watch_file(str($_GET['k'] ?? ''));
        case 'transcribe':
            respond(200, transcribe(input()));
        case 'login':
            respond(200, login(input(), (string) ($_SERVER['REMOTE_ADDR'] ?? '?')));
        case 'connect':
            respond(200, connect(input()));
        // Widgets do Android (tela inicial): o mesmo estado da seção Nós, com as fotos de perfil.
        case 'widget':
            $session = authenticate(input());
            if (!in_array($session['name'], users(), true)) throw new HttpError(403, 'Só do casal.');
            $avatars = [];
            foreach (users() as $name) $avatars[$name] = avatar_url(find_account($name)['avatar_key'] ?? null);
            respond(200, ['ok' => true, 'me' => $session['name'], 'avatars' => $avatars] + nos_state());
        case 'rtc-config':
            $session = authenticate(input());
            respond(200, rtc_config($session['name']));
        case 'ops':
            respond(200, ops(input()));
        case 'poll':
            respond(200, poll(input()));
        case 'disconnect':
            disconnect(input());
            respond(200, ['ok' => true]);
        default:
            throw new HttpError(404, 'Ação desconhecida.');
    }
} catch (HttpError $error) {
    respond($error->status, ['error' => $error->getMessage()]);
} catch (Throwable $error) {
    error_log('Potato Chat: ' . $error);
    respond(500, ['error' => 'Erro no servidor.']);
}
