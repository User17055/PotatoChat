<?php
// API do Potato Chat. No lugar do Socket.IO, o navegador usa HTTP:
//   welcome → diz à tela de login se ainda dá para criar conta;
//   login   → entra (ou cria a conta, nos dois primeiros acessos);
//   avatar  → foto de perfil;
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

function connect(array $input): array
{
    return transaction(function () use ($input) {
        $session = authenticate($input);
        $conn = conn_id($input);
        $name = $session['name'];
        sweep();
        $others = array_filter(people(), fn($person) => $person !== $name);
        if (count($others) > 1) return ['roomFull' => true];

        attach($conn, $name, $input);
        $result = [
            'me' => $name,
            'cursor' => last_seq(),
            'wait' => poll_wait(),
            'history' => history($name),
            'presence' => presence(),
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
    return transaction(function () use ($input, $list) {
        $session = authenticate($input);
        $conn = conn_id($input);
        // O aviso de fim de chamada enviado ao fechar a aba não deve recriar a conexão.
        $current = find_client($conn);
        $attached = $current || ($input['attach'] ?? true) !== false;
        if ($attached) attach($conn, $session['name'], $input);
        $client = $attached ? find_client($conn)['client'] : 'web';
        $me = ['conn' => $conn, 'name' => $session['name'], 'client' => $client];
        $results = [];
        foreach ($list as $op) {
            $event = is_array($op) ? str($op['event'] ?? '') : '';
            $results[] = $attached || $event === 'call-ended' ? act($me, $event, $op['data'] ?? null) : null;
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
    $reply = function (array $events, ?array $history = null) use (&$cursor, $wait): array {
        $result = ['events' => $events, 'cursor' => $cursor, 'presence' => presence(), 'wait' => $wait];
        return $history ? $result + ['history' => $history] : $result;
    };

    // Primeiro: sinal de vida, limpeza de conexões mortas e o que já estiver esperando.
    $first = transaction(function () use ($input, $conn, &$cursor, $collect, $reply) {
        $session = authenticate($input);
        sweep();
        $isNew = attach($conn, $session['name'], $input);
        $last = last_seq();
        $oldest = first_seq();
        // Conexão esquecida pelo servidor ou eventos perdidos: manda o histórico de novo.
        if ($isNew || $cursor > $last || ($cursor < $last && $oldest > $cursor + 1)) {
            $cursor = $last;
            return $reply([], history($session['name']));
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
            respond(200, welcome());
        case 'avatar':
            avatar(str($_GET['k'] ?? ''));
        case 'login':
            respond(200, login(input(), (string) ($_SERVER['REMOTE_ADDR'] ?? '?')));
        case 'connect':
            respond(200, connect(input()));
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
