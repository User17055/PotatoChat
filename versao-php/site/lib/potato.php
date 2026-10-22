<?php
// Núcleo do Potato Chat em PHP + MySQL: banco de dados, contas, sessão, presença e fila de eventos.
// As tabelas são criadas sozinhas no primeiro acesso (ou importe banco.sql pelo phpMyAdmin).

declare(strict_types=1);

const DAY_MS = 86400000;
const SESSION_DAYS = 365;
const MAX_USERS = 2;
const PAGE_SIZE = 60;
const REACTIONS = ['❤️', '😂', '😮', '😢', '👍', '🔥'];
const MAX_BODY = 1000000;
const EVENT_KEEP_MS = 120000;
const SCHEMA_VERSION = '7';
const MIN_PASSWORD = 4;
const AVATAR_MAX = 400000;
// GIF animado vai sem recortar (o recorte tiraria a animação): limite maior, que ainda cabe numa requisição.
const AVATAR_GIF_MAX = 700000;
// Fotos e arquivos das mensagens: até 10 MB (menos, se o PHP ou o MySQL da hospedagem não aguentarem; veja file_max).
const FILE_MAX = 10000000;
const FILE_UPLOADS_PER_10_MIN = 60;
// Mensagem de voz: até 1 hora (o chat já para a gravação em 15 minutos) e até 64 barras na forma de onda.
const VOICE_MAX = 3600;
const VOICE_PEAKS = 64;
// Papel de parede: foto reduzida no navegador (lado maior até 1600 px). Cabe numa requisição mesmo em base64.
const WALLPAPER_MAX = 650000;
const MUSIC_QUEUE_MAX = 50;
// Mesma lista do app.js (THEMES). O primeiro é o padrão.
const THEMES = ['escuro', 'preto', 'rosa', 'roxo', 'azul', 'verde', 'claro'];

final class HttpError extends RuntimeException
{
    public $status;

    public function __construct(int $status, string $message)
    {
        parent::__construct($message);
        $this->status = $status;
    }
}

// ---------- configuração ----------

function config(): array
{
    static $config = null;
    if ($config === null) {
        $file = getenv('POTATO_CONFIG') ?: dirname(__DIR__) . '/config.php';
        $custom = is_file($file) ? require $file : [];
        $custom = is_array($custom) ? $custom : [];
        $config = array_merge([
            'token_secret' => '',
            'poll_wait' => 20,
            'giphy_key' => '',
            // Bot de música: chave da YouTube Data API (opcional; sem ela, a busca pelo nome lê a página de resultados do YouTube).
            'youtube_key' => '',
            // Transcrição das mensagens de voz: qualquer API no formato da OpenAI (vazio = desligada; veja o LEIA-ME).
            'transcribe_key' => '',
            'transcribe_url' => 'https://api.groq.com/openai/v1/audio/transcriptions',
            'transcribe_model' => 'whisper-large-v3-turbo',
            // false = não consulta YouTube nem Spotify (só para os testes automáticos, que rodam sem internet).
            'music_lookup' => true,
        ], $custom);
        $config['db'] = array_merge([
            'host' => 'localhost',
            'port' => 3306,
            'name' => '',
            'user' => '',
            'pass' => '',
            'prefix' => 'potato_',
        ], (array) ($custom['db'] ?? []));
    }
    return $config;
}

// Quanto tempo uma consulta espera por novidades antes de responder vazia (long polling).
function poll_wait(): int
{
    $wait = max(0, min(25, (int) config()['poll_wait']));
    // O servidor embutido do PHP (php -S) atende uma requisição por vez: lá, consultas curtas.
    if (PHP_SAPI === 'cli-server' && (int) getenv('PHP_CLI_SERVER_WORKERS') < 2 && !getenv('POTATO_LONG_POLL')) return 0;
    return $wait;
}

// Depois desse tempo sem consultar, a conexão é considerada fechada.
function client_ttl_ms(): int
{
    $wait = poll_wait();
    return ($wait > 0 ? $wait + 30 : 90) * 1000;
}

// ---------- utilidades ----------

function now_ms(): int
{
    return (int) floor(microtime(true) * 1000);
}

function iso(?int $ms = null): string
{
    $ms = $ms ?? now_ms();
    return gmdate('Y-m-d\TH:i:s', intdiv($ms, 1000)) . sprintf('.%03dZ', $ms % 1000);
}

function uuid(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr(ord($bytes[6]) & 0x0f | 0x40);
    $bytes[8] = chr(ord($bytes[8]) & 0x3f | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
}

function str($value): string
{
    return is_scalar($value) ? (string) $value : '';
}

function text_length(string $text): int
{
    return function_exists('mb_strlen') ? mb_strlen($text, 'UTF-8') : (int) preg_match_all('/./su', $text);
}

function text_slice(string $text, int $length): string
{
    if (function_exists('mb_substr')) return mb_substr($text, 0, $length, 'UTF-8');
    preg_match('/^.{0,' . $length . '}/su', $text, $match);
    return $match[0] ?? '';
}

function text_trim(string $text): string
{
    return preg_replace('/^[\s\x{FEFF}\x{A0}]+|[\s\x{FEFF}\x{A0}]+$/u', '', $text) ?? trim($text);
}

// Compara nomes sem diferenciar maiúsculas nem acentos ("andré" = "Andre").
function fold(string $text): string
{
    if (class_exists('Normalizer')) {
        $text = preg_replace('/\p{Mn}+/u', '', (string) Normalizer::normalize($text, Normalizer::FORM_D)) ?? $text;
    } else {
        $text = strtr($text, [
            'á' => 'a', 'à' => 'a', 'â' => 'a', 'ã' => 'a', 'ä' => 'a', 'å' => 'a', 'Á' => 'a', 'À' => 'a', 'Â' => 'a', 'Ã' => 'a', 'Ä' => 'a', 'Å' => 'a',
            'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e', 'É' => 'e', 'È' => 'e', 'Ê' => 'e', 'Ë' => 'e',
            'í' => 'i', 'ì' => 'i', 'î' => 'i', 'ï' => 'i', 'Í' => 'i', 'Ì' => 'i', 'Î' => 'i', 'Ï' => 'i',
            'ó' => 'o', 'ò' => 'o', 'ô' => 'o', 'õ' => 'o', 'ö' => 'o', 'Ó' => 'o', 'Ò' => 'o', 'Ô' => 'o', 'Õ' => 'o', 'Ö' => 'o',
            'ú' => 'u', 'ù' => 'u', 'û' => 'u', 'ü' => 'u', 'Ú' => 'u', 'Ù' => 'u', 'Û' => 'u', 'Ü' => 'u',
            'ç' => 'c', 'Ç' => 'c', 'ñ' => 'n', 'Ñ' => 'n', 'ý' => 'y', 'ÿ' => 'y', 'Ý' => 'y',
        ]);
    }
    return function_exists('mb_strtolower') ? mb_strtolower($text, 'UTF-8') : strtolower($text);
}

function same_name(string $a, string $b): bool
{
    return fold($a) === fold($b);
}

function encode($value, bool $pretty = false): string
{
    $flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE;
    return (string) json_encode($value, $pretty ? $flags | JSON_PRETTY_PRINT : $flags);
}

// ---------- banco de dados ----------

// Nome da tabela com o prefixo da configuração (ex.: potato_messages).
function t(string $name): string
{
    $prefix = preg_replace('/[^A-Za-z0-9_]/', '', (string) config()['db']['prefix']);
    return '`' . $prefix . $name . '`';
}

function schema(): array
{
    $table = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    $ascii = 'CHARACTER SET ascii COLLATE ascii_bin';
    $exact = 'CHARACTER SET utf8mb4 COLLATE utf8mb4_bin';
    return [
        'CREATE TABLE IF NOT EXISTS ' . t('settings') . " (
  name VARCHAR(64) $ascii NOT NULL PRIMARY KEY,
  value TEXT NOT NULL
) $table",
        'CREATE TABLE IF NOT EXISTS ' . t('users') . " (
  position INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) $exact NOT NULL,
  created_at VARCHAR(32) $ascii NOT NULL,
  " . implode(",\n  ", user_columns()) . "
) $table",
        'CREATE TABLE IF NOT EXISTS ' . t('messages') . " (
  n BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  id CHAR(36) $ascii NOT NULL,
  client_id VARCHAR(64) $exact NULL,
  sender VARCHAR(64) $exact NOT NULL,
  text TEXT NOT NULL,
  created_at VARCHAR(32) $ascii NOT NULL,
  reply_to TEXT NULL,
  reactions TEXT NOT NULL,
  deleted TINYINT(1) NOT NULL DEFAULT 0,
  source VARCHAR(16) $ascii NOT NULL DEFAULT 'web',
  " . implode(",\n  ", message_columns()) . ",
  UNIQUE KEY message_id (id),
  KEY message_client (sender, client_id)
) $table",
        'CREATE TABLE IF NOT EXISTS ' . t('status') . " (
  name VARCHAR(64) $exact NOT NULL PRIMARY KEY,
  read_id CHAR(36) $ascii NULL,
  read_at VARCHAR(32) $ascii NULL,
  last_seen VARCHAR(32) $ascii NULL
) $table",
        'CREATE TABLE IF NOT EXISTS ' . t('clients') . " (
  conn VARCHAR(64) $ascii NOT NULL PRIMARY KEY,
  name VARCHAR(64) $exact NOT NULL,
  client VARCHAR(16) $ascii NOT NULL,
  visible TINYINT(1) NOT NULL DEFAULT 0,
  ping BIGINT NOT NULL,
  hits TEXT NOT NULL
) $table",
        'CREATE TABLE IF NOT EXISTS ' . t('events') . " (
  seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  at BIGINT NOT NULL,
  type VARCHAR(32) $ascii NOT NULL,
  data MEDIUMTEXT NULL,
  scope VARCHAR(8) $ascii NOT NULL,
  from_conn VARCHAR(64) $ascii NULL,
  from_name VARCHAR(64) $exact NULL,
  to_conn VARCHAR(64) $ascii NULL,
  KEY event_at (at)
) $table",
        'CREATE TABLE IF NOT EXISTS ' . t('gone') . " (
  conn VARCHAR(64) $ascii NOT NULL PRIMARY KEY,
  at BIGINT NOT NULL
) $table",
        'CREATE TABLE IF NOT EXISTS ' . t('logins') . " (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ip VARCHAR(45) $ascii NOT NULL,
  at BIGINT NOT NULL,
  KEY login_ip (ip, at)
) $table",
        // Fotos e arquivos das mensagens. message_id fica vazio entre o envio do arquivo e o da mensagem.
        'CREATE TABLE IF NOT EXISTS ' . t('files') . " (
  file_key CHAR(32) $ascii NOT NULL PRIMARY KEY,
  owner VARCHAR(64) $exact NOT NULL,
  name VARCHAR(200) NOT NULL,
  type VARCHAR(100) $ascii NOT NULL,
  kind VARCHAR(8) $ascii NOT NULL,
  size INT UNSIGNED NOT NULL,
  width INT UNSIGNED NULL,
  height INT UNSIGNED NULL,
  data MEDIUMBLOB NOT NULL,
  message_id CHAR(36) $ascii NULL,
  created_at BIGINT NOT NULL,
  KEY file_message (message_id, created_at),
  KEY file_owner (owner, created_at)
) $table",
        // Nosso cantinho: o dia de cada um, a agenda, os sonhos e metas, as cartinhas e as preferências de cada um
        // (um registro por coisa, com os detalhes em JSON; veja "nosso cantinho" mais abaixo).
        'CREATE TABLE IF NOT EXISTS ' . t('items') . " (
  n BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  id CHAR(36) $ascii NOT NULL,
  kind VARCHAR(16) $ascii NOT NULL,
  owner VARCHAR(64) $exact NOT NULL,
  day VARCHAR(10) $ascii NULL,
  data MEDIUMTEXT NOT NULL,
  created_at VARCHAR(32) $ascii NOT NULL,
  updated_at VARCHAR(32) $ascii NOT NULL,
  UNIQUE KEY item_id (id),
  KEY item_kind (kind, owner, day)
) $table",
    ];
}

// Senha (hash), foto e tema de cada conta. Ficam separadas para atualizar tabelas de versões anteriores.
function user_columns(): array
{
    $ascii = 'CHARACTER SET ascii COLLATE ascii_bin';
    return [
        'pass_hash' => "pass_hash VARCHAR(255) $ascii NULL",
        'avatar' => "avatar MEDIUMTEXT $ascii NULL",
        'avatar_type' => "avatar_type VARCHAR(16) $ascii NULL",
        'avatar_key' => "avatar_key CHAR(32) $ascii NULL",
        'theme' => "theme VARCHAR(16) $ascii NULL",
        'wallpaper' => "wallpaper MEDIUMTEXT $ascii NULL",
        'wallpaper_type' => "wallpaper_type VARCHAR(16) $ascii NULL",
        'wallpaper_key' => "wallpaper_key CHAR(32) $ascii NULL",
        'wallpaper_style' => "wallpaper_style VARCHAR(255) $ascii NULL",
    ];
}

// GIF da mensagem (JSON com endereço, largura, altura e título). Separada pelo mesmo motivo.
function message_columns(): array
{
    return [
        'media' => 'media TEXT NULL',
    ];
}

// Cria as tabelas que faltam e acrescenta as colunas novas. Uma requisição por vez.
function migrate(PDO $pdo): void
{
    $c = config()['db'];
    $lock = 'potato_schema_' . md5($c['name'] . '|' . $c['prefix']);
    $pdo->query('SELECT GET_LOCK(' . $pdo->quote($lock) . ', 20)')->fetchColumn();
    try {
        try {
            // Outra requisição pode ter atualizado enquanto esta esperava a vez.
            if ($pdo->query('SELECT value FROM ' . t('settings') . " WHERE name = 'schema'")->fetchColumn() === SCHEMA_VERSION) return;
        } catch (PDOException $error) {
            // Banco vazio: a tabela settings ainda não existe.
        }
        foreach (schema() as $sql) $pdo->exec($sql);
        foreach (['users' => user_columns(), 'messages' => message_columns()] as $table => $wanted) {
            $columns = $pdo->query('SHOW COLUMNS FROM ' . t($table))->fetchAll(PDO::FETCH_COLUMN);
            $missing = array_diff_key($wanted, array_flip($columns));
            if (!$missing) continue;
            $changes = array_map(fn($column) => "ADD COLUMN $column", array_values($missing));
            if (isset($missing['avatar_key'])) $changes[] = 'ADD KEY user_avatar (avatar_key)';
            $pdo->exec('ALTER TABLE ' . t($table) . ' ' . implode(', ', $changes));
        }
        $pdo->prepare('INSERT INTO ' . t('settings') . ' (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)')
            ->execute(['schema', SCHEMA_VERSION]);
    } finally {
        $pdo->query('SELECT RELEASE_LOCK(' . $pdo->quote($lock) . ')')->fetchColumn();
    }
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;
    $c = config()['db'];
    if (!class_exists('PDO') || !in_array('mysql', PDO::getAvailableDrivers(), true)) {
        throw new HttpError(500, 'A extensão pdo_mysql do PHP não está ativada na hospedagem.');
    }
    if ($c['name'] === '' || $c['user'] === '') throw new HttpError(500, 'Preencha os dados do banco MySQL em config.php.');
    try {
        $pdo = new PDO(
            sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $c['host'], (int) $c['port'], $c['name']),
            (string) $c['user'],
            (string) $c['pass'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]
        );
    } catch (PDOException $error) {
        error_log('Potato Chat: ' . $error->getMessage());
        throw new HttpError(500, 'Não foi possível conectar ao banco de dados. Confira os dados em config.php.');
    }
    settings($pdo);
    return $pdo;
}

// Configurações guardadas no banco (versão das tabelas e chave das sessões). Cria as tabelas se faltar.
function settings(?PDO $pdo = null): array
{
    static $settings = null;
    if ($settings !== null) return $settings;
    $pdo = $pdo ?? db();
    try {
        $settings = $pdo->query('SELECT name, value FROM ' . t('settings'))->fetchAll(PDO::FETCH_KEY_PAIR);
    } catch (PDOException $error) {
        $settings = [];
    }
    if (($settings['schema'] ?? '') !== SCHEMA_VERSION) {
        migrate($pdo);
        $settings = $pdo->query('SELECT name, value FROM ' . t('settings'))->fetchAll(PDO::FETCH_KEY_PAIR);
    }
    return $settings;
}

function query(string $sql, array $params = []): PDOStatement
{
    $statement = db()->prepare($sql);
    $statement->execute($params);
    return $statement;
}

// Trava global: uma alteração por vez, na ordem em que chegam. Assim os eventos ficam sempre em sequência.
function transaction(callable $work)
{
    $db = db();
    $c = config()['db'];
    $lock = 'potato_' . md5($c['name'] . '|' . $c['prefix']);
    if ((int) query('SELECT GET_LOCK(?, 10)', [$lock])->fetchColumn() !== 1) {
        throw new HttpError(503, 'Servidor ocupado. Tente de novo.');
    }
    try {
        $db->beginTransaction();
        try {
            $result = $work();
            $db->commit();
            return $result;
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }
    } finally {
        query('SELECT RELEASE_LOCK(?)', [$lock])->fetchColumn();
    }
}

// ---------- sessão ----------

function token_secret(): string
{
    static $secret = null;
    if ($secret !== null) return $secret;
    $configured = (string) config()['token_secret'];
    if ($configured !== '') return $secret = $configured;
    // Sem chave configurada, gera uma vez e guarda no banco: ninguém é deslogado depois.
    $saved = (string) (settings()['token_secret'] ?? '');
    if (strlen($saved) < 32) {
        query('INSERT IGNORE INTO ' . t('settings') . ' (name, value) VALUES (?, ?)', ['token_secret', bin2hex(random_bytes(32))]);
        $saved = (string) query('SELECT value FROM ' . t('settings') . ' WHERE name = ?', ['token_secret'])->fetchColumn();
    }
    return $secret = $saved;
}

function b64url(string $raw): string
{
    return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
}

function sign(array $payload): string
{
    $body = b64url(encode($payload));
    return $body . '.' . b64url(hash_hmac('sha256', $body, token_secret(), true));
}

function verify_token($token): ?array
{
    if (!is_string($token) || substr_count($token, '.') !== 1) return null;
    [$body, $signature] = explode('.', $token);
    if (!hash_equals(b64url(hash_hmac('sha256', $body, token_secret(), true)), $signature)) return null;
    $payload = json_decode((string) base64_decode(strtr($body, '-_', '+/')), true);
    if (!is_array($payload) || !is_string($payload['name'] ?? null) || !is_numeric($payload['expiresAt'] ?? null)) return null;
    return $payload['expiresAt'] > now_ms() ? $payload : null;
}

