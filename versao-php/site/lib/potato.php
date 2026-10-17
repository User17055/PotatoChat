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
const SCHEMA_VERSION = '6';
const MIN_PASSWORD = 4;
const AVATAR_MAX = 400000;
// GIF animado vai sem recortar (o recorte tiraria a animação): limite maior, que ainda cabe numa requisição.
const AVATAR_GIF_MAX = 700000;
// Fotos e arquivos das mensagens: até 10 MB (menos, se o PHP ou o MySQL da hospedagem não aguentarem; veja file_max).
const FILE_MAX = 10000000;
const FILE_UPLOADS_PER_10_MIN = 60;
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
function youtube_search(string $query): array
{
    $key = str(config()['youtube_key']);
    $found = [];
    if ($key !== '') {
        $data = http_json('https://www.googleapis.com/youtube/v3/search?' . http_build_query([
            'part' => 'snippet', 'type' => 'video', 'videoEmbeddable' => 'true', 'videoSyndicated' => 'true',
            'maxResults' => 5, 'regionCode' => 'BR', 'relevanceLanguage' => 'pt', 'q' => $query, 'key' => $key,
        ]));
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
    [$status, $html] = http_get('https://www.youtube.com/results?' . http_build_query(['search_query' => $query, 'sp' => 'EgIQAQ==', 'hl' => 'pt-BR', 'gl' => 'BR']));
    if ($status !== 200 || !preg_match('/var ytInitialData = (\{.*?\});<\/script>/s', $html, $match)) return [];
    $walk = function ($node) use (&$walk, &$found) {
        if (!is_array($node) || count($found) >= 6) return;
        if (isset($node['videoRenderer']['videoId'])) {
            $video = $node['videoRenderer'];
            // Sem duração = transmissão ao vivo: fica de fora.
            if (!empty($video['lengthText'])) {
                $found[] = [
                    'id' => $video['videoId'], 'title' => $video['title']['runs'][0]['text'] ?? '', 'artist' => $video['ownerText']['runs'][0]['text'] ?? '',
                    'duration' => parse_length((string) ($video['lengthText']['simpleText'] ?? '')), 'checked' => false,
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

function watch_blank(): array
{
    return ['now' => null, 'playing' => false, 'position' => 0, 'updatedAt' => 0];
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

// Comandos: start (query = link; local = vídeo do aparelho), pause, resume, seek, ended e stop.
function watch_act(array $me, array $body): array
{
    $op = str($body['op'] ?? '');
    $item = null;
    if ($op === 'start') {
        $local = is_array($body['local'] ?? null) ? $body['local'] : null;
        if ($local) {
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
                $item = $link;
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
            $state = ['now' => $item, 'playing' => true, 'position' => 0, 'updatedAt' => $now];
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
        case 'stop':
            $state = watch_blank();
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
        if (in_array($brand, ['M4A ', 'M4B '], true)) return ['kind' => 'audio', 'type' => 'audio/mp4'];
        return ['kind' => 'video', 'type' => $brand === 'qt  ' ? 'video/quicktime' : 'video/mp4'];
    }
    if (strncmp($head, "\x1A\x45\xDF\xA3", 4) === 0) return ['kind' => 'video', 'type' => 'video/webm'];
    if (strncmp($head, 'OggS', 4) === 0) return ['kind' => 'audio', 'type' => 'audio/ogg'];
    if (strncmp($head, 'RIFF', 4) === 0 && substr($head, 8, 4) === 'WAVE') return ['kind' => 'audio', 'type' => 'audio/wav'];
    if (strncmp($head, 'ID3', 3) === 0 || (strlen($head) > 1 && ord($head[0]) === 0xFF && (ord($head[1]) & 0xE0) === 0xE0)) {
        return ['kind' => 'audio', 'type' => 'audio/mpeg'];
    }
    return ['kind' => 'file', 'type' => 'application/octet-stream'];
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
    return [
        'url' => file_url((string) $file['key']),
        'name' => (string) $file['name'],
        'type' => (string) $file['type'],
        'kind' => (string) $file['kind'],
        'size' => (int) $file['size'],
        'width' => isset($file['width']) ? (int) $file['width'] : null,
        'height' => isset($file['height']) ? (int) $file['height'] : null,
    ];
}

// ---------- mensagens ----------

function to_message(array $row): array
{
    $deleted = (bool) $row['deleted'];
    $reactions = json_decode((string) $row['reactions'], true);
    // A coluna media guarda o GIF ({url, width, height, title}) ou o arquivo ({file: {...}}).
    $media = $deleted || empty($row['media']) ? null : json_decode((string) $row['media'], true);
    $file = is_array($media) && isset($media['file']) ? file_info($media['file']) : null;
    $music = is_array($media) && isset($media['music']) ? $media['music'] : null;
    return [
        'id' => $row['id'],
        'clientId' => $row['client_id'] !== null && $row['client_id'] !== '' ? $row['client_id'] : null,
        'sender' => $row['sender'],
        'text' => $deleted ? '' : $row['text'],
        'gif' => is_array($media) && !$file && !$music ? $media : null,
        'file' => $file,
        'music' => $music,
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

        case 'stats':
            return stats($name);

        case 'wallpaper':
            return set_wallpaper($me, $body);

        case 'music':
            return music_act($me, $body);

        case 'watch':
            return watch_act($me, $body);

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

// Números da tela de perfil: mensagens enviadas, reações dadas e desde quando a conversa existe.
function stats(string $name): array
{
    $messages = (int) query('SELECT COUNT(*) FROM ' . t('messages') . " WHERE sender = ? AND deleted = 0 AND source <> 'music'", [$name])->fetchColumn();
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
    if (isset($media['file'])) return ['image' => 'Foto', 'video' => 'Vídeo', 'audio' => 'Áudio'][$media['file']['kind']] ?? text_slice((string) $media['file']['name'], 160);
    if (isset($media['music'])) return text_slice('Música: ' . $media['music']['title'], 160);
    return $media ? 'GIF' : '';
}

function send_message(array $me, array $body): array
{
    // Foto ou arquivo já enviado em api.php?action=upload (chave).
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
