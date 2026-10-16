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
const SCHEMA_VERSION = '4';
const MIN_PASSWORD = 4;
const AVATAR_MAX = 400000;
// GIF animado vai sem recortar (o recorte tiraria a animação): limite maior, que ainda cabe numa requisição.
const AVATAR_GIF_MAX = 700000;
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
    return query('SELECT position, name, pass_hash, avatar_key, theme FROM ' . t('users') . ' ORDER BY position LIMIT ' . MAX_USERS)->fetchAll();
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

// ---------- mensagens ----------

function to_message(array $row): array
{
    $deleted = (bool) $row['deleted'];
    $reactions = json_decode((string) $row['reactions'], true);
    $gif = $deleted || empty($row['media']) ? null : json_decode((string) $row['media'], true);
    return [
        'id' => $row['id'],
        'clientId' => $row['client_id'] !== null && $row['client_id'] !== '' ? $row['client_id'] : null,
        'sender' => $row['sender'],
        'text' => $deleted ? '' : $row['text'],
        'gif' => is_array($gif) ? $gif : null,
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
        'gifKey' => str(config()['giphy_key']),
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

        case 'typing':
            emit('typing', ['name' => $name, 'active' => (bool) $data], 'peer', $me);
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
    return $row['text'] !== '' ? text_slice($row['text'], 160) : (empty($row['media']) ? '' : 'GIF');
}

function send_message(array $me, array $body): array
{
    $gif = clean_gif($body['gif'] ?? null);
    if ($gif === false) return ['ok' => false, 'error' => 'GIF inválido.'];
    // Mensagem com GIF não leva texto.
    $text = $gif ? '' : text_slice(text_trim(str($body['text'] ?? '')), 2000);
    $clientId = text_slice(str($body['clientId'] ?? ''), 64) ?: null;
    if ($text === '' && !$gif) return ['ok' => false, 'error' => 'Mensagem vazia.'];

    $hits = json_decode((string) query('SELECT hits FROM ' . t('clients') . ' WHERE conn = ?', [$me['conn']])->fetchColumn(), true) ?: [];
    $allowed = allow($hits, 25, 10 * 1000);
    query('UPDATE ' . t('clients') . ' SET hits = ? WHERE conn = ?', [encode($hits), $me['conn']]);
    if (!$allowed) return ['ok' => false, 'error' => 'Calma! Muitas mensagens em pouco tempo.'];

    // Reenvio após queda de conexão: não duplica.
    if ($clientId) {
        $duplicate = query('SELECT * FROM ' . t('messages') . ' WHERE sender = ? AND client_id = ? LIMIT 1', [$me['name'], $clientId])->fetch();
        if ($duplicate) return ['ok' => true, 'message' => to_message($duplicate)];
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
        'media' => $gif ? encode($gif) : null,
    ];
    query(
        'INSERT INTO ' . t('messages') . ' (id, client_id, sender, text, created_at, reply_to, reactions, deleted, source, media) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        array_values($row)
    );
    set_read($me['name'], $row['id'], $row['created_at']);
    $message = to_message($row);
    emit('message', $message);
    return ['ok' => true, 'message' => $message];
}