function issue_token(string $name): string
{
    return sign(['name' => $name, 'expiresAt' => now_ms() + SESSION_DAYS * DAY_MS, 'nonce' => uuid()]);
}

// Só duas contas: as duas primeiras pessoas que entram escolhem nome e senha, e eles valem para sempre.
// (A foto não entra aqui: ela só é lida quando alguém abre a imagem.)
function accounts(): array
{
    return query('SELECT position, name, pass_hash, avatar_key, theme, wallpaper_key, wallpaper_style FROM ' . t('users') . ' ORDER BY position LIMIT ' . MAX_USERS)->fetchAll();
}

function users(): array
{
    return array_column(accounts(), 'name');
}

function find_account(string $name): ?array
{
    foreach (accounts() as $account) if (same_name($account['name'], $name)) return $account;
    return null;
}

function authenticate(array $input): array
{
    $session = verify_token($input['token'] ?? null);
    $account = $session ? find_account($session['name']) : null;
    // Conta sem senha (criada antes das senhas, ou senha apagada no phpMyAdmin): entra de novo e escolhe uma.
    if (!$account || $account['pass_hash'] === null) throw new HttpError(401, 'Sessão inválida. Entre novamente.');
    return ['name' => $account['name'], 'expiresAt' => (int) $session['expiresAt']];
}

// Para a tela de login: quantas contas ainda podem ser criadas.
function welcome(): array
{
    $ready = array_filter(accounts(), fn($account) => $account['pass_hash'] !== null);
    return ['open' => MAX_USERS - count($ready)];
}

// Limite simples contra abuso: no máximo $max registros na janela de tempo.
function allow(array &$hits, int $max, int $windowMs): bool
{
    $now = now_ms();
    $hits = array_values(array_filter($hits, fn($time) => $now - $time < $windowMs));
    $hits[] = $now;
    return count($hits) <= $max;
}

function login(array $input, string $ip): array
{
    $allowed = transaction(function () use ($ip) {
        $now = now_ms();
        query('DELETE FROM ' . t('logins') . ' WHERE at < ?', [$now - 5 * 60 * 1000]);
        query('INSERT INTO ' . t('logins') . ' (ip, at) VALUES (?, ?)', [$ip, $now]);
        return (int) query('SELECT COUNT(*) FROM ' . t('logins') . ' WHERE ip = ?', [$ip])->fetchColumn() <= 12;
    });
    if (!$allowed) throw new HttpError(429, 'Muitas tentativas. Espere alguns minutos.');

    return transaction(function () use ($input) {
        $name = text_slice(trim(preg_replace('/\s+/u', ' ', str($input['name'] ?? '')) ?? ''), 24);
        $password = str($input['password'] ?? '');
        if (text_length($name) < 2) throw new HttpError(400, 'Digite um nome com pelo menos 2 caracteres.');
        if ($password === '') throw new HttpError(400, 'Digite sua senha.');
        if (strlen($password) > 200 || strpos($password, "\0") !== false) throw new HttpError(400, 'Senha inválida.');

        $account = find_account($name);
        if ($account && $account['pass_hash'] !== null) {
            if (!password_verify($password, $account['pass_hash'])) throw new HttpError(401, 'Senha incorreta.');
            if (password_needs_rehash($account['pass_hash'], PASSWORD_DEFAULT)) {
                query('UPDATE ' . t('users') . ' SET pass_hash = ? WHERE position = ?', [password_hash($password, PASSWORD_DEFAULT), $account['position']]);
            }
            return ['token' => issue_token($account['name']), 'name' => $account['name']];
        }

        // Primeiro acesso: cria a conta (ou só a senha, se a conta veio da versão sem senhas).
        if (!$account && count(accounts()) >= MAX_USERS) throw new HttpError(403, 'Nosso chat é só de ' . implode(' e ', users()) . '.');
        $name = $account['name'] ?? $name;
        if (text_length($password) < MIN_PASSWORD) throw new HttpError(400, 'Escolha uma senha com pelo menos ' . MIN_PASSWORD . ' caracteres.');
        // Nome e senha não mudam mais: o navegador pede a senha de novo antes de criar.
        if (!array_key_exists('confirm', $input)) return ['confirm' => true, 'name' => $name];
        if (!hash_equals($password, str($input['confirm']))) throw new HttpError(400, 'As senhas não são iguais. Digite de novo.');

        $hash = password_hash($password, PASSWORD_DEFAULT);
        if ($account) query('UPDATE ' . t('users') . ' SET pass_hash = ? WHERE position = ?', [$hash, $account['position']]);
        else query('INSERT INTO ' . t('users') . ' (name, created_at, pass_hash) VALUES (?, ?, ?)', [$name, iso(), $hash]);
        return ['token' => issue_token($name), 'name' => $name, 'created' => true];
    });
}

// ---------- foto de perfil ----------

function avatar_url(?string $key): ?string
{
    return $key ? 'api.php?action=avatar&k=' . $key : null;
}

// Foto já recortada e reduzida no navegador (data URL), ou GIF animado inteiro. null remove a foto.
function set_avatar(string $name, $image): array
{
    if ($image === null || $image === '') {
        query('UPDATE ' . t('users') . ' SET avatar = NULL, avatar_type = NULL, avatar_key = NULL WHERE name = ?', [$name]);
        emit('presence');
        return ['ok' => true, 'avatar' => null];
    }
    if (!is_string($image) || !preg_match('#^data:image/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$#', $image, $match)) {
        return ['ok' => false, 'error' => 'Formato de imagem não aceito.'];
    }
    $raw = base64_decode($match[2], true);
    if ($raw === false || strlen($raw) > ($match[1] === 'gif' ? AVATAR_GIF_MAX : AVATAR_MAX)) return ['ok' => false, 'error' => 'Imagem grande demais.'];
    $info = @getimagesizefromstring($raw);
    if (!$info || $info['mime'] !== 'image/' . $match[1] || $info[0] < 16 || $info[1] < 16 || $info[0] > 2048 || $info[1] > 2048) {
        return ['ok' => false, 'error' => 'Imagem inválida.'];
    }
    // Chave nova a cada troca: o endereço da foto muda e ninguém fica com a antiga no cache.
    $key = bin2hex(random_bytes(16));
    query('UPDATE ' . t('users') . ' SET avatar = ?, avatar_type = ?, avatar_key = ? WHERE name = ?', [base64_encode($raw), $info['mime'], $key, $name]);
    emit('presence');
    return ['ok' => true, 'avatar' => avatar_url($key)];
}

function find_avatar(string $key): ?array
{
    if (!preg_match('/^[0-9a-f]{32}$/', $key)) return null;
    $row = query('SELECT avatar, avatar_type FROM ' . t('users') . ' WHERE avatar_key = ?', [$key])->fetch();
    return $row ? ['type' => $row['avatar_type'], 'data' => (string) base64_decode($row['avatar'])] : null;
}

// ---------- bot de música (/play) ----------
// Uma fila só, para os dois: o que está tocando, desde quando (no relógio do servidor) e o que vem depois.
// Fica na tabela de configurações (nome "music"), sem tabela nova.

function http_get(string $url, int $timeout = 6): array
{
    $agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3,
            CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => $timeout, CURLOPT_USERAGENT => $agent,
            CURLOPT_HTTPHEADER => ['Accept-Language: pt-BR,pt;q=0.9'],
        ]);
        $body = curl_exec($curl);
        return [(int) curl_getinfo($curl, CURLINFO_HTTP_CODE), is_string($body) ? $body : ''];
    }
    $context = stream_context_create(['http' => ['timeout' => $timeout, 'ignore_errors' => true, 'header' => "User-Agent: $agent\r\nAccept-Language: pt-BR,pt;q=0.9\r\n"]]);
    $body = @file_get_contents($url, false, $context);
    $status = isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $match) ? (int) $match[1] : 0;
    return [$status, is_string($body) ? $body : ''];
}

function http_post(string $url, array $headers, string $body, int $timeout): array
{
    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $headers, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 10,
        ]);
        $response = curl_exec($curl);
        return [(int) curl_getinfo($curl, CURLINFO_HTTP_CODE), is_string($response) ? $response : ''];
    }
    $context = stream_context_create(['http' => ['method' => 'POST', 'timeout' => $timeout, 'ignore_errors' => true, 'header' => implode("\r\n", $headers) . "\r\n", 'content' => $body]]);
    $response = @file_get_contents($url, false, $context);
    $status = isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $match) ? (int) $match[1] : 0;
    return [$status, is_string($response) ? $response : ''];
}

function http_json(string $url): ?array
{
    [$status, $body] = http_get($url);
    $data = $status === 200 ? json_decode($body, true) : null;
    return is_array($data) ? $data : null;
}

// Link do YouTube (vídeo, shorts, YouTube Music) ou do Spotify (música, álbum, playlist, podcast). null = não é link.
function parse_music_link(string $query): ?array
{
    if (preg_match('~(?:youtube\.com/(?:watch\?(?:[^#\s]*&)?v=|shorts/|embed/|live/)|youtu\.be/)([A-Za-z0-9_-]{11})~', $query, $match)) {
        return ['source' => 'youtube', 'type' => 'video', 'id' => $match[1]];
    }
    if (preg_match('~open\.spotify\.com/(?:intl-[a-z-]+/)?(?:embed/)?(track|album|playlist|episode|show)/([A-Za-z0-9]{22})~', $query, $match)
        || preg_match('~^spotify:(track|album|playlist|episode|show):([A-Za-z0-9]{22})$~', $query, $match)) {
        return ['source' => 'spotify', 'type' => $match[1], 'id' => $match[2]];
    }
    return null;
}

function https_url($url): ?string
{
    return is_string($url) && preg_match('~^https://[^\s"\'<>]+$~', $url) ? text_slice($url, 500) : null;
}

// "3:28" ou "1:02:03" → segundos.
function parse_length(string $text): ?float
{
    if (!preg_match('~^(?:(\d+):)?(\d{1,2}):(\d{2})$~', trim($text), $match)) return null;
    return (float) ((int) $match[1] * 3600 + (int) $match[2] * 60 + (int) $match[3]);
}

// Vídeos que o dono deixa tocar fora do YouTube respondem ao oEmbed; os bloqueados, não.
function youtube_meta(string $id): ?array
{
    return http_json('https://www.youtube.com/oembed?' . http_build_query(['url' => "https://www.youtube.com/watch?v=$id", 'format' => 'json']));
}

// Busca pelo nome. Com a chave da API, pelo jeito oficial; sem ela, lendo a página de resultados do YouTube.
// $filter é o filtro da página de resultados (padrão: só vídeos; o catálogo da sala usa "mais vistos da semana").
function youtube_search(string $query, int $limit = 6, string $filter = 'EgIQAQ=='): array
{
    $key = str(config()['youtube_key']);
    $found = [];
    if ($key !== '') {
        $data = http_json('https://www.googleapis.com/youtube/v3/search?' . http_build_query([
            'part' => 'snippet', 'type' => 'video', 'videoEmbeddable' => 'true', 'videoSyndicated' => 'true',
            'maxResults' => max(5, min(25, $limit)), 'regionCode' => 'BR', 'relevanceLanguage' => 'pt', 'q' => $query, 'key' => $key,
        ] + ($filter !== 'EgIQAQ==' ? ['order' => 'viewCount', 'publishedAfter' => gmdate('Y-m-d\TH:i:s\Z', time() - 30 * 86400)] : [])));
        foreach ($data['items'] ?? [] as $item) {
            if (empty($item['id']['videoId'])) continue;
            $found[] = [
                'id' => $item['id']['videoId'],
                'title' => html_entity_decode((string) ($item['snippet']['title'] ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8'),
                'artist' => html_entity_decode((string) ($item['snippet']['channelTitle'] ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8'),
                'checked' => true,
            ];
        }
        return $found;
    }
    [$status, $html] = http_get('https://www.youtube.com/results?' . http_build_query(['search_query' => $query, 'sp' => $filter, 'hl' => 'pt-BR', 'gl' => 'BR']));
    if ($status !== 200 || !preg_match('/var ytInitialData = (\{.*?\});<\/script>/s', $html, $match)) return [];
    $walk = function ($node) use (&$walk, &$found, $limit) {
        if (!is_array($node) || count($found) >= $limit) return;
        if (isset($node['videoRenderer']['videoId'])) {
            $video = $node['videoRenderer'];
            // Sem duração = transmissão ao vivo: fica de fora.
            if (!empty($video['lengthText'])) {
                $found[] = [
                    'id' => $video['videoId'], 'title' => $video['title']['runs'][0]['text'] ?? '', 'artist' => $video['ownerText']['runs'][0]['text'] ?? '',
                    'duration' => parse_length((string) ($video['lengthText']['simpleText'] ?? '')), 'checked' => false,
                    'views' => (string) ($video['shortViewCountText']['simpleText'] ?? ''), 'age' => (string) ($video['publishedTimeText']['simpleText'] ?? ''),
                ];
            }
            return;
        }
        foreach ($node as $child) $walk($child);
    };
    $walk(json_decode($match[1], true));
    return $found;
}

// "Artista - Música (Clipe Oficial)" → ["Música", "Artista"], como num app de música.
// Sem o traço no título, o artista é o canal (sem o "- Topic" e o "VEVO").
function clean_video_title(string $title, string $channel): array
{
    $noise = 'official|oficial|music|video|vídeo|videoclipe|clipe|clip|lyrics?|letra|audio|áudio|visuali[sz]er|legendad[oa]|tradução|traducao|hd|4k|mv';
    $strip = fn(string $text): string => preg_replace('~^[\s"\'“”‘’]+|[\s"\'“”‘’]+$~u', '', $text) ?? $text;
    $lower = fn(string $text): string => function_exists('mb_strtolower') ? mb_strtolower($text, 'UTF-8') : strtolower($text);
    $clean = preg_replace('~\s*[(\[][^)\]]*(?<!\pL)(?:' . $noise . ')(?!\pL)[^)\]]*[)\]]~iu', '', $title) ?? $title;
    $clean = preg_replace('~\s+\|\s.*$~u', '', $clean) ?? $clean;
    $artist = $strip(preg_replace('~\s*-\s*Topic$|VEVO$~iu', '', $channel) ?? $channel);
    if (preg_match('~^(.+?)\s+[-–—]\s+(.+)$~u', $clean, $match)) {
        [$left, $right] = [$strip($match[1]), $strip($match[2])];
        // "Música - Artista": o lado entre aspas é a música; o lado igual ao canal, o artista.
        $swap = preg_match('~^["“‘\']~u', $match[1]) === 1
            || ($artist !== '' && $lower($right) === $lower($artist) && $lower($left) !== $lower($artist));
        [$clean, $artist] = $swap ? [$left, $right] : [$right, $left];
    }
    $clean = $strip(preg_replace('~\s+~u', ' ', $clean) ?? $clean);
    return [$clean !== '' ? $clean : $title, $artist];
}

function youtube_track(string $id, string $title, string $channel, ?float $duration = null): array
{
    [$name, $artist] = clean_video_title($title, $channel);
    return [
        'source' => 'youtube', 'type' => 'video', 'id' => $id,
        'title' => text_slice($name, 200), 'artist' => text_slice($artist, 120), 'full' => text_slice($title, 200),
        'thumb' => "https://i.ytimg.com/vi/$id/mqdefault.jpg", 'cover' => "https://i.ytimg.com/vi/$id/hqdefault.jpg",
    ] + ($duration ? ['duration' => $duration] : []);
}

// A mesma música no YouTube, para tocar inteira (sem login, o player do Spotify só toca 30 s).
// Vão primeiro os vídeos com o nome da música e, entre eles, o de duração mais perto da do Spotify:
// costuma ser a versão de estúdio, sem os minutos a mais dos clipes.
function youtube_match(string $title, string $artist, ?float $duration): ?array
{
    $simple = function (string $text): string {
        $text = function_exists('mb_strtolower') ? mb_strtolower($text, 'UTF-8') : strtolower($text);
        $text = strtr($text, ['á' => 'a', 'à' => 'a', 'â' => 'a', 'ã' => 'a', 'é' => 'e', 'ê' => 'e', 'í' => 'i', 'ó' => 'o', 'ô' => 'o', 'õ' => 'o', 'ú' => 'u', 'ü' => 'u', 'ç' => 'c', 'ñ' => 'n']);
        return trim(preg_replace('~[^a-z0-9]+~', ' ', $text) ?? '');
    };
    $name = $simple(preg_replace('~\s*[-–(\[].*$~u', '', $title) ?? $title);
    $ranked = [];
    foreach (array_slice(youtube_search(trim("$artist $title")), 0, 6) as $index => $video) {
        $named = $name === '' || strpos($simple($video['title']), $name) !== false;
        $gap = $duration && !empty($video['duration']) ? abs($video['duration'] - $duration) : null;
        $ranked[] = [$named ? 0 : 1, $gap !== null && $gap <= 60 ? $gap : 100 + $index, $video];
    }
    usort($ranked, fn($a, $b) => [$a[0], $a[1]] <=> [$b[0], $b[1]]);
    foreach (array_slice($ranked, 0, 4) as [, , $video]) {
        if ($video['checked'] || youtube_meta($video['id'])) return $video;
    }
    return null;
}

// Página do player do Spotify: nome, artistas, capa, duração e a cor que o próprio Spotify usa no cartão.
function spotify_meta(string $type, string $id): ?array
{
    [$status, $html] = http_get("https://open.spotify.com/embed/$type/$id");
    if ($status !== 200 || !preg_match('~<script id="__NEXT_DATA__" type="application/json">(.+?)</script>~s', $html, $match)) return null;
    $entity = json_decode($match[1], true)['props']['pageProps']['state']['data']['entity'] ?? null;
    if (!is_array($entity)) return null;
    $line = fn($text): string => text_slice(trim(preg_replace('~\s+~u', ' ', is_string($text) ? $text : '') ?? ''), 200);
    $artists = array_filter(array_map(fn($artist) => $line(is_array($artist) ? ($artist['name'] ?? '') : ''), (array) ($entity['artists'] ?? [])));
    $width = fn($image): int => (int) ($image['maxWidth'] ?? $image['width'] ?? 0);
    $images = array_values(array_filter((array) ($entity['visualIdentity']['image'] ?? $entity['coverArt']['sources'] ?? []), fn($image) => is_array($image) && https_url($image['url'] ?? null)));
    usort($images, fn($a, $b) => $width($b) <=> $width($a));
    $sharp = array_values(array_filter($images, fn($image) => $width($image) >= 250));
    $base = $entity['visualIdentity']['backgroundBase'] ?? null;
    $channel = fn($key): int => max(0, min(255, (int) ($base[$key] ?? 0)));
    return [
        'title' => $line($entity['name'] ?? $entity['title'] ?? ''),
        'artist' => text_slice($artists ? implode(', ', $artists) : $line($entity['subtitle'] ?? ''), 120),
        'cover' => $images ? https_url($images[0]['url']) : null,
        'thumb' => $sharp ? https_url($sharp[count($sharp) - 1]['url']) : ($images ? https_url($images[0]['url']) : null),
        'color' => is_array($base) ? sprintf('#%02x%02x%02x', $channel('red'), $channel('green'), $channel('blue')) : null,
        'duration' => ($entity['duration'] ?? 0) > 0 ? round($entity['duration'] / 1000, 1) : null,
        // Álbum ou playlist: as músicas (nome, artistas e duração; a capa vem quando cada uma for tocar).
        'tracks' => array_values(array_filter(array_map(function ($item) use ($line) {
            if (!is_array($item) || !preg_match('~^spotify:track:([A-Za-z0-9]{22})$~', (string) ($item['uri'] ?? ''), $match)) return null;
            return ['id' => $match[1], 'title' => $line($item['title'] ?? ''), 'artist' => text_slice($line($item['subtitle'] ?? ''), 120),
                'duration' => ($item['duration'] ?? 0) > 0 ? round($item['duration'] / 1000, 1) : null];
        }, (array) ($entity['trackList'] ?? [])))),
    ];
}

// Música da fila guardada só com o nome (de um álbum ou playlist do Spotify): na hora de tocar, vira a música
// inteira pelo YouTube. null = não deu para tocar.
function ready_track(array $item): ?array
{
    if (empty($item['lazy'])) return $item;
    $resolved = resolve_track("spotify:track:{$item['id']}");
    return $resolved['ok'] ? $resolved['track'] + ['uid' => $item['uid'], 'by' => $item['by']] : null;
}

// Nome ou link → música pronta para a fila ({source, type, id, title, artist, thumb, cover, …}).
function resolve_track(string $query): array
{
    $lookup = (bool) config()['music_lookup'];
    $link = parse_music_link($query);
    if (!$link) {
        if (!$lookup) return ['ok' => false, 'error' => 'A busca pelo nome está desligada.'];
        foreach (array_slice(youtube_search($query), 0, 4) as $video) {
            $meta = $video['checked'] ? null : youtube_meta($video['id']);
            if (!$video['checked'] && !$meta) continue;
            return ['ok' => true, 'track' => youtube_track($video['id'], $video['title'] ?: (string) ($meta['title'] ?? 'Vídeo do YouTube'), $video['artist'] ?: (string) ($meta['author_name'] ?? ''), $video['duration'] ?? null)];
        }
        return ['ok' => false, 'error' => "Não achei nada que dê para tocar com “{$query}”. Tente outro nome ou cole o link."];
    }
    if ($link['source'] === 'youtube') {
        $meta = $lookup ? youtube_meta($link['id']) : null;
        return ['ok' => true, 'track' => youtube_track($link['id'], (string) ($meta['title'] ?? 'Vídeo do YouTube'), (string) ($meta['author_name'] ?? ''))];
    }
    $meta = $lookup ? spotify_meta($link['type'], $link['id']) : null;
    // Música do Spotify: sem login, o player dele só toca 30 s. Ela toca inteira pelo YouTube,
    // com o nome, a capa e a cor do Spotify (origin guarda de onde veio o link).
    $video = $meta && $link['type'] === 'track' && $meta['title'] !== '' ? youtube_match($meta['title'], $meta['artist'], $meta['duration']) : null;
    if ($video) {
        return ['ok' => true, 'track' => array_filter([
            'source' => 'youtube', 'type' => 'video', 'id' => $video['id'],
            'title' => $meta['title'], 'artist' => $meta['artist'], 'full' => text_slice($video['title'], 200),
            'thumb' => $meta['thumb'], 'cover' => $meta['cover'], 'color' => $meta['color'],
            'duration' => $video['duration'] ?? $meta['duration'],
            'origin' => ['source' => 'spotify', 'type' => 'track', 'id' => $link['id']],
        ], fn($value) => $value !== null)];
    }
    // Álbum ou playlist: as músicas vão todas para a fila, e cada uma toca inteira pelo YouTube quando chegar a vez
    // dela (procurar as 50 de uma vez demoraria minutos). O cartão no chat é o da lista.
    if ($meta && in_array($link['type'], ['album', 'playlist'], true) && !empty($meta['tracks'])) {
        $album = $link['type'] === 'album';
        $list = array_map(fn($item) => array_filter([
            'source' => 'spotify', 'type' => 'track', 'id' => $item['id'], 'title' => $item['title'], 'artist' => $item['artist'],
            'duration' => $item['duration'], 'thumb' => $album ? $meta['thumb'] : null, 'lazy' => true,
        ], fn($value) => $value !== null && $value !== ''), array_slice($meta['tracks'], 0, MUSIC_QUEUE_MAX));
        $count = count($list);
        return ['ok' => true, 'list' => $list, 'card' => $link + array_filter([
            'title' => $meta['title'] ?: ($album ? 'Álbum do Spotify' : 'Playlist do Spotify'),
            'artist' => text_slice(($album ? 'Álbum' : 'Playlist') . ($meta['artist'] !== '' ? " · {$meta['artist']}" : '') . " · $count " . ($count === 1 ? 'música' : 'músicas'), 120),
            'thumb' => $meta['thumb'], 'cover' => $meta['cover'], 'color' => $meta['color'],
        ], fn($value) => $value !== null)];
    }
    // Sem a página do player, o oEmbed ainda dá o nome e a capa.
    $oembed = $lookup && !$meta ? http_json('https://open.spotify.com/oembed?' . http_build_query(['url' => "https://open.spotify.com/{$link['type']}/{$link['id']}"])) : null;
    $label = ['track' => 'Música', 'album' => 'Álbum', 'playlist' => 'Playlist', 'episode' => 'Episódio', 'show' => 'Podcast'][$link['type']];
    $artist = (string) ($meta['artist'] ?? '');
    if ($link['type'] !== 'track') $artist = $artist !== '' ? "$label · $artist" : $label;
    return ['ok' => true, 'track' => $link + array_filter([
        'title' => text_slice(($meta['title'] ?? '') ?: (string) ($oembed['title'] ?? "$label do Spotify"), 200),
        'artist' => text_slice($artist, 120),
        'thumb' => $meta['thumb'] ?? https_url($oembed['thumbnail_url'] ?? null),
        'cover' => $meta['cover'] ?? null,
        'color' => $meta['color'] ?? null,
        'duration' => $meta['duration'] ?? null,
    ], fn($value) => $value !== null)];
}

function music_blank(): array
{
    return ['now' => null, 'queue' => [], 'playing' => false, 'position' => 0, 'updatedAt' => 0];
}

function music_state(bool $lock = false): array
{
    if ($lock) query('INSERT IGNORE INTO ' . t('settings') . " (name, value) VALUES ('music', '{}')");
    $raw = query('SELECT value FROM ' . t('settings') . " WHERE name = 'music'" . ($lock ? ' FOR UPDATE' : ''))->fetchColumn();
    $state = $raw ? json_decode((string) $raw, true) : null;
    return is_array($state) ? array_merge(music_blank(), $state) : music_blank();
}

function save_music(array $state): void
{
    query('INSERT INTO ' . t('settings') . " (name, value) VALUES ('music', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [encode($state)]);
}

// serverNow: o navegador compara com o próprio relógio para saber em que segundo a música está.
function music_public(array $state): array
{
    return $state + ['serverNow' => now_ms()];
}

// Cartão do Potato DJ no chat (mensagem de quem pediu a música).
function post_music_card(array $me, array $track, int $queued): void
{
    $row = [
        'id' => uuid(), 'client_id' => null, 'sender' => $me['name'], 'text' => '', 'created_at' => iso(), 'reply_to' => null,
        'reactions' => '{}', 'deleted' => 0, 'source' => 'music', 'media' => encode(['music' => $track + ['queued' => $queued]]),
    ];
    query('INSERT INTO ' . t('messages') . ' (id, client_id, sender, text, created_at, reply_to, reactions, deleted, source, media) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', array_values($row));
    emit('message', to_message($row));
}

// Comandos: play (com query = pede música; sem = continua), pause, resume, seek, skip, ended (a música acabou), stop,
// remove (tira da fila) e jump (toca agora uma da fila).
function music_act(array $me, array $body): array
{
    $op = str($body['op'] ?? '');
    $query = text_slice(text_trim(str($body['query'] ?? '')), 300);
    $track = null;
    $card = null;
    $more = [];
    if ($op === 'play' && $query !== '') {
        $resolved = resolve_track($query);
        if (!$resolved['ok']) return $resolved;
        $stamp = fn($item) => $item + ['uid' => bin2hex(random_bytes(8)), 'by' => $me['name']];
        if (isset($resolved['list'])) {
            // Álbum ou playlist: a primeira que der para tocar já fica pronta; as outras vão para a fila.
            $more = array_map($stamp, $resolved['list']);
            for ($tries = 0; !$track && $more && $tries < 3; $tries++) $track = ready_track(array_shift($more));
            if (!$track) return ['ok' => false, 'error' => 'Não deu para tocar as músicas dessa lista.'];
            $card = $resolved['card'] + ['uid' => $track['uid'], 'by' => $me['name']];
        } else {
            $track = $stamp($resolved['track']);
        }
    }
    $state = music_state(true);
    $now = now_ms();
    $action = ['op' => $op, 'by' => $me['name']];
    $advance = function () use (&$state, $now, &$action) {
        $next = null;
        for ($tries = 0; !$next && $state['queue'] && $tries < 3; $tries++) $next = ready_track(array_shift($state['queue']));
        $state['now'] = $next;
        $state['playing'] = (bool) $state['now'];
        $state['position'] = 0;
        $state['updatedAt'] = $now;
        $action['track'] = $state['now'];
    };
    switch ($op) {
        case 'play':
            if ($track) {
                if (count($state['queue']) >= MUSIC_QUEUE_MAX) return ['ok' => false, 'error' => 'A fila está cheia.'];
                if ($state['now']) {
                    $state['queue'][] = $track;
                    $action['queued'] = count($state['queue']);
                } else {
                    $state = ['now' => $track, 'queue' => $state['queue'], 'playing' => true, 'position' => 0, 'updatedAt' => $now];
                    $action['queued'] = 0;
                }
                $action['track'] = $track;
                if ($more) {
                    $more = array_slice($more, 0, max(0, MUSIC_QUEUE_MAX - count($state['queue'])));
                    $state['queue'] = array_merge($state['queue'], $more);
                    $action['added'] = 1 + count($more);
                }
                break;
            }
            // /play sozinho: continua o que estava pausado.
            $action['op'] = 'resume';
            // no break
        case 'resume':
            if (!$state['now']) return ['ok' => false, 'error' => 'Nada tocando. Use /play com o nome ou o link de uma música.'];
            if (!$state['playing']) {
                $state['playing'] = true;
                $state['updatedAt'] = $now;
            }
            break;
        case 'pause':
            if (!$state['now']) return ['ok' => false, 'error' => 'Nada tocando agora.'];
            if ($state['playing']) {
                $state['position'] += ($now - $state['updatedAt']) / 1000;
                $state['playing'] = false;
                $state['updatedAt'] = $now;
            }
            break;
        case 'seek':
            if (!$state['now']) return ['ok' => false, 'error' => 'Nada tocando agora.'];
            $state['position'] = max(0, min(86400, (float) ($body['position'] ?? 0)));
            $state['updatedAt'] = $now;
            break;
        case 'ended':
            // Os dois aparelhos avisam que acabou: só o primeiro aviso vale.
            if (($state['now']['uid'] ?? '') !== str($body['uid'] ?? '')) return ['ok' => true, 'state' => music_public($state)];
            $advance();
            break;
        case 'skip':
            if (!$state['now']) return ['ok' => false, 'error' => 'Nada tocando agora.'];
            $advance();
            break;
        case 'stop':
            $state = music_blank();
            break;
        case 'remove':
            $uid = str($body['uid'] ?? '');
            $state['queue'] = array_values(array_filter($state['queue'], fn($item) => ($item['uid'] ?? '') !== $uid));
            break;
        case 'jump':
            // A escolhida sai da fila e começa do zero; a que tocava, para.
            $uid = str($body['uid'] ?? '');
            $index = array_search($uid, array_map(fn($item) => $item['uid'] ?? '', $state['queue']), true);
            if ($uid === '' || $index === false) return ['ok' => false, 'error' => 'Essa música não está mais na fila.'];
            [$picked] = array_splice($state['queue'], $index, 1);
            $picked = ready_track($picked);
            if (!$picked) return ['ok' => false, 'error' => 'Não deu para tocar essa música.'];
            $state = ['now' => $picked, 'queue' => $state['queue'], 'playing' => true, 'position' => 0, 'updatedAt' => $now];
            $action['track'] = $picked;
            break;
        default:
            return ['ok' => false, 'error' => 'Comando de música desconhecido.'];
    }
    save_music($state);
    if ($track) post_music_card($me, $card ?? $track, $action['queued']);
    $public = music_public($state);
    emit('music', ['state' => $public, 'action' => $action]);
    return ['ok' => true, 'state' => $public, 'action' => $action];
}

// ---------- assistir junto ----------
// Um vídeo para os dois, no mesmo segundo: YouTube, Twitch (vídeo gravado ou canal ao vivo) ou um arquivo que cada
// um escolhe no próprio aparelho (nada sobe para o servidor). Fica na tabela de configurações (nome "watch").

function parse_watch_link(string $query): ?array
{
    $music = parse_music_link($query);
    if (($music['source'] ?? '') === 'youtube') return ['source' => 'youtube', 'id' => $music['id']];
    if (preg_match('~twitch\.tv/videos/(\d+)~i', $query, $match)) return ['source' => 'twitch', 'kind' => 'video', 'id' => $match[1]];
    if (preg_match('~clips\.twitch\.tv/|twitch\.tv/[^/\s]+/clip/~i', $query)) return ['source' => 'clip'];
    if (preg_match('~twitch\.tv/([A-Za-z0-9_]{3,25})(?=[/?#\s]|$)~i', $query, $match)) return ['source' => 'twitch', 'kind' => 'channel', 'id' => strtolower($match[1])];
    // Netflix e HBO Max: cada um abre com a própria conta (a extensão sincroniza; no celular, a contagem).
    if (preg_match('~netflix\.com/(?:[a-z]{2}(?:-[a-z]{2})?/)?(watch|title)/(\d+)~i', $query, $match)) {
        return ['source' => 'netflix', 'title' => 'Netflix', 'url' => 'https://www.netflix.com/' . strtolower($match[1]) . '/' . $match[2]];
    }
    if (preg_match('~https?://(?:[a-z]+\.)?(?:hbo)?max\.com/[^\s"<>]*~i', $query, $match)) return ['source' => 'max', 'title' => 'HBO Max', 'url' => https_url($match[0]) ?? 'https://play.hbomax.com/'];
    return null;
}

// browsing: quem está escolhendo e onde, por pessoa (a outra vê "Ana está escolhendo na Netflix…"; na Netflix e na
// HBO Max, a extensão começa a sessão sozinha quando essa pessoa der o play lá). recent: "Vistos por vocês".
function watch_blank(): array
{
    return ['now' => null, 'playing' => false, 'position' => 0, 'updatedAt' => 0, 'browsing' => null, 'recent' => []];
}

const WATCH_SERVICES = ['youtube', 'netflix', 'max', 'twitch'];

// Prateleiras do catálogo do YouTube na sala: buscas com filtro (mais vistos da semana ou do mês, só vídeos).
const WATCH_SHELVES = [
    'alta' => ['brasil', 'CAMSBAgDEAE='],
    'musicas' => ['clipe oficial música brasileira', 'CAMSBAgEEAE='],
    'trailers' => ['trailer oficial dublado', 'CAMSBAgEEAE='],
    'humor' => ['humor brasileiro', 'CAMSBAgEEAE='],
    'games' => ['jogando gameplay pt-br', 'CAMSBAgDEAE='],
    'podcasts' => ['cortes podcast', 'CAMSBAgDEAE='],
    'esportes' => ['melhores momentos', 'CAMSBAgDEAE='],
    'documentarios' => ['documentário completo', 'CAMSBAgEEAE='],
    'receitas' => ['receita', 'CAMSBAgEEAE='],
];

// O catálogo: uma prateleira ou a busca de quem digitou. Só lê o YouTube; a sala não muda.
function watch_catalog(array $body): array
{
    $shelf = WATCH_SHELVES[str($body['shelf'] ?? '')] ?? null;
    $query = $shelf[0] ?? text_slice(text_trim(str($body['query'] ?? '')), 120);
    if ($query === '' || !config()['music_lookup']) return ['ok' => true, 'results' => []];
    $results = array_map(fn($video) => [
        'id' => $video['id'], 'title' => text_slice((string) $video['title'], 200), 'channel' => text_slice((string) $video['artist'], 120),
        'duration' => $video['duration'] ?? null, 'views' => text_slice((string) ($video['views'] ?? ''), 40), 'age' => text_slice((string) ($video['age'] ?? ''), 40),
    ], youtube_search($query, 18, $shelf[1] ?? 'EgIQAQ=='));
    return ['ok' => true, 'results' => $results];
}

// "Vistos por vocês": os 12 últimos da sala, sem repetir. O vídeo do aparelho fica de fora (o arquivo é de cada
// um), e da Netflix e da HBO Max só entra o que tem título certo (o endereço de um filme ou episódio).
function watch_recent(array $recent, array $item): array
{
    $source = $item['source'];
    if ($source === 'local' || (in_array($source, ['netflix', 'max'], true) && !preg_match('~/watch/~', $item['url'] ?? ''))) return $recent;
    $key = $source . ':' . ($item['id'] ?? $item['url'] ?? '');
    $entry = ['key' => $key] + array_intersect_key($item, array_flip(['source', 'kind', 'id', 'url', 'title', 'channel', 'duration']));
    $recent = array_values(array_filter($recent, fn($old) => ($old['key'] ?? '') !== $key));
    array_unshift($recent, $entry);
    return array_slice($recent, 0, 12);
}

function watch_state(bool $lock = false): array
{
    if ($lock) query('INSERT IGNORE INTO ' . t('settings') . " (name, value) VALUES ('watch', '{}')");
    $raw = query('SELECT value FROM ' . t('settings') . " WHERE name = 'watch'" . ($lock ? ' FOR UPDATE' : ''))->fetchColumn();
    $state = $raw ? json_decode((string) $raw, true) : null;
    return is_array($state) ? array_merge(watch_blank(), $state) : watch_blank();
}

function save_watch(array $state): void
{
    query('INSERT INTO ' . t('settings') . " (name, value) VALUES ('watch', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [encode($state)]);
}

function watch_public(array $state): array
{
    return $state + ['serverNow' => now_ms()];
}

// Comandos: start (query = link ou nome; video = escolhido no catálogo; local = vídeo do aparelho), pause, resume,
// seek, ended, countdown, browse (quem está escolhendo), stop e search (o catálogo, sem mexer na sala).
function watch_act(array $me, array $body): array
{
    $op = str($body['op'] ?? '');
    if ($op === 'search') return watch_catalog($body);
    $item = null;
    if ($op === 'start') {
        $local = is_array($body['local'] ?? null) ? $body['local'] : null;
        $video = is_array($body['video'] ?? null) ? $body['video'] : null;
        if ($video) {
            // Escolhido no catálogo: já vem com nome, canal e duração. Os que o dono não deixa passar fora do YouTube
            // não respondem ao oEmbed: melhor avisar agora do que abrir um player com erro para os dois.
            $id = str($video['id'] ?? '');
            if (!preg_match('/^[A-Za-z0-9_-]{11}$/', $id)) return ['ok' => false, 'error' => 'Vídeo inválido.'];
            if (config()['music_lookup'] && !youtube_meta($id)) return ['ok' => false, 'error' => 'Esse vídeo não deixa passar fora do YouTube. Escolha outro.'];
            $title = text_slice(text_trim(str($video['title'] ?? '')), 200);
            $channel = text_slice(text_trim(str($video['channel'] ?? '')), 120);
            $duration = max(0, min(86400, (float) ($video['duration'] ?? 0)));
            $item = ['source' => 'youtube', 'id' => $id, 'title' => $title !== '' ? $title : 'Vídeo do YouTube']
                + ($channel !== '' ? ['channel' => $channel] : []) + ($duration > 0 ? ['duration' => $duration] : []);
        } elseif ($local) {
            $name = clean_file_name(str($local['name'] ?? ''));
            $item = ['source' => 'local', 'title' => $name, 'name' => $name, 'size' => max(0, (int) ($local['size'] ?? 0)), 'duration' => max(0, min(86400, (float) ($local['duration'] ?? 0)))];
        } else {
            $query = text_slice(text_trim(str($body['query'] ?? '')), 300);
            $service = str($body['service'] ?? '');
            $link = parse_watch_link($query);
            // Netflix ou HBO Max sem link: vale o nome do filme ou da série (o botão abre a busca de lá).
            if (!$link && in_array($service, ['netflix', 'max'], true)) {
                $netflix = $service === 'netflix';
                $link = ['source' => $service, 'title' => $query !== '' ? text_slice($query, 120) : ($netflix ? 'Netflix' : 'HBO Max'),
                    'url' => $netflix ? 'https://www.netflix.com/' . ($query !== '' ? 'search?q=' . rawurlencode($query) : 'browse') : 'https://play.hbomax.com/'];
            }
            // Sem link: procura pelo nome no YouTube (o primeiro que dá para passar fora de lá).
            if (!$link && $query !== '' && config()['music_lookup']) {
                foreach (array_slice(youtube_search($query), 0, 4) as $video) {
                    if (!$video['checked'] && !youtube_meta($video['id'])) continue;
                    $link = ['source' => 'youtube', 'id' => $video['id'], 'title' => text_slice((string) $video['title'], 200)];
                    break;
                }
            }
            if (!$link) return ['ok' => false, 'error' => 'Não achei esse vídeo. Cole o link do YouTube ou da Twitch (ou escolha um vídeo do aparelho).'];
            if ($link['source'] === 'clip') return ['ok' => false, 'error' => 'Clipe da Twitch não dá para assistir junto: use o link do vídeo ou do canal.'];
            if ($link['source'] === 'youtube') {
                $meta = !isset($link['title']) && config()['music_lookup'] ? youtube_meta($link['id']) : null;
                $item = $link + ['title' => text_slice((string) ($meta['title'] ?? 'Vídeo do YouTube'), 200)];
            } elseif (in_array($link['source'], ['netflix', 'max'], true)) {
                // A extensão manda o nome que aparece no player de lá (o link sozinho não diz o que é).
                $named = text_slice(text_trim(str($body['title'] ?? '')), 120);
                $item = ($named !== '' ? ['title' => $named] : []) + $link;
            } else {
                $item = $link + ['title' => $link['kind'] === 'channel' ? "Ao vivo: {$link['id']}" : 'Vídeo da Twitch'];
            }
        }
        $item += ['uid' => bin2hex(random_bytes(8)), 'by' => $me['name']];
    }
    $state = watch_state(true);
    $now = now_ms();
    $action = ['op' => $op, 'by' => $me['name']];
    // updatedAt no futuro = contagem para o play: até lá, o vídeo fica parado no mesmo segundo.
    $at = fn() => $state['playing'] ? $state['position'] + max(0, $now - $state['updatedAt']) / 1000 : $state['position'];
    // Netflix e HBO Max: a extensão conta a duração e o segundo em que o player de lá está.
    $reported = isset($body['position']) ? max(0, min(86400, (float) $body['position'])) : null;
    if ($op !== 'start' && in_array($state['now']['source'] ?? '', ['netflix', 'max'], true) && (float) ($body['duration'] ?? 0) > 0) {
        $state['now']['duration'] = min(86400, (float) $body['duration']);
    }
    switch ($op) {
        case 'start':
            // O mesmo filme ou episódio que já está na sala (as duas extensões avisando juntas): nada muda.
            $streamed = in_array($item['source'], ['netflix', 'max'], true);
            if ($streamed && ($state['now']['url'] ?? '') === ($item['url'] ?? '')) return ['ok' => true, 'state' => watch_public($state), 'action' => ['op' => 'same', 'by' => $me['name']]];
            // Da extensão vem também o segundo em que o player de lá já está.
            $state = ['now' => $item, 'playing' => true, 'position' => $streamed ? ($reported ?? 0) : 0, 'updatedAt' => $now, 'browsing' => null, 'recent' => watch_recent($state['recent'], $item)];
            $action['item'] = $item;
            // Os dois sons juntos não dá: a música pausa.
            $music = music_state(true);
            if ($music['now'] && $music['playing']) {
                $music['position'] += ($now - $music['updatedAt']) / 1000;
                $music['playing'] = false;
                $music['updatedAt'] = $now;
                save_music($music);
                emit('music', ['state' => music_public($music), 'action' => ['op' => 'pause', 'by' => $me['name']]]);
            }
            break;
        case 'pause':
        case 'ended':
            if (!$state['now']) return ['ok' => false, 'error' => 'Nenhum vídeo agora.'];
            if ($op === 'ended' && ($state['now']['uid'] ?? '') !== str($body['uid'] ?? '')) return ['ok' => true, 'state' => watch_public($state)];
            if ($state['playing']) {
                $state['position'] = $reported ?? $at();
                $state['playing'] = false;
                $state['updatedAt'] = $now;
            }
            break;
        case 'resume':
            if (!$state['now']) return ['ok' => false, 'error' => 'Nenhum vídeo agora.'];
            if (!$state['playing']) {
                if ($reported !== null) $state['position'] = $reported;
                $state['playing'] = true;
                $state['updatedAt'] = $now;
            }
            break;
        case 'countdown':
            // Contagem 3, 2, 1 para os dois darem o play juntos (Netflix e HBO Max no celular).
            if (!$state['now']) return ['ok' => false, 'error' => 'Nenhum vídeo agora.'];
            $state['position'] = $at();
            $state['playing'] = true;
            $state['updatedAt'] = $now + 4000;
            $action['at'] = $state['updatedAt'];
            break;
        case 'seek':
            if (!$state['now']) return ['ok' => false, 'error' => 'Nenhum vídeo agora.'];
            $state['position'] = max(0, min(86400, (float) ($body['position'] ?? 0)));
            $state['updatedAt'] = $now;
            break;
        case 'browse':
            // Abriu um serviço no catálogo da sala (ou voltou: sem serviço). Cada um tem o seu: os dois podem estar escolhendo.
            $service = str($body['service'] ?? '');
            $browsing = is_array($state['browsing']) ? $state['browsing'] : [];
            unset($browsing[$me['name']]);
            if (in_array($service, WATCH_SERVICES, true)) $browsing[$me['name']] = ['service' => $service, 'at' => $now];
            $state['browsing'] = $browsing ?: null;
            break;
        case 'stop':
            $state = array_merge(watch_blank(), ['recent' => $state['recent']]);
            break;
        default:
            return ['ok' => false, 'error' => 'Comando desconhecido.'];
    }
    save_watch($state);
    $public = watch_public($state);
    emit('watch', ['state' => $public, 'action' => $action]);
    return ['ok' => true, 'state' => $public, 'action' => $action];
}

// ---------- papel de parede ----------

// Iluminação (-100 escurece, +100 clareia), desfoque (px) e quanto da cor do tema vai por cima (%).
function clean_wallpaper_style($style): array
{
    $style = is_array($style) ? $style : [];
    $number = function (string $key, int $min, int $max, int $default) use ($style): int {
        $value = $style[$key] ?? $default;
        return is_numeric($value) ? max($min, min($max, (int) round((float) $value))) : $default;
    };
    return ['light' => $number('light', -100, 100, -30), 'blur' => $number('blur', 0, 20, 0), 'tint' => $number('tint', 0, 80, 20)];
}

function wallpaper_info(?array $account): ?array
{
    if (!$account || empty($account['wallpaper_key'])) return null;
    return [
        'url' => 'api.php?action=wallpaper&k=' . $account['wallpaper_key'],
        'style' => clean_wallpaper_style(json_decode((string) $account['wallpaper_style'], true)),
    ];
}

// Só muda para a própria pessoa (em todos os aparelhos dela). Sem image = só os ajustes; image null = remove.
function set_wallpaper(array $me, array $body): array
{
    $name = $me['name'];
    if (array_key_exists('image', $body) && $body['image'] === null) {
        query('UPDATE ' . t('users') . ' SET wallpaper = NULL, wallpaper_type = NULL, wallpaper_key = NULL, wallpaper_style = NULL WHERE name = ?', [$name]);
        emit('wallpaper', ['wallpaper' => null], 'self', $me);
        return ['ok' => true, 'wallpaper' => null];
    }
    $style = encode(clean_wallpaper_style($body['style'] ?? null));
    if (isset($body['image'])) {
        $image = $body['image'];
        if (!is_string($image) || !preg_match('#^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$#', $image, $match)) {
            return ['ok' => false, 'error' => 'Formato de imagem não aceito.'];
        }
        $raw = base64_decode($match[2], true);
        if ($raw === false || strlen($raw) > WALLPAPER_MAX) return ['ok' => false, 'error' => 'Imagem grande demais.'];
        $info = @getimagesizefromstring($raw);
        if (!$info || $info['mime'] !== 'image/' . $match[1] || $info[0] < 64 || $info[1] < 64 || $info[0] > 4096 || $info[1] > 4096) {
            return ['ok' => false, 'error' => 'Imagem inválida.'];
        }
        // Chave nova a cada foto: o endereço muda e o navegador não fica com a antiga no cache.
        $key = bin2hex(random_bytes(16));
        query('UPDATE ' . t('users') . ' SET wallpaper = ?, wallpaper_type = ?, wallpaper_key = ?, wallpaper_style = ? WHERE name = ?', [base64_encode($raw), $info['mime'], $key, $style, $name]);
    } else {
        if (empty(find_account($name)['wallpaper_key'])) return ['ok' => false, 'error' => 'Escolha uma foto primeiro.'];
        query('UPDATE ' . t('users') . ' SET wallpaper_style = ? WHERE name = ?', [$style, $name]);
    }
    $wallpaper = wallpaper_info(find_account($name));
    emit('wallpaper', ['wallpaper' => $wallpaper], 'self', $me);
    return ['ok' => true, 'wallpaper' => $wallpaper];
}

function find_wallpaper(string $key): ?array
{
    if (!preg_match('/^[0-9a-f]{32}$/', $key)) return null;
    $row = query('SELECT wallpaper, wallpaper_type FROM ' . t('users') . ' WHERE wallpaper_key = ?', [$key])->fetch();
    return $row ? ['type' => $row['wallpaper_type'], 'data' => (string) base64_decode($row['wallpaper'])] : null;
}

// ---------- fotos e arquivos ----------

// "8M", "512K", "1G" → bytes. 0 = sem limite.
function ini_bytes(string $value): int
{
    $value = trim($value);
    $number = (int) $value;
    switch (strtolower(substr($value, -1))) {
        case 'g': return $number * 1073741824;
        case 'm': return $number * 1048576;
        case 'k': return $number * 1024;
    }
    return $number;
}

// Maior arquivo aceito: FILE_MAX, mas nunca mais do que o PHP (post_max_size) e o MySQL (max_allowed_packet) da hospedagem aguentam.
function file_max(): int
{
    static $max = null;
    if ($max !== null) return $max;
    $max = FILE_MAX;
    $post = ini_bytes((string) ini_get('post_max_size'));
    if ($post > 0) $max = min($max, $post - 65536);
    $packet = (int) query('SELECT @@max_allowed_packet')->fetchColumn();
    if ($packet > 0) $max = min($max, $packet - 65536);
    return $max = max(0, $max);
}

function file_url(string $key): string
{
    return 'api.php?action=file&k=' . $key;
}

// O que o arquivo realmente é, pelos primeiros bytes (o tipo informado pelo navegador não vale).
// Só imagem, vídeo e áudio reconhecidos abrem no chat; o resto vira arquivo para baixar.
function sniff_file(string $raw): array
{
    $info = @getimagesizefromstring($raw);
    if ($info && in_array($info['mime'], ['image/jpeg', 'image/png', 'image/gif', 'image/webp'], true) && $info[0] > 0 && $info[1] > 0) {
        return ['kind' => 'image', 'type' => $info['mime'], 'width' => $info[0], 'height' => $info[1]];
    }
    $head = substr($raw, 0, 12);
    if (substr($head, 4, 4) === 'ftyp') {
        $brand = substr($head, 8, 4);
        if (in_array($brand, ['M4A ', 'M4B '], true) || mp4_only_sound($raw)) return ['kind' => 'audio', 'type' => 'audio/mp4'];
        return ['kind' => 'video', 'type' => $brand === 'qt  ' ? 'video/quicktime' : 'video/mp4'];
    }
    if (strncmp($head, "\x1A\x45\xDF\xA3", 4) === 0) {
        return webm_only_sound($raw) ? ['kind' => 'audio', 'type' => 'audio/webm'] : ['kind' => 'video', 'type' => 'video/webm'];
    }
    if (strncmp($head, 'OggS', 4) === 0) return ['kind' => 'audio', 'type' => 'audio/ogg'];
    if (strncmp($head, 'RIFF', 4) === 0 && substr($head, 8, 4) === 'WAVE') return ['kind' => 'audio', 'type' => 'audio/wav'];
    if (strncmp($head, 'ID3', 3) === 0 || (strlen($head) > 1 && ord($head[0]) === 0xFF && (ord($head[1]) & 0xE0) === 0xE0)) {
        return ['kind' => 'audio', 'type' => 'audio/mpeg'];
    }
    return ['kind' => 'file', 'type' => 'application/octet-stream'];
}

// MP4 só com som: o Chrome e o Safari gravam áudio em MP4 com marca de vídeo (isom, mp42), então vale o tipo
// de cada faixa (caixa hdlr: "soun" ou "vide"), que pode estar no fim do arquivo.
function mp4_only_sound(string $raw): bool
{
    $sound = false;
    for ($at = strpos($raw, 'hdlr'); $at !== false; $at = strpos($raw, 'hdlr', $at + 4)) {
        $handler = substr($raw, $at + 12, 4);
        if ($handler === 'vide') return false;
        $sound = $sound || $handler === 'soun';
    }
    return $sound;
}

// WebM só com som (como o Chrome e o Firefox gravam áudio). As faixas ficam antes do primeiro Cluster:
// codec A_… ou TrackType 2 é som; V_… ou TrackType 1 é vídeo.
function webm_only_sound(string $raw): bool
{
    $cluster = strpos($raw, "\x1F\x43\xB6\x75");
    $head = substr($raw, 0, $cluster === false ? 65536 : min($cluster, 65536));
    return preg_match('/\x86[\x81-\xA0]A_|\x83\x81\x02/', $head) === 1 && preg_match('/\x86[\x81-\xA0]V_|\x83\x81\x01/', $head) === 0;
}

function clean_file_name(string $name): string
{
    $name = preg_replace('/[\x00-\x1F\x7F\/\\\\:*?"<>|]+/u', '_', $name) ?? '';
    $name = text_slice(text_trim($name), 120);
    return trim($name, '. ') === '' ? 'arquivo' : $name;
}

// Arquivo recebido em api.php?action=upload. Fica sem mensagem até a pessoa mandar a mensagem com ele.
function save_file(string $owner, string $name, string $raw): array
{
    $recent = (int) query('SELECT COUNT(*) FROM ' . t('files') . ' WHERE owner = ? AND created_at > ?', [$owner, now_ms() - 600000])->fetchColumn();
    if ($recent >= FILE_UPLOADS_PER_10_MIN) return ['ok' => false, 'error' => 'Calma! Muitos arquivos em pouco tempo.'];
    $file = sniff_file($raw) + ['width' => null, 'height' => null, 'name' => clean_file_name($name), 'size' => strlen($raw)];
    $key = bin2hex(random_bytes(16));
    query(
        'INSERT INTO ' . t('files') . ' (file_key, owner, name, type, kind, size, width, height, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [$key, $owner, $file['name'], $file['type'], $file['kind'], $file['size'], $file['width'], $file['height'], $raw, now_ms()]
    );
    return ['ok' => true, 'file' => ['key' => $key] + $file];
}

function find_file(string $key): ?array
{
    if (!preg_match('/^[0-9a-f]{32}$/', $key)) return null;
    $row = query('SELECT name, type, kind, data FROM ' . t('files') . ' WHERE file_key = ?', [$key])->fetch();
    return $row ?: null;
}

// Dados do arquivo guardados na mensagem (coluna media), com o endereço para baixar.
function file_info(array $file): array
{
    $info = [
        'url' => file_url((string) $file['key']),
        'name' => (string) $file['name'],
        'type' => (string) $file['type'],
        'kind' => (string) $file['kind'],
        'size' => (int) $file['size'],
        'width' => isset($file['width']) ? (int) $file['width'] : null,
        'height' => isset($file['height']) ? (int) $file['height'] : null,
    ];
    if (isset($file['voice']) && is_array($file['voice'])) $info['voice'] = $file['voice'];
    return $info;
}

// Mensagem de voz gravada no chat: duração (segundos) e forma de onda (barras de 0 a 100), para o player
// aparecer pronto antes de o áudio baixar. null = não é de voz (vira um áudio comum).
function clean_voice($voice): ?array
{
    if (!is_array($voice) || !is_array($voice['peaks'] ?? null)) return null;
    $duration = round((float) str($voice['duration'] ?? ''), 1);
    if ($duration <= 0 || $duration > VOICE_MAX) return null;
    $peaks = array_map(fn($peak) => max(0, min(100, (int) str($peak))), array_slice(array_values($voice['peaks']), 0, VOICE_PEAKS));
    return ['duration' => $duration, 'peaks' => $peaks];
}

// Transcreve uma mensagem de voz (qualquer um dos dois pode pedir). O texto fica na mensagem (voice.text) e
// chega para os dois; pedir de novo devolve o que já foi feito. Roda fora da trava do banco: a API leva uns segundos.
function transcribe_message(string $id): array
{
    if (str(config()['transcribe_key']) === '') return ['ok' => false, 'error' => 'A transcrição ainda não foi ativada: falta a chave no config.php (veja o LEIA-ME).'];
    $voiceFile = function (?array $row): ?array {
        $media = $row && !$row['deleted'] && !empty($row['media']) ? json_decode((string) $row['media'], true) : null;
        return is_array($media['file']['voice'] ?? null) ? $media : null;
    };
    $media = $voiceFile(find_message($id));
    if (!$media) return ['ok' => false, 'error' => 'Só dá para transcrever mensagens de voz.'];
    if (isset($media['file']['voice']['text'])) return ['ok' => true, 'text' => $media['file']['voice']['text']];
    $audio = query('SELECT type, data FROM ' . t('files') . ' WHERE file_key = ?', [$media['file']['key']])->fetch();
    if (!$audio) return ['ok' => false, 'error' => 'Esse áudio não está mais no servidor.'];
    try {
        $text = speech_to_text((string) $audio['data'], (string) $audio['type']);
    } catch (RuntimeException $error) {
        return ['ok' => false, 'error' => $error->getMessage()];
    }
    return transaction(function () use ($id, $text, $voiceFile) {
        $row = find_message($id);
        $media = $voiceFile($row);
        if (!$media) return ['ok' => false, 'error' => 'A mensagem foi apagada.'];
        $media['file']['voice']['text'] = $text;
        $row['media'] = encode($media);
        query('UPDATE ' . t('messages') . ' SET media = ? WHERE n = ?', [$row['media'], $row['n']]);
        emit('message:update', to_message($row));
        return ['ok' => true, 'text' => $text];
    });
}

// Áudio → texto pela API configurada (Groq, OpenAI ou outra no mesmo formato). Falha vira RuntimeException com o motivo.
function speech_to_text(string $audio, string $type): string
{
    $config = config();
    $extension = ['audio/mp4' => 'm4a', 'video/mp4' => 'mp4', 'audio/webm' => 'webm', 'video/webm' => 'webm', 'audio/ogg' => 'ogg', 'audio/wav' => 'wav', 'audio/mpeg' => 'mp3'][$type] ?? 'webm';
    $boundary = 'potato-' . bin2hex(random_bytes(12));
    $body = '';
    foreach (['model' => str($config['transcribe_model']), 'language' => 'pt', 'response_format' => 'json'] as $field => $value) {
        $body .= "--$boundary\r\nContent-Disposition: form-data; name=\"$field\"\r\n\r\n$value\r\n";
    }
    $body .= "--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.$extension\"\r\nContent-Type: $type\r\n\r\n$audio\r\n--$boundary--\r\n";
    $headers = ['Authorization: Bearer ' . str($config['transcribe_key']), "Content-Type: multipart/form-data; boundary=$boundary", 'Accept: application/json'];
    [$status, $response] = http_post(str($config['transcribe_url']), $headers, $body, 90);
    $data = json_decode($response, true);
    if ($status === 200 && is_array($data) && isset($data['text'])) return text_slice(text_trim(str($data['text'])), 10000);
    error_log("Potato Chat: a transcrição falhou (HTTP $status): " . text_slice(is_array($data) ? str($data['error']['message'] ?? '') : $response, 300));
    throw new RuntimeException($status === 401 || $status === 403 ? 'O serviço de transcrição não aceitou a chave do config.php.'
        : ($status === 429 ? 'Muitas transcrições agora. Tente de novo daqui a pouco.'
        : ($status === 0 ? 'O servidor não conseguiu falar com o serviço de transcrição.' : 'O serviço de transcrição não conseguiu transcrever esse áudio.')));
}

// ---------- nosso cantinho: o dia de cada um, agenda, sonhos e metas, cartinhas ----------
// Tudo na tabela items, um registro por coisa, com os detalhes em JSON (data):
//   day    → o dia de uma pessoa (owner) numa data (day): hora em que acordou, refeições (com foto), hábitos feitos,
//            humor, momentos (fotos com legenda) e como foi o dia. Só a própria pessoa muda o dia dela;
//   event  → compromisso da agenda (day = a data). Os dois mudam e apagam qualquer um;
//   goal   → sonho ou meta dos dois, com dinheiro guardado e/ou passos;
//   letter → cartinha para a outra pessoa (só quem escreveu muda ou apaga);
//   prefs  → de cada pessoa: os hábitos da rotina, os horários dos lembretes e os lembretes já mostrados.
// As fotos ficam na tabela files, como as das mensagens, com o id do registro no lugar de message_id.

const MEALS = ['cafe', 'almoco', 'lanche', 'jantar'];
// Lembretes da rotina e o horário padrão de cada um (null = desligado). "rotina" só aparece para quem tem hábitos.
const PROMPTS = ['acordar' => '09:30', 'cafe' => '10:30', 'almoco' => '13:30', 'lanche' => null, 'jantar' => '20:30', 'rotina' => '22:00'];
const PROMPT_TEXT = [
    'acordar' => ['Bom dia!', 'Que horas você acordou? Responda aqui mesmo (ex.: 7:30).'],
    'cafe' => ['Café da manhã', 'O que você tomou de café hoje?'],
    'almoco' => ['Almoço', 'O que você almoçou hoje?'],
    'lanche' => ['Lanchinho', 'Bateu a fome? O que foi o lanche?'],
    'jantar' => ['Jantar', 'E o jantar, o que foi?'],
    'rotina' => ['Rotina do dia', 'Fez suas coisinhas hoje?'],
];
// Ícones que dá para escolher (nomes dos ícones do sprite no index.php; mesmas listas do app.js) e os humores do dia.
const EVENT_ICONS = ['calendar', 'heart', 'film', 'utensils', 'cake', 'plane', 'gift', 'stethoscope', 'graduation', 'briefcase', 'cart', 'dumbbell'];
const GOAL_ICONS = ['sparkles', 'palmtree', 'plane', 'home', 'dog', 'gem', 'car', 'graduation', 'piggy', 'gamepad', 'chef', 'globe'];
const MOODS = ['feliz', 'rindo', 'amor', 'energia', 'deboa', 'sono', 'triste', 'raiva', 'doente'];
const HABITS_MAX = 12;
const MOMENTS_MAX = 8;
const STEPS_MAX = 20;
const LETTER_MAX = 20000;
const REPEATS = ['none', 'weekly', 'monthly', 'yearly'];
// Minutos antes do compromisso (0 = na hora; 1440 = um dia antes).
const REMINDERS = [0, 15, 30, 60, 120, 1440];
const PAPERS = ['creme', 'rosa', 'azul', 'lilas', 'verde'];

function clean_day($value): ?string
{
    $value = str($value);
    return preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $match) && checkdate((int) $match[2], (int) $match[3], (int) $match[1]) ? $value : null;
}

function clean_clock($value): ?string
{
    return preg_match('/^([01]?\d|2[0-3]):([0-5]\d)$/', str($value), $match) ? sprintf('%02d:%s', $match[1], $match[2]) : null;
}

// Uma linha só (título, o que comeu, legenda).
function clean_line($value, int $max): string
{
    return text_slice(text_trim(preg_replace('/\s+/u', ' ', str($value)) ?? ''), $max);
}

// Texto com várias linhas (cartinha, como foi o dia): no máximo duas linhas em branco seguidas.
function clean_body($value, int $max): string
{
    $text = str_replace(["\r\n", "\r"], "\n", str($value));
    return text_slice(text_trim(preg_replace("/\n{4,}/", "\n\n\n", $text) ?? $text), $max);
}

// Uma das opções da lista (ícone ou humor); fora dela, o padrão.
function clean_choice($value, array $allowed, ?string $default): ?string
{
    return in_array($value, $allowed, true) ? $value : $default;
}

function clean_money($value): ?float
{
    return is_int($value) || is_float($value) || (is_string($value) && is_numeric($value)) ? round(max(-1e9, min(1e9, (float) $value)), 2) : null;
}

function find_item(string $kind, string $id): ?array
{
    if (!preg_match('/^[0-9a-f-]{36}$/', $id)) return null;
    $row = query('SELECT * FROM ' . t('items') . ' WHERE id = ? AND kind = ?', [$id, $kind])->fetch();
    return $row ?: null;
}

// O registro de uma pessoa que é um só (prefs) ou um por dia (day).
function own_item(string $kind, string $owner, ?string $day = null): ?array
{
    $row = query('SELECT * FROM ' . t('items') . ' WHERE kind = ? AND owner = ? AND day <=> ? ORDER BY n LIMIT 1', [$kind, $owner, $day])->fetch();
    return $row ?: null;
}

function item_data(array $row): array
{
    $data = json_decode((string) $row['data'], true);
    return is_array($data) ? $data : [];
}

// Grava (ou cria, com o id já escolhido) e devolve a linha como ficou.
function save_item(?array $row, string $id, string $kind, string $owner, ?string $day, array $data): array
{
    $now = iso();
    if ($row) {
        query('UPDATE ' . t('items') . ' SET day = ?, data = ?, updated_at = ? WHERE n = ?', [$day, encode($data), $now, $row['n']]);
        return array_merge($row, ['day' => $day, 'data' => encode($data), 'updated_at' => $now]);
    }
    query('INSERT INTO ' . t('items') . ' (id, kind, owner, day, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [$id, $kind, $owner, $day, encode($data), $now, $now]);
    return ['id' => $id, 'kind' => $kind, 'owner' => $owner, 'day' => $day, 'data' => encode($data), 'created_at' => $now, 'updated_at' => $now];
}

function delete_item(array $row): void
{
    query('DELETE FROM ' . t('items') . ' WHERE n = ?', [$row['n']]);
    query('DELETE FROM ' . t('files') . ' WHERE message_id = ?', [$row['id']]);
}

// O que vai para o navegador: os detalhes, com o id, quem criou e quando.
function item_public(array $row): array
{
    return ['id' => $row['id'], 'owner' => $row['owner'], 'createdAt' => $row['created_at'], 'updatedAt' => $row['updated_at']] + item_data($row);
}

// Foto de um registro: a chave de uma imagem enviada por api.php?action=upload (ainda solta, de quem está salvando)
// ou que já é do registro. Devolve o que fica guardado, ou null.
function item_photo($photo, string $owner, string $itemId): ?array
{
    $key = is_array($photo) ? str($photo['key'] ?? '') : str($photo);
    if (!preg_match('/^[0-9a-f]{32}$/', $key)) return null;
    $file = query('SELECT width, height FROM ' . t('files') . " WHERE file_key = ? AND kind = 'image' AND (message_id = ? OR (message_id IS NULL AND owner = ?))", [$key, $itemId, $owner])->fetch();
    return $file ? ['key' => $key, 'url' => file_url($key), 'width' => (int) $file['width'], 'height' => (int) $file['height']] : null;
}

// Prende as fotos ao registro (não são mais apagadas como envio abandonado) e apaga as que saíram dele.
function keep_photos(string $itemId, string $owner, array $keys): void
{
    $keys = array_values(array_unique($keys));
    $marks = implode(', ', array_fill(0, count($keys), '?'));
    query('DELETE FROM ' . t('files') . ' WHERE message_id = ?' . ($keys ? " AND file_key NOT IN ($marks)" : ''), array_merge([$itemId], $keys));
    if ($keys) query('UPDATE ' . t('files') . " SET message_id = ? WHERE message_id IS NULL AND owner = ? AND file_key IN ($marks)", array_merge([$itemId, $owner], $keys));
}

function peer_of(string $name): ?string
{
    foreach (users() as $user) if ($user !== $name) return $user;
    return null;
}

// ---- preferências de cada um: hábitos, lembretes e lembretes já mostrados ----

function prefs_data(string $name): array
{
    $row = own_item('prefs', $name);
    $data = $row ? item_data($row) : [];
    $prompts = is_array($data['prompts'] ?? null) ? array_intersect_key($data['prompts'], PROMPTS) : [];
    return [
        'habits' => is_array($data['habits'] ?? null) ? $data['habits'] : [],
        'prompts' => array_merge(PROMPTS, $prompts),
        'fired' => is_array($data['fired'] ?? null) ? $data['fired'] : [],
    ];
}

function save_prefs(string $name, array $prefs): void
{
    $row = own_item('prefs', $name);
    save_item($row, $row['id'] ?? uuid(), 'prefs', $name, null, $prefs);
}

function save_habits(array $me, $list): array
{
    $habits = [];
    foreach (array_slice(is_array($list) ? $list : [], 0, HABITS_MAX) as $habit) {
        if (!is_array($habit) || ($text = clean_line($habit['text'] ?? '', 60)) === '') continue;
        $id = preg_match('/^[a-z0-9]{6,16}$/', str($habit['id'] ?? '')) ? $habit['id'] : bin2hex(random_bytes(4));
        $habits[] = ['id' => $id, 'text' => $text];
    }
    $prefs = prefs_data($me['name']);
    $prefs['habits'] = $habits;
    save_prefs($me['name'], $prefs);
    emit('us', ['kind' => 'habits', 'by' => $me['name'], 'owner' => $me['name'], 'habits' => $habits]);
    return ['ok' => true, 'habits' => $habits];
}

function save_prompts(array $me, $prompts): array
{
    $prefs = prefs_data($me['name']);
    foreach (array_keys(PROMPTS) as $key) {
        if (is_array($prompts) && array_key_exists($key, $prompts)) $prefs['prompts'][$key] = clean_clock($prompts[$key]);
    }
    save_prefs($me['name'], $prefs);
    // Os outros aparelhos da pessoa (inclusive o app do Android em segundo plano) refazem a lista de lembretes.
    emit('us', ['kind' => 'prompts', 'by' => $me['name']], 'self', $me);
    return ['ok' => true, 'prompts' => $prefs['prompts']];
}

// ---- o dia de cada um ----

function day_public(?array $row, string $owner, string $day): array
{
    $data = array_merge(['wake' => null, 'meals' => [], 'done' => [], 'mood' => null, 'note' => '', 'moments' => []], $row ? item_data($row) : []);
    $data['meals'] = (object) $data['meals'];
    return ['owner' => $owner, 'day' => $day, 'updatedAt' => $row['updated_at'] ?? null] + $data;
}

function us_days(string $day): array
{
    $days = [];
    foreach (users() as $name) $days[$name] = day_public(own_item('day', $name, $day), $name, $day);
    return $days;
}

// Muda só o que veio: wake ("07:30" ou null), meal ({name, text, photo}), done (ids dos hábitos feitos), mood, note
// e moments ([{photo, text}]). Cada pessoa só muda o próprio dia.
function save_day(array $me, array $body): array
{
    $day = clean_day($body['day'] ?? null);
    if (!$day) return ['ok' => false, 'error' => 'Dia inválido.'];
    $row = own_item('day', $me['name'], $day);
    $id = $row['id'] ?? uuid();
    $data = (array) day_public($row, $me['name'], $day);
    unset($data['owner'], $data['day'], $data['updatedAt']);
    $data['meals'] = (array) $data['meals'];
    $meal = null;
    if (array_key_exists('wake', $body)) $data['wake'] = clean_clock($body['wake']);
    if (is_array($body['meal'] ?? null)) {
        $meal = str($body['meal']['name'] ?? '');
        if (!in_array($meal, MEALS, true)) return ['ok' => false, 'error' => 'Refeição desconhecida.'];
        $entry = array_filter(['text' => clean_line($body['meal']['text'] ?? '', 300), 'photo' => item_photo($body['meal']['photo'] ?? null, $me['name'], $id)]);
        if ($entry) $data['meals'][$meal] = $entry + ['at' => iso()];
        else unset($data['meals'][$meal]);
    }
    if (is_array($body['done'] ?? null)) {
        $done = array_map('str', $body['done']);
        $data['done'] = array_values(array_filter(array_column(prefs_data($me['name'])['habits'], 'id'), fn($id) => in_array($id, $done, true)));
    }
    if (array_key_exists('mood', $body)) $data['mood'] = clean_choice($body['mood'], MOODS, null);
    if (array_key_exists('note', $body)) $data['note'] = clean_body($body['note'], 2000);
    if (is_array($body['moments'] ?? null)) {
        $moments = [];
        foreach (array_slice($body['moments'], 0, MOMENTS_MAX) as $moment) {
            $photo = is_array($moment) ? item_photo($moment['photo'] ?? null, $me['name'], $id) : null;
            if ($photo) $moments[] = ['photo' => $photo, 'text' => clean_line($moment['text'] ?? '', 200)];
        }
        $data['moments'] = $moments;
    }
    $photos = array_merge(array_filter(array_map(fn($entry) => $entry['photo']['key'] ?? null, $data['meals'])), array_map(fn($moment) => $moment['photo']['key'], $data['moments']));
    $saved = save_item($row, $id, 'day', $me['name'], $day, $data);
    keep_photos($id, $me['name'], $photos);
    $item = day_public($saved, $me['name'], $day);
    emit('us', ['kind' => 'day', 'by' => $me['name'], 'item' => $item, 'meal' => $meal]);
    return ['ok' => true, 'item' => $item];
}

// "7", "7h", "7:30", "07h30", "7 e meia" → "07:30". Sem número, null.
function wake_time(string $text): ?string
{
    if (!preg_match('/(\d{1,2})(?:\s*[h:.]\s*(\d{2}))?/u', $text, $match)) return null;
    $minute = isset($match[2]) && $match[2] !== '' ? (int) $match[2] : (preg_match('/meia/iu', $text) ? 30 : 0);
    return (int) $match[1] < 24 && $minute < 60 ? sprintf('%02d:%02d', $match[1], $minute) : null;
}

// Resposta a um lembrete da rotina (direto na notificação do Android ou no aviso do site): a hora em que acordou
// (sem número = a hora do aparelho, clock), o que comeu (a foto que já estava fica) e, na rotina, todos os hábitos feitos.
function us_reply(array $me, array $body): array
{
    $field = str($body['field'] ?? '');
    $day = clean_day($body['day'] ?? null);
    $text = clean_line($body['text'] ?? '', 300);
    if (!$day) return ['ok' => false, 'error' => 'Dia inválido.'];
    if ($field === 'acordar') {
        $wake = wake_time($text) ?? clean_clock($body['clock'] ?? null);
        return $wake ? save_day($me, ['day' => $day, 'wake' => $wake]) : ['ok' => false, 'error' => 'Diga a hora (ex.: 7:30).'];
    }
    if (in_array($field, MEALS, true)) {
        if ($text === '') return ['ok' => false, 'error' => 'Conte o que você comeu.'];
        $photo = ((array) day_public(own_item('day', $me['name'], $day), $me['name'], $day)['meals'])[$field]['photo'] ?? null;
        return save_day($me, ['day' => $day, 'meal' => ['name' => $field, 'text' => $text, 'photo' => $photo]]);
    }
    if ($field === 'rotina') return save_day($me, ['day' => $day, 'done' => array_column(prefs_data($me['name'])['habits'], 'id')]);
    return ['ok' => false, 'error' => 'Lembrete desconhecido.'];
}

// ---- agenda ----

function clean_event(array $body): ?array
{
    $title = clean_line($body['title'] ?? '', 120);
    $date = clean_day($body['date'] ?? null);
    if ($title === '' || !$date) return null;
    $who = str($body['who'] ?? '');
    $remind = $body['remind'] ?? null;
    $time = clean_clock($body['time'] ?? null);
    // Até que horas (opcional): só com hora de começar, e depois dela.
    $end = $time ? clean_clock($body['end'] ?? null) : null;
    return [
        'title' => $title,
        'date' => $date,
        'time' => $time,
        'end' => $end !== null && $end > $time ? $end : null,
        'place' => clean_line($body['place'] ?? '', 120),
        'note' => clean_body($body['note'] ?? '', 1000),
        'icon' => clean_choice($body['icon'] ?? null, EVENT_ICONS, 'calendar'),
        'who' => in_array($who, users(), true) ? $who : 'ambos',
        'repeat' => in_array($body['repeat'] ?? '', REPEATS, true) ? $body['repeat'] : 'none',
        'remind' => in_array($remind, REMINDERS, true) ? $remind : null,
    ];
}

// O compromisso acontece nessa data? Toda semana, todo mês (dia 31 cai no último dia dos meses mais curtos) ou todo ano.
function event_on(array $event, string $date): bool
{
    if ($date === $event['date']) return true;
    if (($event['repeat'] ?? 'none') === 'none' || $date < $event['date']) return false;
    [$year, $month, $day] = array_map('intval', explode('-', $date));
    [, $startMonth, $startDay] = array_map('intval', explode('-', $event['date']));
    $last = (int) gmdate('t', gmmktime(0, 0, 0, $month, 1, $year));
    switch ($event['repeat']) {
        case 'weekly':
            return gmdate('w', strtotime("$date UTC")) === gmdate('w', strtotime("{$event['date']} UTC"));
        case 'monthly':
            return $day === min($startDay, $last);
        case 'yearly':
            return $month === $startMonth && $day === min($startDay, $last);
    }
    return false;
}

// ---- sonhos e metas ----

function clean_goal(array $body, array $old): ?array
{
    $title = clean_line($body['title'] ?? '', 120);
    if ($title === '') return null;
    $steps = [];
    foreach (array_slice(is_array($body['steps'] ?? null) ? $body['steps'] : [], 0, STEPS_MAX) as $step) {
        if (!is_array($step) || ($text = clean_line($step['text'] ?? '', 120)) === '') continue;
        $id = preg_match('/^[a-z0-9]{6,16}$/', str($step['id'] ?? '')) ? $step['id'] : bin2hex(random_bytes(4));
        $steps[] = ['id' => $id, 'text' => $text, 'done' => ($step['done'] ?? false) === true];
    }
    $target = clean_money($body['target'] ?? null);
    return [
        'title' => $title,
        'icon' => clean_choice($body['icon'] ?? null, GOAL_ICONS, 'sparkles'),
        'note' => clean_body($body['note'] ?? '', 1000),
        'target' => $target !== null && $target > 0 ? $target : null,
        'due' => clean_day($body['due'] ?? null),
        'steps' => $steps,
        'saved' => $old['saved'] ?? 0,
        'deposits' => $old['deposits'] ?? [],
        'done' => $old['done'] ?? false,
        'doneAt' => $old['doneAt'] ?? null,
    ];
}

// ---- cartinhas ----

// Na lista vai só o começo do texto; a cartinha inteira chega quando alguém abre (letter:open).
function letter_public(array $row, bool $full = false): array
{
    $item = item_public($row);
    if (!$full) {
        $item['preview'] = text_slice(preg_replace('/\s+/u', ' ', (string) ($item['body'] ?? '')) ?? '', 140);
        unset($item['body']);
    }
    return $item;
}

// ---- lembretes ----

// Lembretes das próximas 48 horas de quem pediu: os da rotina e os dos compromissos dela (ou dos dois). tz = minutos
// do fuso do aparelho em relação ao UTC (Brasília: -180). Se a rotina já foi respondida, quem decide é o us_claim.
function us_schedule(array $me, array $body): array
{
    $tz = max(-840, min(840, (int) ($body['tz'] ?? 0)));
    $now = now_ms();
    $at = fn(string $date, string $clock): int => (strtotime("$date $clock:00 UTC") - $tz * 60) * 1000;
    $today = gmdate('Y-m-d', intdiv($now, 1000) + $tz * 60);
    $dates = array_map(fn($offset) => gmdate('Y-m-d', strtotime("$today UTC") + $offset * 86400), [-1, 0, 1, 2]);
    $fits = fn(int $time): bool => $time > $now - 2 * 3600000 && $time < $now + 48 * 3600000;
    $list = [];
    foreach (prefs_data($me['name'])['prompts'] as $field => $clock) {
        foreach ([$dates[1], $dates[2]] as $date) {
            if (!$clock || !$fits($time = $at($date, $clock))) continue;
            [$title, $text] = PROMPT_TEXT[$field];
            $list[] = ['key' => "$date $field", 'at' => $time, 'kind' => 'prompt', 'field' => $field, 'day' => $date, 'title' => $title, 'text' => $text, 'reply' => $field !== 'rotina'];
        }
    }
    foreach (query('SELECT * FROM ' . t('items') . " WHERE kind = 'event'")->fetchAll() as $row) {
        $event = item_data($row);
        if (!in_array($event['who'] ?? 'ambos', ['ambos', $me['name']], true) || !isset($event['remind'])) continue;
        foreach ($dates as $date) {
            $start = $at($date, $event['time'] ?? '09:00');
            if (!event_on($event, $date) || !$fits($time = $start - $event['remind'] * 60000)) continue;
            $when = $event['remind'] === 0 ? 'Agora' : ($event['remind'] >= 1440 ? 'Amanhã' : 'Daqui a ' . ($event['remind'] < 60 ? "{$event['remind']} minutos" : ($event['remind'] === 60 ? '1 hora' : ($event['remind'] / 60) . ' horas')));
            $hours = $event['time'] ? $event['time'] . (empty($event['end']) ? '' : "–{$event['end']}") : '';
            $text = $when . ($hours ? ($event['remind'] >= 1440 ? ' às ' : ' · ') . $hours : ' (o dia todo)') . ($event['place'] !== '' ? " · {$event['place']}" : '');
            $list[] = ['key' => "ev {$row['id']} $date", 'at' => $time, 'kind' => 'event', 'id' => $row['id'], 'day' => $date, 'title' => $event['title'], 'text' => $text, 'reply' => false];
        }
    }
    usort($list, fn($a, $b) => $a['at'] <=> $b['at']);
    return ['ok' => true, 'items' => $list, 'serverNow' => $now];
}

// Antes de mostrar um lembrete (no app do Android ou no site aberto): só o primeiro aparelho que pedir mostra, e o da
// rotina só aparece se ainda não foi respondido. No da rotina dos hábitos, o texto diz o que falta.
function us_claim(array $me, array $body): array
{
    $key = text_slice(str($body['key'] ?? ''), 80);
    $prefs = prefs_data($me['name']);
    if ($key === '' || in_array($key, $prefs['fired'], true)) return ['ok' => true, 'fire' => false];
    $extra = [];
    if (preg_match('/^(\d{4}-\d{2}-\d{2}) ([a-z]+)$/', $key, $match)) {
        [, $day, $field] = $match;
        if (!array_key_exists($field, PROMPTS)) return ['ok' => true, 'fire' => false];
        $data = day_public(own_item('day', $me['name'], $day), $me['name'], $day);
        $pending = array_values(array_filter($prefs['habits'], fn($habit) => !in_array($habit['id'], $data['done'], true)));
        $answered = $field === 'acordar' ? $data['wake'] !== null : ($field === 'rotina' ? !$pending : isset(((array) $data['meals'])[$field]));
        if ($answered) return ['ok' => true, 'fire' => false];
        if ($field === 'rotina') $extra['text'] = 'Falta: ' . implode(', ', array_column(array_slice($pending, 0, 6), 'text')) . (count($pending) > 6 ? '…' : '');
    }
    $prefs['fired'] = array_slice(array_merge([$key], $prefs['fired']), 0, 300);
    save_prefs($me['name'], $prefs);
    return ['ok' => true, 'fire' => true] + $extra;
}

// ---- tudo junto ----

// Ao abrir: a agenda, os sonhos e metas, as cartinhas (sem o texto inteiro), os hábitos dos dois, os lembretes de
// quem pediu e o dia pedido (day) dos dois.
function us_load(array $me, array $body): array
{
    $result = ['ok' => true, 'events' => [], 'goals' => [], 'letters' => [], 'habits' => [], 'prompts' => PROMPTS];
    foreach (users() as $name) $result['habits'][$name] = [];
    foreach (query('SELECT * FROM ' . t('items') . " WHERE kind IN ('event', 'goal', 'letter', 'prefs') ORDER BY n")->fetchAll() as $row) {
        if ($row['kind'] === 'prefs') {
            $prefs = prefs_data($row['owner']);
            $result['habits'][$row['owner']] = $prefs['habits'];
            if ($row['owner'] === $me['name']) $result['prompts'] = $prefs['prompts'];
        } else {
            $result[$row['kind'] . 's'][] = $row['kind'] === 'letter' ? letter_public($row) : item_public($row);
        }
    }
    $result['habits'] = (object) $result['habits'];
    $day = clean_day($body['day'] ?? null);
    if ($day) $result['days'] = us_days($day);
    return $result;
}

function us_act(array $me, array $body): array
{
    $op = str($body['op'] ?? '');
    $id = str($body['id'] ?? '');
    switch ($op) {
        case 'load':
            return us_load($me, $body);

        case 'day':
            $day = clean_day($body['day'] ?? null);
            return $day ? ['ok' => true, 'days' => us_days($day)] : ['ok' => false, 'error' => 'Dia inválido.'];

        case 'day:save':
            return save_day($me, $body);

        case 'reply':
            return us_reply($me, $body);

        case 'habits':
            return save_habits($me, $body['habits'] ?? null);

        case 'prompts':
            return save_prompts($me, $body['prompts'] ?? null);

        case 'schedule':
            return us_schedule($me, $body);

        case 'claim':
            return us_claim($me, $body);

        case 'event:save':
            $row = $id !== '' ? find_item('event', $id) : null;
            if ($id !== '' && !$row) return ['ok' => false, 'error' => 'Esse compromisso foi apagado.'];
            $event = clean_event($body);
            if (!$event) return ['ok' => false, 'error' => 'Dê um nome e uma data para o compromisso.'];
            $item = item_public(save_item($row, $row['id'] ?? uuid(), 'event', $row['owner'] ?? $me['name'], $event['date'], $event));
            emit('us', ['kind' => 'event', 'by' => $me['name'], 'item' => $item, 'created' => !$row]);
            return ['ok' => true, 'item' => $item];

        case 'event:delete':
            $row = find_item('event', $id);
            if ($row) {
                delete_item($row);
                emit('us', ['kind' => 'event', 'by' => $me['name'], 'id' => $id, 'deleted' => true, 'title' => item_data($row)['title'] ?? '']);
            }
            return ['ok' => true];

        case 'goal:save':
            $row = $id !== '' ? find_item('goal', $id) : null;
            if ($id !== '' && !$row) return ['ok' => false, 'error' => 'Esse sonho foi apagado.'];
            $goal = clean_goal($body, $row ? item_data($row) : []);
            if (!$goal) return ['ok' => false, 'error' => 'Dê um nome para o sonho ou a meta.'];
            $item = item_public(save_item($row, $row['id'] ?? uuid(), 'goal', $row['owner'] ?? $me['name'], null, $goal));
            emit('us', ['kind' => 'goal', 'by' => $me['name'], 'item' => $item, 'action' => $row ? 'edit' : 'new']);
            return ['ok' => true, 'item' => $item];

        // Guardar (ou tirar, com valor negativo) dinheiro; marcar um passo; marcar como realizado.
        case 'goal:deposit':
        case 'goal:step':
        case 'goal:done':
            $row = find_item('goal', $id);
            if (!$row) return ['ok' => false, 'error' => 'Esse sonho foi apagado.'];
            $goal = item_data($row);
            $extra = [];
            if ($op === 'goal:deposit') {
                $amount = clean_money($body['amount'] ?? null);
                if (!$amount) return ['ok' => false, 'error' => 'Diga quanto.'];
                $amount = max($amount, -($goal['saved'] ?? 0));
                $goal['saved'] = round(($goal['saved'] ?? 0) + $amount, 2);
                $goal['deposits'] = array_slice(array_merge([['by' => $me['name'], 'amount' => $amount, 'at' => iso()]], $goal['deposits'] ?? []), 0, 30);
                $extra['amount'] = $amount;
            } elseif ($op === 'goal:step') {
                foreach ($goal['steps'] as &$step) if ($step['id'] === str($body['step'] ?? '')) $step['done'] = ($body['done'] ?? false) === true;
                unset($step);
            } else {
                $goal['done'] = ($body['done'] ?? false) === true;
                $goal['doneAt'] = $goal['done'] ? iso() : null;
            }
            $item = item_public(save_item($row, $row['id'], 'goal', $row['owner'], null, $goal));
            emit('us', ['kind' => 'goal', 'by' => $me['name'], 'item' => $item, 'action' => substr($op, 5)] + $extra);
            return ['ok' => true, 'item' => $item];

        case 'goal:delete':
            $row = find_item('goal', $id);
            if ($row) {
                delete_item($row);
                emit('us', ['kind' => 'goal', 'by' => $me['name'], 'id' => $id, 'deleted' => true]);
            }
            return ['ok' => true];

        case 'letter:save':
            $row = $id !== '' ? find_item('letter', $id) : null;
            if ($id !== '' && !$row) return ['ok' => false, 'error' => 'Essa cartinha foi apagada.'];
            if ($row && $row['owner'] !== $me['name']) return ['ok' => false, 'error' => 'Só quem escreveu muda a cartinha.'];
            $text = clean_body($body['body'] ?? '', LETTER_MAX);
            if ($text === '') return ['ok' => false, 'error' => 'Escreva alguma coisa na cartinha.'];
            $old = $row ? item_data($row) : [];
            $letter = [
                'title' => clean_line($body['title'] ?? '', 120) ?: 'Cartinha',
                'body' => $text,
                'paper' => in_array($body['paper'] ?? '', PAPERS, true) ? $body['paper'] : 'creme',
                'to' => $old['to'] ?? peer_of($me['name']),
                'readAt' => $old['readAt'] ?? null,
                'edited' => (bool) $row,
            ];
            $saved = save_item($row, $row['id'] ?? uuid(), 'letter', $me['name'], null, $letter);
            emit('us', ['kind' => 'letter', 'by' => $me['name'], 'item' => letter_public($saved), 'action' => $row ? 'edit' : 'new']);
            return ['ok' => true, 'item' => letter_public($saved, true)];

        // Abrir a cartinha inteira. A primeira vez que a outra pessoa abre, ela fica lida (quem escreveu vê).
        case 'letter:open':
            $row = find_item('letter', $id);
            if (!$row) return ['ok' => false, 'error' => 'Essa cartinha foi apagada.'];
            $letter = item_data($row);
            if ($row['owner'] !== $me['name'] && empty($letter['readAt'])) {
                $letter['readAt'] = iso();
                // Ler não conta como edição: a data de atualização continua a de quem escreveu.
                query('UPDATE ' . t('items') . ' SET data = ? WHERE n = ?', [encode($letter), $row['n']]);
                $row['data'] = encode($letter);
                emit('us', ['kind' => 'letter', 'by' => $me['name'], 'item' => letter_public($row), 'action' => 'read']);
            }
            return ['ok' => true, 'item' => letter_public($row, true)];

        case 'letter:delete':
            $row = find_item('letter', $id);
            if ($row && $row['owner'] !== $me['name']) return ['ok' => false, 'error' => 'Só quem escreveu apaga a cartinha.'];
            if ($row) {
                delete_item($row);
                emit('us', ['kind' => 'letter', 'by' => $me['name'], 'id' => $id, 'deleted' => true]);
            }
            return ['ok' => true];
    }
    return ['ok' => false, 'error' => 'Ação desconhecida.'];
}

// ---------- joguinhos ----------
// Cada jogo é uma mensagem na conversa (media.game, de quem começou), que muda a cada jogada (message:update).
// Cartas:
//   vd       → verdade ou desafio: a outra pessoa (for) escolhe, a carta aparece e ela responde no chat;
//   quem     → quem é mais provável…: cada um vota num dos dois;
//   isso     → isso ou aquilo: cada um escolhe uma das duas opções;
//   pergunta → perguntinha: os dois respondem.
// Votos e respostas só aparecem quando os dois tiverem votado ou respondido. As cartas vêm de lib/jogos.php e não
// se repetem até o baralho acabar (os já usados ficam na tabela de configurações, nome "games").
// Tabuleiro (seats: quem começou é a cadeira 0 e joga primeiro; o servidor confere cada jogada e a vez):
//   velha    → jogo da velha (X é quem começou);
//   dama     → dama (as brancas são de quem começou): pedra anda uma casa para a frente e captura para os dois
//              lados, dama anda e captura de longe, captura é obrigatória e continua enquanto der;
//   memoria  → jogo da memória: 8 pares de figuras; acertou, joga de novo. As cartas viradas para baixo nunca saem do servidor;
//   stop     → stop (adedonha): uma letra por rodada; quem preencher tudo pede STOP e a rodada acaba para os dois.
//              10 pontos por resposta certa, 5 se os dois escreveram a mesma.

const GAME_NAMES = [
    'vd' => 'Verdade ou desafio', 'quem' => 'Quem é mais provável?', 'isso' => 'Isso ou aquilo', 'pergunta' => 'Perguntinha',
    'velha' => 'Jogo da velha', 'dama' => 'Dama', 'memoria' => 'Jogo da memória', 'stop' => 'Stop',
];
// As figuras das cartas da memória (ícones do sprite no index.php).
const MEMORY_FACES = ['heart', 'star', 'dog', 'cat', 'pizza', 'flower', 'music', 'moon', 'sun', 'cloud', 'gift', 'coffee', 'fish', 'cherry', 'gem', 'cake'];
const STOP_CATEGORIES = ['Nome', 'Animal', 'Comida', 'Lugar', 'Objeto', 'Coisa fofa'];
const STOP_LETTERS = 'ABCDEFGHIJLMNOPRSTUV';
const TIC_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

// Dama: casas 0 a 63, linha a linha de cima para baixo. As brancas (w) começam embaixo e sobem; as pretas (b), em
// cima. Maiúscula = dama.
function dama_board(): array
{
    $board = array_fill(0, 64, '');
    foreach ($board as $index => $piece) {
        $row = intdiv($index, 8);
        if (($row + $index % 8) % 2 === 1 && $row !== 3 && $row !== 4) $board[$index] = $row < 3 ? 'b' : 'w';
    }
    return $board;
}

// Jogadas possíveis de uma cor ([from, to, over]: over = a peça capturada). Havendo captura, só valem as capturas;
// no meio de uma sequência (chain), só as capturas da peça que está capturando.
function dama_moves(array $board, string $color, ?int $chain = null): array
{
    $captures = [];
    $steps = [];
    $forward = $color === 'w' ? -1 : 1;
    $inside = fn(int $row, int $col): bool => $row >= 0 && $row < 8 && $col >= 0 && $col < 8;
    foreach ($board as $from => $piece) {
        if ($piece === '' || strtolower($piece) !== $color || ($chain !== null && $from !== $chain)) continue;
        $king = $piece !== strtolower($piece);
        foreach ([[-1, -1], [-1, 1], [1, -1], [1, 1]] as [$dr, $dc]) {
            $row = intdiv($from, 8) + $dr;
            $col = $from % 8 + $dc;
            // Casas vazias no caminho: a pedra anda uma (só para a frente), a dama quantas quiser.
            while ($inside($row, $col) && $board[$row * 8 + $col] === '') {
                if ($king || $dr === $forward) $steps[] = [$from, $row * 8 + $col, null];
                if (!$king) break;
                $row += $dr;
                $col += $dc;
            }
            if (!$inside($row, $col) || $board[$row * 8 + $col] === '' || strtolower($board[$row * 8 + $col]) === $color) continue;
            $over = $row * 8 + $col;
            for ($row += $dr, $col += $dc; $inside($row, $col) && $board[$row * 8 + $col] === ''; $row += $dr, $col += $dc) {
                $captures[] = [$from, $row * 8 + $col, $over];
                if (!$king) break;
            }
        }
    }
    return $captures || $chain !== null ? $captures : $steps;
}

function stop_letter(array $used): string
{
    $left = array_values(array_diff(str_split(STOP_LETTERS), $used));
    $left = $left ?: str_split(STOP_LETTERS);
    return $left[random_int(0, count($left) - 1)];
}

// Fim da rodada do stop: as respostas dos dois, os pontos (só vale a palavra que começa com a letra) e o placar.
function stop_score(array &$game, string $by): void
{
    $letter = fold($game['letter']);
    $answers = [];
    $points = [];
    foreach ($game['seats'] as $name) $answers[$name] = $game['fills'][$name] ?? array_fill_keys($game['categories'], '');
    foreach ($game['categories'] as $category) {
        $words = [];
        foreach ($game['seats'] as $name) {
            $word = fold(text_trim((string) ($answers[$name][$category] ?? '')));
            $words[$name] = $word !== '' && text_slice($word, 1) === $letter ? $word : null;
        }
        foreach ($game['seats'] as $index => $name) {
            $other = $words[$game['seats'][1 - $index]];
            $points[$name][$category] = $words[$name] === null ? 0 : ($words[$name] === $other ? 5 : 10);
        }
    }
    foreach ($game['seats'] as $name) $game['totals'][$name] += array_sum($points[$name]);
    $game['last'] = ['round' => $game['round'], 'letter' => $game['letter'], 'answers' => $answers, 'points' => $points, 'stoppedBy' => $by];
    $game['phase'] = 'review';
    $game['fills'] = [];
}

// Quem tem mais pontos ganha; igual, empate.
function best_of(array $scores): string
{
    arsort($scores);
    $names = array_keys($scores);
    return count($scores) > 1 && $scores[$names[0]] === $scores[$names[1]] ? 'empate' : (string) $names[0];
}

// Uma jogada num jogo de tabuleiro. Muda $game; devolve o erro, ou null.
function board_play(array &$game, string $me, string $op, array $body): ?string
{
    if ($game['winner'] ?? null) return 'Esse jogo já acabou.';
    if (!in_array($me, $game['seats'], true)) return 'Esse jogo é dos outros dois.';
    $seat = array_search($me, $game['seats'], true);
    $other = $game['seats'][1 - $seat];
    if ($op === 'resign') {
        $game['winner'] = $other;
        $game['resigned'] = $me;
        return null;
    }
    if ($game['type'] === 'stop') {
        if ($op === 'end') {
            $game['winner'] = best_of($game['totals']);
            $game['phase'] = 'over';
            return null;
        }
        if ($op === 'next') {
            if ($game['phase'] !== 'review') return 'A rodada ainda não acabou.';
            // As letras não se repetem até acabarem.
            $game['letter'] = stop_letter($game['used']);
            $game['used'] = count($game['used']) + 1 >= strlen(STOP_LETTERS) ? [$game['letter']] : array_merge($game['used'], [$game['letter']]);
            $game['round']++;
            $game['phase'] = 'playing';
            $game['fills'] = [];
            return null;
        }
        if ($op !== 'fill') return 'Jogada desconhecida.';
        if ($game['phase'] !== 'playing') return 'Essa rodada já acabou.';
        $answers = [];
        foreach ($game['categories'] as $category) $answers[$category] = clean_line($body['answers'][$category] ?? '', 40);
        $game['fills'][$me] = $answers;
        if (($body['stop'] ?? false) === true) {
            if (in_array('', $answers, true)) return 'Preencha tudo antes de pedir STOP!';
            stop_score($game, $me);
        }
        return null;
    }
    if ($game['turn'] !== $me) return 'Não é a sua vez.';
    switch ($game['type'] . ':' . $op) {
        case 'velha:move':
            $cell = $body['cell'] ?? null;
            if (!is_int($cell) || $cell < 0 || $cell > 8 || $game['board'][$cell] !== '') return 'Essa casa já foi.';
            $game['board'][$cell] = $seat === 0 ? 'X' : 'O';
            foreach (TIC_LINES as $line) {
                if ($game['board'][$line[0]] !== '' && $game['board'][$line[0]] === $game['board'][$line[1]] && $game['board'][$line[1]] === $game['board'][$line[2]]) {
                    $game['winner'] = $me;
                    $game['line'] = $line;
                    return null;
                }
            }
            if (!in_array('', $game['board'], true)) $game['winner'] = 'empate';
            else $game['turn'] = $other;
            return null;

        case 'dama:move':
            $from = $body['from'] ?? null;
            $to = $body['to'] ?? null;
            $color = $seat === 0 ? 'w' : 'b';
            $moves = dama_moves($game['board'], $color, $game['chain']);
            $move = null;
            foreach ($moves as $option) if ($option[0] === $from && $option[1] === $to) $move = $option;
            if (!$move) return $moves && $moves[0][2] !== null ? 'Captura obrigatória: tem peça para comer!' : 'Essa jogada não vale.';
            $board = &$game['board'];
            $board[$to] = $board[$from];
            $board[$from] = '';
            if ($move[2] !== null) $board[$move[2]] = '';
            $game['last'] = [$from, $to];
            // Comeu e ainda dá para comer com a mesma peça: continua (sem virar dama no meio do caminho).
            if ($move[2] !== null && dama_moves($board, $color, $to)) {
                $game['chain'] = $to;
                return null;
            }
            $game['chain'] = null;
            if ($board[$to] === 'w' && $to < 8) $board[$to] = 'W';
            if ($board[$to] === 'b' && $to >= 56) $board[$to] = 'B';
            if (!dama_moves($board, $seat === 0 ? 'b' : 'w')) $game['winner'] = $me;
            else $game['turn'] = $other;
            return null;

        case 'memoria:flip':
            $index = $body['index'] ?? null;
            if (!is_int($index) || $index < 0 || $index > 15 || $game['matched'][$index] !== null || in_array($index, $game['open'], true)) return 'Escolha outra carta.';
            $game['missed'] = null;
            $game['open'][] = $index;
            if (count($game['open']) < 2) return null;
            [$a, $b] = $game['open'];
            $game['open'] = [];
            if ($game['faces'][$a] !== $game['faces'][$b]) {
                // Errou: as duas ficam à mostra até a próxima carta, e a vez passa.
                $game['missed'] = [$a, $b];
                $game['turn'] = $other;
                return null;
            }
            $game['matched'][$a] = $game['matched'][$b] = $me;
            $game['scores'][$me]++;
            if (!in_array(null, $game['matched'], true)) $game['winner'] = best_of($game['scores']);
            return null;
    }
    return 'Jogada desconhecida.';
}

function draw_card(string $deck)
{
    static $decks = null;
    $decks = $decks ?? require __DIR__ . '/jogos.php';
    query('INSERT IGNORE INTO ' . t('settings') . " (name, value) VALUES ('games', '{}')");
    $used = json_decode((string) query('SELECT value FROM ' . t('settings') . " WHERE name = 'games' FOR UPDATE")->fetchColumn(), true) ?: [];
    $left = array_values(array_diff(array_keys($decks[$deck]), (array) ($used[$deck] ?? [])));
    if (!$left) {
        $used[$deck] = [];
        $left = array_keys($decks[$deck]);
    }
    $index = $left[random_int(0, count($left) - 1)];
    $used[$deck][] = $index;
    query('UPDATE ' . t('settings') . " SET value = ? WHERE name = 'games'", [encode($used)]);
    return $decks[$deck][$index];
}

// O que vai para o navegador: enquanto falta alguém, os votos e as respostas ficam escondidos (players diz quem já foi).
// Na memória, só as cartas viradas para cima; no stop, só quantas respostas cada um já preencheu; na dama, as
// jogadas que valem agora (para o tabuleiro mostrar).
function game_public(array $game): array
{
    foreach (['votes', 'answers'] as $field) {
        if (!array_key_exists($field, $game)) continue;
        $game['players'] = array_keys((array) $game[$field]);
        $game['done'] = count($game['players']) >= 2;
        $game[$field] = (object) ($game['done'] ? $game[$field] : []);
    }
    switch ($game['type']) {
        case 'dama':
            $color = $game['seats'][0] === $game['turn'] ? 'w' : 'b';
            $game['moves'] = $game['winner'] ? [] : array_map(fn($move) => [$move[0], $move[1]], dama_moves($game['board'], $color, $game['chain']));
            break;
        case 'memoria':
            $shown = array_merge($game['open'], $game['missed'] ?? []);
            $game['cards'] = array_map(fn($face, $index) => $game['matched'][$index] !== null || in_array($index, $shown, true) ? $face : null, $game['faces'], array_keys($game['faces']));
            $game['scores'] = (object) $game['scores'];
            unset($game['faces']);
            break;
        case 'stop':
            $game['filled'] = (object) array_map(fn($fill) => count(array_filter($fill, fn($text) => $text !== '')), $game['fills']);
            $game['totals'] = (object) $game['totals'];
            unset($game['fills'], $game['used']);
            break;
    }
    return $game;
}

function game_act(array $me, array $body): array
{
    $op = str($body['op'] ?? '');
    if ($op === 'new') {
        $type = str($body['type'] ?? '');
        $peer = peer_of($me['name']);
        if (!$peer) return ['ok' => false, 'error' => 'Os joguinhos começam quando a outra pessoa criar a conta dela.'];
        switch ($type) {
            case 'vd':
                $game = ['type' => 'vd', 'for' => $peer, 'choice' => null, 'prompt' => null];
                break;
            case 'quem':
            case 'pergunta':
                $game = ['type' => $type, 'prompt' => draw_card($type), ($type === 'quem' ? 'votes' : 'answers') => []] + ($type === 'quem' ? ['names' => [$me['name'], $peer]] : []);
                break;
            case 'isso':
                $game = ['type' => 'isso', 'options' => draw_card('isso'), 'votes' => []];
                break;
            case 'velha':
                $game = ['type' => 'velha', 'seats' => [$me['name'], $peer], 'turn' => $me['name'], 'board' => array_fill(0, 9, ''), 'winner' => null, 'line' => null];
                break;
            case 'dama':
                $game = ['type' => 'dama', 'seats' => [$me['name'], $peer], 'turn' => $me['name'], 'board' => dama_board(), 'chain' => null, 'last' => null, 'winner' => null];
                break;
            case 'memoria':
                $faces = MEMORY_FACES;
                shuffle($faces);
                $faces = array_merge(array_slice($faces, 0, 8), array_slice($faces, 0, 8));
                shuffle($faces);
                $game = ['type' => 'memoria', 'seats' => [$me['name'], $peer], 'turn' => $me['name'], 'faces' => $faces, 'matched' => array_fill(0, 16, null),
                    'open' => [], 'missed' => null, 'scores' => [$me['name'] => 0, $peer => 0], 'winner' => null];
                break;
            case 'stop':
                $letter = stop_letter([]);
                $game = ['type' => 'stop', 'seats' => [$me['name'], $peer], 'round' => 1, 'letter' => $letter, 'used' => [$letter], 'categories' => STOP_CATEGORIES,
                    'phase' => 'playing', 'fills' => [], 'last' => null, 'totals' => [$me['name'] => 0, $peer => 0], 'winner' => null];
                break;
            default:
                return ['ok' => false, 'error' => 'Jogo desconhecido.'];
        }
        $row = [
            'id' => uuid(), 'client_id' => null, 'sender' => $me['name'], 'text' => '', 'created_at' => iso(), 'reply_to' => null,
            'reactions' => '{}', 'deleted' => 0, 'source' => 'game', 'media' => encode(['game' => $game]),
        ];
        query('INSERT INTO ' . t('messages') . ' (id, client_id, sender, text, created_at, reply_to, reactions, deleted, source, media) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', array_values($row));
        set_read($me['name'], $row['id'], $row['created_at']);
        $message = to_message($row);
        emit('message', $message);
        return ['ok' => true, 'message' => $message];
    }

    // Placar: as partidas de tabuleiro que já acabaram (todas, não só as da conversa carregada), por jogo: as vitórias
    // de cada um e os empates.
    if ($op === 'score') {
        $score = [];
        foreach (query('SELECT media FROM ' . t('messages') . " WHERE source = 'game' AND deleted = 0")->fetchAll(PDO::FETCH_COLUMN) as $media) {
            $game = json_decode((string) $media, true)['game'] ?? null;
            $winner = $game['winner'] ?? null;
            if (!$winner || !isset($game['seats'])) continue;
            $score[$game['type']] = $score[$game['type']] ?? ['wins' => [], 'ties' => 0];
            if ($winner === 'empate') $score[$game['type']]['ties']++;
            else $score[$game['type']]['wins'][$winner] = ($score[$game['type']]['wins'][$winner] ?? 0) + 1;
        }
        foreach ($score as &$entry) $entry['wins'] = (object) $entry['wins'];
        unset($entry);
        return ['ok' => true, 'score' => (object) $score];
    }

    $row = find_message(str($body['id'] ?? ''));
    $media = $row && !$row['deleted'] && $row['media'] ? json_decode((string) $row['media'], true) : null;
    $game = $media['game'] ?? null;
    if (!$game) return ['ok' => false, 'error' => 'Esse jogo não existe mais.'];
    $mine = null;
    if (isset($game['seats'])) {
        $error = board_play($game, $me['name'], $op, $body);
        if ($error) return ['ok' => false, 'error' => $error];
        $op = 'board';
    }
    switch ($op) {
        case 'board':
            break;
        case 'pick':
            $choice = str($body['choice'] ?? '');
            if ($game['type'] !== 'vd' || $game['for'] !== $me['name']) return ['ok' => false, 'error' => 'Quem escolhe é ' . $game['for'] . '.'];
            if ($game['choice']) return ['ok' => true, 'message' => to_message($row)];
            if (!in_array($choice, ['verdade', 'desafio'], true)) return ['ok' => false, 'error' => 'Escolha verdade ou desafio.'];
            $game['choice'] = $choice;
            $game['prompt'] = draw_card($choice);
            break;
        case 'vote':
            $value = $body['value'] ?? null;
            $valid = $game['type'] === 'quem' ? in_array($value, users(), true) : ($game['type'] === 'isso' && in_array($value, [0, 1], true));
            if (!$valid) return ['ok' => false, 'error' => 'Voto inválido.'];
            if (isset($game['votes'][$me['name']])) return ['ok' => false, 'error' => 'Você já votou.'];
            $game['votes'][$me['name']] = $mine = $value;
            break;
        case 'answer':
            $text = clean_body($body['text'] ?? '', 500);
            if ($game['type'] !== 'pergunta' || $text === '') return ['ok' => false, 'error' => 'Escreva sua resposta.'];
            if (isset($game['answers'][$me['name']])) return ['ok' => false, 'error' => 'Você já respondeu.'];
            $game['answers'][$me['name']] = $mine = $text;
            break;
        default:
            return ['ok' => false, 'error' => 'Jogada desconhecida.'];
    }
    $row['media'] = encode(['game' => $game]);
    query('UPDATE ' . t('messages') . ' SET media = ? WHERE n = ?', [$row['media'], $row['n']]);
    $message = to_message($row);
    emit('message:update', $message);
    return ['ok' => true, 'message' => $message, 'mine' => $mine];
}

// ---------- mensagens ----------

function to_message(array $row): array
{
    $deleted = (bool) $row['deleted'];
    $reactions = json_decode((string) $row['reactions'], true);
    // A coluna media guarda o GIF ({url, width, height, title}), o arquivo ({file: {...}}), o cartão de música
    // ({music: {...}}) ou o joguinho ({game: {...}}).
    $media = $deleted || empty($row['media']) ? null : json_decode((string) $row['media'], true);
    $file = is_array($media) && isset($media['file']) ? file_info($media['file']) : null;
    $music = is_array($media) && isset($media['music']) ? $media['music'] : null;
    $game = is_array($media) && isset($media['game']) ? game_public($media['game']) : null;
    return [
        'id' => $row['id'],
        'clientId' => $row['client_id'] !== null && $row['client_id'] !== '' ? $row['client_id'] : null,
        'sender' => $row['sender'],
        'text' => $deleted ? '' : $row['text'],
        'gif' => is_array($media) && !$file && !$music && !$game ? $media : null,
        'file' => $file,
        'music' => $music,
        'game' => $game,
        'createdAt' => $row['created_at'],
        'replyTo' => $row['reply_to'] ? json_decode($row['reply_to'], true) : null,
        // Reações sempre como objeto JSON ({}), igual à versão Node.
        'reactions' => (object) (is_array($reactions) ? $reactions : []),
        'deleted' => $deleted,
        'source' => $row['source'] ?: 'web',
    ];
}

function find_message(string $id): ?array
{
    if ($id === '') return null;
    $row = query('SELECT * FROM ' . t('messages') . ' WHERE id = ?', [$id])->fetch();
    return $row ?: null;
}

function page(string $before = ''): array
{
    $limit = PAGE_SIZE + 1;
    if ($before !== '') {
        $anchor = find_message($before);
        if (!$anchor) return ['items' => [], 'hasMore' => false];
        $rows = query('SELECT * FROM ' . t('messages') . " WHERE n < ? ORDER BY n DESC LIMIT $limit", [$anchor['n']])->fetchAll();
    } else {
        $rows = query('SELECT * FROM ' . t('messages') . " ORDER BY n DESC LIMIT $limit")->fetchAll();
    }
    $hasMore = count($rows) > PAGE_SIZE;
    $rows = array_reverse(array_slice($rows, 0, PAGE_SIZE));
    return ['items' => array_map('to_message', $rows), 'hasMore' => $hasMore];
}

function reads(): array
{
    $reads = [];
    foreach (query('SELECT name, read_id, read_at FROM ' . t('status') . ' WHERE read_id IS NOT NULL')->fetchAll() as $row) {
        $reads[$row['name']] = ['id' => $row['read_id'], 'at' => $row['read_at']];
    }
    return $reads;
}

// Histórico de quem conecta, com o tema da conta (null = nunca escolheu) e a chave da busca de GIFs
// (chave do GIPHY, feita para ficar no navegador; vazia = GIFs desligados).
function history(string $me): array
{
    return page() + [
        'reads' => (object) reads(),
        'me' => $me,
        'theme' => find_account($me)['theme'] ?? null,
        'wallpaper' => wallpaper_info(find_account($me)),
        'gifKey' => str(config()['giphy_key']),
        'fileMax' => file_max(),
        'transcribe' => str(config()['transcribe_key']) !== '',
        'music' => music_public(music_state()),
        'watch' => watch_public(watch_state()),
    ];
}

function set_read(string $name, string $id, string $at): void
{
    query('INSERT INTO ' . t('status') . ' (name, read_id, read_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE read_id = VALUES(read_id), read_at = VALUES(read_at)', [$name, $id, $at]);
}

// ---------- conexões, presença e eventos ----------

// Registra um evento para as conexões. Escopos: "all" (todas), "peer" (abas de chat da outra
// pessoa, ou só a conexão "to") e "self" (as minhas outras abas de chat).
function emit(string $type, $data = null, string $scope = 'all', ?array $from = null, ?string $to = null): void
{
    query(
        'INSERT INTO ' . t('events') . ' (at, type, data, scope, from_conn, from_name, to_conn) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [now_ms(), $type, $data === null ? null : encode($data), $scope, $from['conn'] ?? null, $from['name'] ?? null, $to]
    );
}

function event_for(array $event, string $conn, array $client): bool
{
    if ($event['scope'] === 'peer') {
        return $client['client'] === 'web' && $client['name'] !== $event['from_name'] && (empty($event['to_conn']) || $event['to_conn'] === $conn);
    }
    if ($event['scope'] === 'self') {
        return $client['client'] === 'web' && $client['name'] === $event['from_name'] && $conn !== $event['from_conn'];
    }
    return true;
}

function last_seq(): int
{
    return (int) query('SELECT COALESCE(MAX(seq), 0) FROM ' . t('events'))->fetchColumn();
}

function first_seq(): int
{
    return (int) query('SELECT COALESCE(MIN(seq), 0) FROM ' . t('events'))->fetchColumn();
}

function find_client(string $conn): ?array
{
    $row = query('SELECT * FROM ' . t('clients') . ' WHERE conn = ?', [$conn])->fetch();
    return $row ?: null;
}

function web_online(string $name): bool
{
    return (bool) query('SELECT 1 FROM ' . t('clients') . " WHERE client = 'web' AND name = ? LIMIT 1", [$name])->fetchColumn();
}

function people(): array
{
    return query('SELECT DISTINCT name FROM ' . t('clients'))->fetchAll(PDO::FETCH_COLUMN);
}

function presence(): array
{
    $online = [];
    $active = [];
    foreach (query('SELECT name, client, visible FROM ' . t('clients'))->fetchAll() as $client) {
        if ($client['client'] === 'web') $online[$client['name']] = true;
        if ($client['visible']) $active[$client['name']] = true;
    }
    $lastSeen = query('SELECT name, last_seen FROM ' . t('status'))->fetchAll(PDO::FETCH_KEY_PAIR);
    return array_map(fn($account) => [
        'name' => $account['name'],
        'online' => isset($online[$account['name']]),
        'active' => isset($active[$account['name']]),
        'lastSeen' => $lastSeen[$account['name']] ?? null,
        'avatar' => avatar_url($account['avatar_key']),
    ], accounts());
}

function conn_id(array $input): string
{
    $conn = str($input['conn'] ?? '');
    if (!preg_match('/^[A-Za-z0-9_-]{8,64}$/', $conn)) throw new HttpError(400, 'Conexão inválida.');
    return $conn;
}

// Registra a conexão (ou renova o sinal de vida dela). Devolve true se ela é nova.
function attach(string $conn, string $name, array $input): bool
{
    // Conexão encerrada de propósito (aba fechada, saiu) não volta: uma consulta atrasada não ressuscita ninguém.
    if (query('SELECT 1 FROM ' . t('gone') . ' WHERE conn = ?', [$conn])->fetchColumn()) {
        throw new HttpError(410, 'Conexão encerrada.');
    }
    $current = find_client($conn);
    if ($current && $current['name'] === $name) {
        query('UPDATE ' . t('clients') . ' SET ping = ? WHERE conn = ?', [now_ms(), $conn]);
        return false;
    }
    $client = ($input['client'] ?? '') === 'extension' ? 'extension' : 'web';
    // O serviço de fundo da extensão não conta como "ativo agora".
    $visible = $client === 'web' && ($input['visible'] ?? true) !== false;
    query('REPLACE INTO ' . t('clients') . ' (conn, name, client, visible, ping, hits) VALUES (?, ?, ?, ?, ?, ?)', [$conn, $name, $client, (int) $visible, now_ms(), '[]']);
    emit('presence');
    return true;
}

function drop(string $conn, bool $forever = false): void
{
    if ($forever) {
        query('INSERT INTO ' . t('gone') . ' (conn, at) VALUES (?, ?) ON DUPLICATE KEY UPDATE at = VALUES(at)', [$conn, now_ms()]);
    }
    $client = find_client($conn);
    if (!$client) return;
    query('DELETE FROM ' . t('clients') . ' WHERE conn = ?', [$conn]);
    if ($client['client'] === 'web') {
        emit('peer-left', ['id' => $conn, 'name' => $client['name']], 'peer', ['conn' => $conn, 'name' => $client['name']]);
        if (!web_online($client['name'])) {
            query('INSERT INTO ' . t('status') . ' (name, last_seen) VALUES (?, ?) ON DUPLICATE KEY UPDATE last_seen = VALUES(last_seen)', [$client['name'], iso()]);
        }
    }
    emit('presence');
}

// Conexões que pararam de consultar (aba fechada sem aviso, internet caiu) saem da sala.
// Também apaga eventos antigos (sempre fica o último, que marca a posição da fila).
function sweep(): void
{
    $now = now_ms();
    $stale = query('SELECT conn FROM ' . t('clients') . ' WHERE ping < ?', [$now - client_ttl_ms()])->fetchAll(PDO::FETCH_COLUMN);
    foreach ($stale as $conn) drop((string) $conn);
    query('DELETE FROM ' . t('gone') . ' WHERE at < ?', [$now - EVENT_KEEP_MS]);
    query('DELETE FROM ' . t('events') . ' WHERE at < ? AND seq < ?', [$now - EVENT_KEEP_MS, last_seq()]);
    // Arquivo enviado que nunca virou mensagem (envio cancelado, aba fechada no meio).
    query('DELETE FROM ' . t('files') . ' WHERE message_id IS NULL AND created_at < ?', [$now - DAY_MS]);
}

// ---------- ações vindas do navegador ----------

function act(array $me, string $event, $data)
{
    $name = $me['name'];
    $body = is_array($data) ? $data : [];

    switch ($event) {
        case 'message':
            return send_message($me, $body);

        case 'history:before':
            return page(str($body['before'] ?? ''));

        case 'avatar':
            return set_avatar($name, $body['image'] ?? null);

        // Números do perfil: os seus ou, com name, os da outra pessoa (só quem tem conta no chat).
        case 'stats':
            $who = str($body['name'] ?? '');
            return stats(in_array($who, array_column(accounts(), 'name'), true) ? $who : $name);

        case 'wallpaper':
            return set_wallpaper($me, $body);

        case 'music':
            return music_act($me, $body);

        case 'watch':
            return watch_act($me, $body);

        // Nosso cantinho: o dia de cada um, agenda, sonhos e metas, cartinhas e lembretes.
        case 'us':
            return us_act($me, $body);

        case 'game':
            return game_act($me, $body);

        // Tema escolhido: fica na conta e muda na hora nas outras abas da mesma pessoa.
        case 'theme':
            $theme = str($body['theme'] ?? '');
            if (!in_array($theme, THEMES, true)) return ['ok' => false, 'error' => 'Tema desconhecido.'];
            query('UPDATE ' . t('users') . ' SET theme = ? WHERE name = ?', [$theme, $name]);
            emit('theme', ['theme' => $theme], 'self', $me);
            return ['ok' => true];

        case 'react':
            $emoji = str($body['emoji'] ?? '');
            $row = find_message(str($body['id'] ?? ''));
            if (!$row || $row['deleted'] || !in_array($emoji, REACTIONS, true)) return null;
            $reactions = json_decode((string) $row['reactions'], true) ?: [];
            $list = (array) ($reactions[$emoji] ?? []);
            $list = in_array($name, $list, true) ? array_values(array_diff($list, [$name])) : array_merge($list, [$name]);
            if ($list) $reactions[$emoji] = $list;
            else unset($reactions[$emoji]);
            $row['reactions'] = encode((object) $reactions);
            query('UPDATE ' . t('messages') . ' SET reactions = ? WHERE n = ?', [$row['reactions'], $row['n']]);
            emit('message:update', to_message($row));
            return null;

        case 'delete':
            $row = find_message(str($body['id'] ?? ''));
            if (!$row || $row['sender'] !== $name || $row['deleted']) return null;
            $row = array_merge($row, ['deleted' => 1, 'text' => '', 'media' => null, 'reactions' => '{}']);
            query('UPDATE ' . t('messages') . " SET deleted = 1, text = '', media = NULL, reactions = '{}' WHERE n = ?", [$row['n']]);
            // A foto ou o arquivo some junto (o endereço para de funcionar).
            query('DELETE FROM ' . t('files') . ' WHERE message_id = ?', [$row['id']]);
            emit('message:update', to_message($row));
            return null;

        case 'seen':
            $row = find_message(str($body['id'] ?? ''));
            $current = find_message((string) query('SELECT read_id FROM ' . t('status') . ' WHERE name = ?', [$name])->fetchColumn());
            if (!$row || ($current && $row['n'] <= $current['n'])) return null;
            $at = iso();
            set_read($name, $row['id'], $at);
            emit('seen', ['name' => $name, 'id' => $row['id'], 'at' => $at]);
            return null;

        case 'visibility':
            query('UPDATE ' . t('clients') . " SET visible = ? WHERE conn = ? AND client = 'web'", [(int) (bool) $data, $me['conn']]);
            emit('presence');
            return null;

        // Digitando (true ou false) ou gravando um áudio ("audio").
        case 'typing':
            emit('typing', ['name' => $name, 'active' => (bool) $data, 'audio' => $data === 'audio'], 'peer', $me);
            return null;

        // Sinalização WebRTC: sempre para a outra pessoa, nunca para as próprias abas.
        case 'webrtc-offer':
            emit($event, array_merge($body, ['from' => $me['conn'], 'name' => $name]), 'peer', $me, str($body['to'] ?? '') ?: null);
            return null;

        case 'webrtc-answer':
            emit($event, array_merge($body, ['from' => $me['conn']]), 'peer', $me, str($body['to'] ?? '') ?: null);
            emit('call-handled', null, 'self', $me);
            return null;

        case 'webrtc-ice':
        case 'call-state':
            emit($event, array_merge($body, ['from' => $me['conn']]), 'peer', $me, str($body['to'] ?? '') ?: null);
            return null;

        case 'call-declined':
            emit('call-declined', ['name' => $name], 'peer', $me);
            emit('call-handled', null, 'self', $me);
            return null;

        case 'call-ended':
            emit('call-ended', ['name' => $name], 'peer', $me);
            return null;
    }
    return null;
}

// Números da tela de perfil: mensagens enviadas, reações dadas e desde quando a conversa existe.
function stats(string $name): array
{
    $messages = (int) query('SELECT COUNT(*) FROM ' . t('messages') . " WHERE sender = ? AND deleted = 0 AND source NOT IN ('music', 'game')", [$name])->fetchColumn();
    $since = query('SELECT created_at FROM ' . t('messages') . ' ORDER BY n LIMIT 1')->fetchColumn();
    $reactions = 0;
    $rows = query('SELECT reactions FROM ' . t('messages') . " WHERE deleted = 0 AND reactions <> '{}'")->fetchAll(PDO::FETCH_COLUMN);
    foreach ($rows as $json) {
        foreach ((array) json_decode((string) $json, true) as $names) {
            if (in_array($name, (array) $names, true)) $reactions++;
        }
    }
    return ['messages' => $messages, 'reactions' => $reactions, 'since' => $since ?: null];
}

// GIF escolhido na busca do chat: só imagens servidas pelo próprio GIPHY. false = recusado.
function clean_gif($gif)
{
    if ($gif === null) return null;
    if (!is_array($gif)) return false;
    $url = str($gif['url'] ?? '');
    $width = (int) str($gif['width'] ?? '');
    $height = (int) str($gif['height'] ?? '');
    if (strlen($url) > 600 || !preg_match('#^https://(?:media\d*|i)\.giphy\.com/[A-Za-z0-9._~/?&=%+-]+$#', $url)) return false;
    if ($width < 1 || $height < 1 || $width > 4000 || $height > 4000) return false;
    return ['url' => $url, 'width' => $width, 'height' => $height, 'title' => text_slice(text_trim(str($gif['title'] ?? '')), 120)];
}

// Texto curto da mensagem para a citação de uma resposta.
function preview_text(array $row): string
{
    if ($row['deleted']) return '';
    if ($row['text'] !== '') return text_slice($row['text'], 160);
    $media = empty($row['media']) ? null : json_decode((string) $row['media'], true);
    if (isset($media['file']['voice'])) {
        $seconds = (int) $media['file']['voice']['duration'];
        return sprintf('Mensagem de voz (%d:%02d)', intdiv($seconds, 60), $seconds % 60);
    }
    if (isset($media['file'])) return ['image' => 'Foto', 'video' => 'Vídeo', 'audio' => 'Áudio'][$media['file']['kind']] ?? text_slice((string) $media['file']['name'], 160);
    if (isset($media['music'])) return text_slice('Música: ' . $media['music']['title'], 160);
    if (isset($media['game'])) return GAME_NAMES[$media['game']['type']] ?? 'Joguinho';
    return $media ? 'GIF' : '';
}

function send_message(array $me, array $body): array
{
    // Foto ou arquivo já enviado em api.php?action=upload (chave). Áudio gravado no chat vem com voice.
    $fileKey = str($body['file'] ?? '');
    $gif = $fileKey === '' ? clean_gif($body['gif'] ?? null) : null;
    if ($gif === false) return ['ok' => false, 'error' => 'GIF inválido.'];
    // Mensagem com GIF não leva texto.
    $text = $gif ? '' : text_slice(text_trim(str($body['text'] ?? '')), 2000);
    $clientId = text_slice(str($body['clientId'] ?? ''), 64) ?: null;
    if ($text === '' && !$gif && $fileKey === '') return ['ok' => false, 'error' => 'Mensagem vazia.'];

    $hits = json_decode((string) query('SELECT hits FROM ' . t('clients') . ' WHERE conn = ?', [$me['conn']])->fetchColumn(), true) ?: [];
    $allowed = allow($hits, 25, 10 * 1000);
    query('UPDATE ' . t('clients') . ' SET hits = ? WHERE conn = ?', [encode($hits), $me['conn']]);
    if (!$allowed) return ['ok' => false, 'error' => 'Calma! Muitas mensagens em pouco tempo.'];

    // Reenvio após queda de conexão: não duplica.
    if ($clientId) {
        $duplicate = query('SELECT * FROM ' . t('messages') . ' WHERE sender = ? AND client_id = ? LIMIT 1', [$me['name'], $clientId])->fetch();
        if ($duplicate) return ['ok' => true, 'message' => to_message($duplicate)];
    }

    // O arquivo precisa ser de quem manda e ainda não estar em outra mensagem.
    $file = null;
    if ($fileKey !== '') {
        $file = query('SELECT file_key AS `key`, name, type, kind, size, width, height FROM ' . t('files') . ' WHERE file_key = ? AND owner = ? AND message_id IS NULL', [$fileKey, $me['name']])->fetch();
        if (!$file) return ['ok' => false, 'error' => 'Arquivo não encontrado. Tente enviar de novo.'];
        // Player de voz só para o que toca (um WebM estranho pode ter sido visto como vídeo; o som toca igual).
        $voice = in_array($file['kind'], ['audio', 'video'], true) ? clean_voice($body['voice'] ?? null) : null;
        if ($voice) $file['voice'] = $voice;
    }

    $original = find_message(str($body['replyTo'] ?? ''));
    $reply = $original
        ? ['id' => $original['id'], 'sender' => $original['sender'], 'text' => preview_text($original)]
        : null;
    $row = [
        'id' => uuid(),
        'client_id' => $clientId,
        'sender' => $me['name'],
        'text' => $text,
        'created_at' => iso(),
        'reply_to' => $reply ? encode($reply) : null,
        'reactions' => '{}',
        'deleted' => 0,
        'source' => $me['client'],
        'media' => $file ? encode(['file' => $file]) : ($gif ? encode($gif) : null),
    ];
    query(
        'INSERT INTO ' . t('messages') . ' (id, client_id, sender, text, created_at, reply_to, reactions, deleted, source, media) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        array_values($row)
    );
    if ($file) query('UPDATE ' . t('files') . ' SET message_id = ? WHERE file_key = ?', [$row['id'], $file['key']]);
    set_read($me['name'], $row['id'], $row['created_at']);
    $message = to_message($row);
    emit('message', $message);
    return ['ok' => true, 'message' => $message];
}
