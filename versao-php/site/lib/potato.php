<?php
// Núcleo do Potato Chat em PHP + MySQL: banco de dados, contas, sessão, presença e fila de eventos.
// As tabelas são criadas sozinhas no primeiro acesso (ou importe banco.sql pelo phpMyAdmin).

declare(strict_types=1);

const DAY_MS = 86400000;
const SESSION_DAYS = 365;
// Contas novas chegam por convite (as duas primeiras, o casal, não precisam): ele vale uma vez, por INVITE_DAYS.
const INVITE_DAYS = 7;
const INVITES_PER_DAY = 20;
const INVITE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const PAGE_SIZE = 60;
// Pesquisa na conversa: quantos resultados vêm por vez.
const SEARCH_PAGE = 30;
const REACTIONS = ['❤️', '😂', '😮', '😢', '👍', '🔥'];
const MAX_BODY = 1000000;
const EVENT_KEEP_MS = 120000;
const SCHEMA_VERSION = '10';
const MIN_PASSWORD = 4;
const AVATAR_MAX = 400000;
// GIF animado vai sem recortar (o recorte tiraria a animação): limite maior, que ainda cabe numa requisição.
const AVATAR_GIF_MAX = 700000;
// Fotos e arquivos das mensagens: até 10 MB (menos, se o PHP ou o MySQL da hospedagem não aguentarem; veja file_max).
const FILE_MAX = 10000000;
const FILE_UPLOADS_PER_10_MIN = 60;
// Watch Party, vídeo do aparelho: sobe em pedaços de até 8 MB e fica em disco (filmes/), não no banco.
const WATCH_FILE_MAX = 4294967296;
const WATCH_CHUNK = 8388608;
const WATCH_DIR = __DIR__ . '/../filmes';
// Mensagem de voz: até 1 hora (o chat já para a gravação em 15 minutos) e até 64 barras na forma de onda.
const VOICE_MAX = 3600;
const VOICE_PEAKS = 64;
// Papel de parede: foto reduzida no navegador (lado maior até 1600 px). Cabe numa requisição mesmo em base64.
const WALLPAPER_MAX = 650000;
const MUSIC_QUEUE_MAX = 50;
// Watch Party na Netflix e na HBO Max: em quanto tempo os dois players começam (ou continuam) juntos.
const STREAM_START_MS = 5000;
const STREAM_RESUME_MS = 1500;
// Chamada: quanto tempo ela toca nos aparelhos da outra pessoa (depois, continua aberta esperando). Veja "chamadas".
const CALL_RING_MS = 60000;
const CALL_WAIT_MS = 300000;
const CALL_NAMES = ['audio' => 'Chamada de voz', 'video' => 'Chamada de vídeo', 'screen' => 'Transmissão de tela'];
require_once __DIR__ . '/local-music.php';
// Mesma lista do app.js (THEMES). O primeiro é o padrão.
const THEMES = ['escuro', 'preto', 'rosa', 'roxo', 'azul', 'verde', 'claro', 'vinho', 'oceano', 'coral', 'natal'];

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
        $turnFile = dirname($file) . '/turn.config.php';
        $turn = is_file($turnFile) ? require $turnFile : [];
        $turn = is_array($turn) ? array_intersect_key($turn, array_flip(['turn_urls', 'turn_secret', 'turn_username', 'turn_password', 'turn_ttl', 'turn_only'])) : [];
        $musicFile = dirname($file) . '/music.config.php';
        $localMusic = is_file($musicFile) ? require $musicFile : [];
        $localMusic = is_array($localMusic) ? array_intersect_key($localMusic, array_flip(['music_local_url', 'music_local_key'])) : [];
        $config = array_merge([
            'token_secret' => '',
            'poll_wait' => 20,
            'turn_urls' => getenv('TURN_URLS') ?: [],
            'turn_secret' => getenv('TURN_SECRET') ?: '',
            'turn_username' => getenv('TURN_USERNAME') ?: '',
            'turn_password' => getenv('TURN_PASSWORD') ?: '',
            'turn_ttl' => (int) (getenv('TURN_TTL') ?: 3600),
            'turn_only' => getenv('TURN_ONLY') === 'true',
            'giphy_key' => '',
            // Bot de música: chave da YouTube Data API (opcional; sem ela, a busca pelo nome lê a página de resultados do YouTube).
            'youtube_key' => '',
            // Transcrição das mensagens de voz: qualquer API no formato da OpenAI (vazio = desligada; veja o LEIA-ME).
            'transcribe_key' => '',
            'transcribe_url' => 'https://api.groq.com/openai/v1/audio/transcriptions',
            'transcribe_model' => 'whisper-large-v3-turbo',
            // false = não consulta YouTube nem Spotify (só para os testes automáticos, que rodam sem internet).
            'music_lookup' => true,
            'music_local_url' => getenv('MUSIC_LOCAL_URL') ?: '',
            'music_local_key' => getenv('MUSIC_LOCAL_KEY') ?: '',
        ], $custom, $turn, $localMusic);
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

// Credenciais coturn REST: só a credencial temporária chega ao cliente, nunca o segredo compartilhado.
function rtc_config(string $name): array
{
    $cfg = config();
    $servers = [['urls' => 'stun:stun.l.google.com:19302'], ['urls' => 'stun:stun1.l.google.com:19302']];
    $urls = $cfg['turn_urls'];
    if (is_string($urls)) $urls = preg_split('/[\s,]+/', trim($urls));
    $urls = array_values(array_filter(is_array($urls) ? $urls : [], fn($url) => is_string($url) && preg_match('/^turns?:[^\s]+$/', $url)));
    $expires = 0;
    $username = (string) $cfg['turn_username'];
    $password = (string) $cfg['turn_password'];
    if ($urls && $cfg['turn_secret'] !== '') {
        $expires = time() + max(600, min(86400, (int) $cfg['turn_ttl']));
        $username = $expires . ':' . substr(hash('sha256', $name), 0, 24);
        $password = base64_encode(hash_hmac('sha1', $username, (string) $cfg['turn_secret'], true));
    }
    $configured = (bool) ($urls && $username !== '' && $password !== '');
    if ($configured) $servers[] = ['urls' => $urls, 'username' => $username, 'credential' => $password];
    return ['iceServers' => $servers, 'turnConfigured' => $configured, 'expiresAt' => $expires * 1000,
        'iceTransportPolicy' => $configured && $cfg['turn_only'] ? 'relay' : 'all'];
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
  KEY message_client (sender, client_id),
  KEY message_room (room, n)
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
  " . implode(",\n  ", event_columns()) . ",
  KEY event_at (at)
) $table",
        // Conversas (de duas pessoas, a e b em ordem) e até onde cada um leu em cada uma.
        'CREATE TABLE IF NOT EXISTS ' . t('rooms') . " (
  id VARCHAR(16) $ascii NOT NULL PRIMARY KEY,
  a VARCHAR(64) $exact NOT NULL,
  b VARCHAR(64) $exact NOT NULL,
  created_at VARCHAR(32) $ascii NOT NULL,
  UNIQUE KEY room_pair (a, b),
  KEY room_b (b)
) $table",
        'CREATE TABLE IF NOT EXISTS ' . t('reads') . " (
  room VARCHAR(16) $ascii NOT NULL,
  name VARCHAR(64) $exact NOT NULL,
  read_id CHAR(36) $ascii NULL,
  read_at VARCHAR(32) $ascii NULL,
  PRIMARY KEY (room, name)
) $table",
        // Convites: o link que quem já usa manda para alguém (cria a conta, ou só a conversa, de quem abre).
        'CREATE TABLE IF NOT EXISTS ' . t('invites') . " (
  code VARCHAR(16) $ascii NOT NULL PRIMARY KEY,
  owner VARCHAR(64) $exact NOT NULL,
  created_at BIGINT NOT NULL,
  used_by VARCHAR(64) $exact NULL,
  used_at BIGINT NULL,
  KEY invite_owner (owner, created_at)
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

// GIF ou arquivo da mensagem (JSON), quando a outra pessoa leu (vazio = lida antes de o chat guardar a hora) e a
// conversa dela. Separadas pelo mesmo motivo.
function message_columns(): array
{
    return [
        'media' => 'media TEXT NULL',
        'read_at' => 'read_at VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL',
        'room' => "room VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT ''",
    ];
}

// Até qual mensagem da conversa cada pessoa já recebeu (num aparelho dela; os ✓✓ cinza, como no WhatsApp).
function read_columns(): array
{
    return ['got_id' => 'got_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL'];
}

// A conversa do evento (vazio = de todos): só as duas pessoas dela recebem.
function event_columns(): array
{
    return ['room' => 'room VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL'];
}

// Banco de antes da hora da leitura: o que cada um já tinha lido continua lido, só que sem a hora.
function backfill_reads(PDO $pdo): void
{
    $marks = $pdo->query('SELECT s.name, m.n FROM ' . t('status') . ' s JOIN ' . t('messages') . ' m ON m.id = s.read_id')->fetchAll();
    $update = $pdo->prepare('UPDATE ' . t('messages') . " SET read_at = '' WHERE n <= ? AND sender <> ? AND read_at IS NULL");
    foreach ($marks as $mark) $update->execute([$mark['n'], $mark['name']]);
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
        foreach (['users' => user_columns(), 'messages' => message_columns(), 'events' => event_columns(), 'reads' => read_columns()] as $table => $wanted) {
            $columns = $pdo->query('SHOW COLUMNS FROM ' . t($table))->fetchAll(PDO::FETCH_COLUMN);
            $missing = array_diff_key($wanted, array_flip($columns));
            if (!$missing) continue;
            $changes = array_map(fn($column) => "ADD COLUMN $column", array_values($missing));
            if (isset($missing['avatar_key'])) $changes[] = 'ADD KEY user_avatar (avatar_key)';
            if ($table === 'messages' && isset($missing['room'])) $changes[] = 'ADD KEY message_room (room, n)';
            $pdo->exec('ALTER TABLE ' . t($table) . ' ' . implode(', ', $changes));
            if ($table === 'messages' && isset($missing['read_at'])) backfill_reads($pdo);
        }
        link_couple($pdo);
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

// As contas: nome e senha valem para sempre. As duas primeiras pessoas entram sem convite (o casal); as outras chegam
// por convite. (A foto não entra aqui: ela só é lida quando alguém abre a imagem.)
function accounts(): array
{
    return query('SELECT position, name, pass_hash, avatar_key, theme, wallpaper_key, wallpaper_style FROM ' . t('users') . ' ORDER BY position')->fetchAll();
}

// O casal (as duas primeiras contas): o Nosso cantinho é só deles.
function users(): array
{
    return array_column(array_slice(accounts(), 0, 2), 'name');
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

// Para a tela de login: quantas contas ainda dá para criar sem convite e, com um convite no link, quem convidou.
function welcome(string $code = ''): array
{
    $ready = array_filter(accounts(), fn($account) => $account['pass_hash'] !== null);
    $result = ['open' => max(0, 2 - count($ready))];
    if ($code !== '') {
        $invite = find_invite($code);
        $result['invite'] = $invite ? ['from' => $invite['owner']] : false;
    }
    return $result;
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
        // Entrando pelo link de um convite: quem convidou vira contato (e a conta nova pode ser criada).
        $code = str($input['invite'] ?? '');
        $invite = $code !== '' ? find_invite($code) : null;
        if ($code !== '' && !$invite) throw new HttpError(400, 'Esse convite não vale mais (já foi usado ou passou de ' . INVITE_DAYS . ' dias). Peça outro.');

        $account = find_account($name);
        if ($account && $account['pass_hash'] !== null) {
            if (!password_verify($password, $account['pass_hash'])) throw new HttpError(401, 'Senha incorreta.');
            if (password_needs_rehash($account['pass_hash'], PASSWORD_DEFAULT)) {
                query('UPDATE ' . t('users') . ' SET pass_hash = ? WHERE position = ?', [password_hash($password, PASSWORD_DEFAULT), $account['position']]);
            }
            $result = ['token' => issue_token($account['name']), 'name' => $account['name']];
            if ($invite && !same_name($invite['owner'], $account['name'])) $result['room'] = use_invite($invite, $account['name'])['id'];
            return $result;
        }

        // Primeiro acesso: cria a conta (ou só a senha, se a conta veio da versão sem senhas). Sem convite, só as duas
        // primeiras.
        if (!$account && count(accounts()) >= 2 && !$invite) throw new HttpError(403, 'Para criar uma conta, peça um convite para quem já usa o Potato Chat.');
        $name = $account['name'] ?? $name;
        if (text_length($password) < MIN_PASSWORD) throw new HttpError(400, 'Escolha uma senha com pelo menos ' . MIN_PASSWORD . ' caracteres.');
        // Nome e senha não mudam mais: o navegador pede a senha de novo antes de criar.
        if (!array_key_exists('confirm', $input)) return ['confirm' => true, 'name' => $name];
        if (!hash_equals($password, str($input['confirm']))) throw new HttpError(400, 'As senhas não são iguais. Digite de novo.');

        $hash = password_hash($password, PASSWORD_DEFAULT);
        if ($account) query('UPDATE ' . t('users') . ' SET pass_hash = ? WHERE position = ?', [$hash, $account['position']]);
        else query('INSERT INTO ' . t('users') . ' (name, created_at, pass_hash) VALUES (?, ?, ?)', [$name, iso(), $hash]);
        $result = ['token' => issue_token($name), 'name' => $name, 'created' => true];
        if ($invite) $result['room'] = use_invite($invite, $name)['id'];
        else link_couple(db());
        return $result;
    });
}

// ---------- conversas e convites ----------
// Cada conversa é de duas pessoas, como as DMs do Discord: a lista de conversas de cada um são os contatos dele. A do
// casal (as duas primeiras contas) é a de sempre, e o Nosso cantinho é só dela. Quem já usa manda um convite (um link
// que vale uma vez): quem abre cria a conta (ou entra na dela) e os dois ganham uma conversa.

function room_id(): string
{
    return bin2hex(random_bytes(6));
}

// As duas pessoas da conversa em ordem (a coluna a é sempre a menor).
function pair(string $x, string $y): array
{
    return strcmp($x, $y) < 0 ? [$x, $y] : [$y, $x];
}

function find_room(string $id): ?array
{
    static $known = [];
    if ($id === '') return null;
    if (!isset($known[$id])) {
        $room = query('SELECT * FROM ' . t('rooms') . ' WHERE id = ?', [$id])->fetch();
        if (!$room) return null;
        $known[$id] = $room;
    }
    return $known[$id];
}

function room_member(?array $room, string $name): bool
{
    return $room !== null && ($room['a'] === $name || $room['b'] === $name);
}

function room_peer(array $room, string $name): string
{
    return $room['a'] === $name ? $room['b'] : $room['a'];
}

// A conversa de duas pessoas (criada agora, se ainda não existe).
function room_between(string $x, string $y): array
{
    [$a, $b] = pair($x, $y);
    $room = query('SELECT * FROM ' . t('rooms') . ' WHERE a = ? AND b = ?', [$a, $b])->fetch();
    if ($room) return $room;
    $room = ['id' => room_id(), 'a' => $a, 'b' => $b, 'created_at' => iso()];
    query('INSERT INTO ' . t('rooms') . ' (id, a, b, created_at) VALUES (?, ?, ?, ?)', array_values($room));
    return $room;
}

function rooms_of(string $name): array
{
    return query('SELECT * FROM ' . t('rooms') . ' WHERE a = ? OR b = ?', [$name, $name])->fetchAll();
}

function couple_room(): ?array
{
    static $room = null;
    if ($room) return $room;
    $couple = users();
    if (count($couple) < 2) return null;
    [$a, $b] = pair($couple[0], $couple[1]);
    return $room = query('SELECT * FROM ' . t('rooms') . ' WHERE a = ? AND b = ?', [$a, $b])->fetch() ?: null;
}

// O casal ganha a conversa dele. Antes das conversas separadas só havia essa: as mensagens, as leituras, a música e a
// Watch Party de antes passam a ser dela.
function link_couple(PDO $pdo): void
{
    $couple = $pdo->query('SELECT name FROM ' . t('users') . ' ORDER BY position LIMIT 2')->fetchAll(PDO::FETCH_COLUMN);
    if (count($couple) < 2) return;
    [$a, $b] = pair($couple[0], $couple[1]);
    $find = $pdo->prepare('SELECT id FROM ' . t('rooms') . ' WHERE a = ? AND b = ?');
    $find->execute([$a, $b]);
    $room = $find->fetchColumn();
    if (!$room) {
        $room = room_id();
        $pdo->prepare('INSERT INTO ' . t('rooms') . ' (id, a, b, created_at) VALUES (?, ?, ?, ?)')->execute([$room, $a, $b, iso()]);
    }
    $pdo->prepare('UPDATE ' . t('messages') . " SET room = ? WHERE room = ''")->execute([$room]);
    $pdo->prepare('INSERT IGNORE INTO ' . t('reads') . ' (room, name, read_id, read_at) SELECT ?, name, read_id, read_at FROM ' . t('status') . ' WHERE read_id IS NOT NULL')->execute([$room]);
    foreach (['music', 'watch'] as $key) $pdo->prepare('UPDATE IGNORE ' . t('settings') . ' SET name = ? WHERE name = ?')->execute(["$key:$room", $key]);
}

// A conversa de uma ação: a pedida (se a pessoa é dela; senão, nenhuma) ou, sem pedido (a extensão, o app do Android),
// a do casal ou a mais recente.
function pick_room(string $name, string $requested): ?array
{
    if ($requested !== '') {
        $room = find_room($requested);
        return room_member($room, $name) ? $room : null;
    }
    $couple = couple_room();
    if (room_member($couple, $name)) return $couple;
    $room = query('SELECT r.* FROM ' . t('rooms') . ' r WHERE r.a = ? OR r.b = ? ORDER BY (SELECT MAX(m.n) FROM ' . t('messages') . ' m WHERE m.room = r.id) DESC, r.created_at DESC LIMIT 1', [$name, $name])->fetch();
    return $room ?: null;
}

// As conversas de alguém (os contatos), das mais recentes para as mais antigas: com quem, a última mensagem e quantas
// ainda não leu.
function room_list(string $name): array
{
    $couple = couple_room();
    $list = [];
    foreach (rooms_of($name) as $room) {
        $last = query('SELECT * FROM ' . t('messages') . ' WHERE room = ? ORDER BY n DESC LIMIT 1', [$room['id']])->fetch();
        $unread = (int) query('SELECT COUNT(*) FROM ' . t('messages') . ' WHERE room = ? AND n > ? AND sender <> ? AND deleted = 0', [$room['id'], read_upto($room['id'], $name), $name])->fetchColumn();
        $list[] = [
            'id' => $room['id'], 'peer' => room_peer($room, $name), 'couple' => $couple !== null && $couple['id'] === $room['id'], 'since' => $room['created_at'],
            'last' => $last ? ['id' => $last['id'], 'sender' => $last['sender'], 'text' => $last['deleted'] ? '' : preview_text($last), 'at' => $last['created_at'], 'deleted' => (bool) $last['deleted']] : null,
            'unread' => $unread,
        ];
    }
    usort($list, fn($x, $y) => strcmp($y['last']['at'] ?? $y['since'], $x['last']['at'] ?? $x['since']));
    return $list;
}

// O código de um convite (vale colar o link inteiro). null = não existe, já foi usado, venceu ou quem convidou saiu.
function find_invite(string $text): ?array
{
    if (!preg_match('/([a-z2-9]{10})\s*$/', strtolower($text), $match)) return null;
    $invite = query('SELECT * FROM ' . t('invites') . ' WHERE code = ?', [$match[1]])->fetch();
    if (!$invite || $invite['used_by'] !== null || now_ms() - (int) $invite['created_at'] > INVITE_DAYS * DAY_MS) return null;
    return find_account($invite['owner']) ? $invite : null;
}

// Quem convidou e quem chegou viram contatos (a conversa dos dois). Os dois ficam sabendo na hora.
function use_invite(array $invite, string $name): array
{
    query('UPDATE ' . t('invites') . ' SET used_by = ?, used_at = ? WHERE code = ?', [$name, now_ms(), $invite['code']]);
    $room = room_between(find_account($invite['owner'])['name'], $name);
    emit('rooms', ['room' => $room['id']], 'all', null, null, $room['id']);
    return $room;
}

function invite_act(array $me, array $body): array
{
    $op = str($body['op'] ?? '');
    if ($op === 'create') {
        $today = (int) query('SELECT COUNT(*) FROM ' . t('invites') . ' WHERE owner = ? AND created_at > ?', [$me['name'], now_ms() - DAY_MS])->fetchColumn();
        if ($today >= INVITES_PER_DAY) return ['ok' => false, 'error' => 'Muitos convites hoje. Tente de novo amanhã.'];
        $code = '';
        for ($i = 0; $i < 10; $i++) $code .= INVITE_ALPHABET[random_int(0, strlen(INVITE_ALPHABET) - 1)];
        query('INSERT INTO ' . t('invites') . ' (code, owner, created_at) VALUES (?, ?, ?)', [$code, $me['name'], now_ms()]);
        return ['ok' => true, 'code' => $code, 'days' => INVITE_DAYS];
    }
    if ($op === 'accept') {
        $invite = find_invite(str($body['code'] ?? ''));
        if (!$invite) return ['ok' => false, 'error' => 'Esse convite não vale mais (já foi usado ou passou de ' . INVITE_DAYS . ' dias). Peça outro.'];
        if (same_name($invite['owner'], $me['name'])) return ['ok' => false, 'error' => 'Esse convite é seu: mande para quem você quer adicionar.'];
        $room = use_invite($invite, $me['name']);
        return ['ok' => true, 'room' => $room['id'], 'peer' => room_peer($room, $me['name'])];
    }
    return ['ok' => false, 'error' => 'Ação desconhecida.'];
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
    return ['now' => null, 'queue' => [], 'pending' => [], 'playing' => false, 'position' => 0, 'updatedAt' => 0];
}

// Cada conversa tem o seu tocador (settings: music:<conversa>).
function music_state(string $room, bool $lock = false): array
{
    if ($lock) query('INSERT IGNORE INTO ' . t('settings') . " (name, value) VALUES (?, '{}')", ["music:$room"]);
    $raw = query('SELECT value FROM ' . t('settings') . ' WHERE name = ?' . ($lock ? ' FOR UPDATE' : ''), ["music:$room"])->fetchColumn();
    $state = $raw ? json_decode((string) $raw, true) : null;
    return is_array($state) ? array_merge(music_blank(), $state) : music_blank();
}

function save_music(string $room, array $state): void
{
    query('INSERT INTO ' . t('settings') . ' (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)', ["music:$room", encode($state)]);
}

// serverNow: o navegador compara com o próprio relógio para saber em que segundo a música está.
function music_public(array $state): array
{
    return $state + ['serverNow' => now_ms()];
}

// Cartão do Potato DJ no chat (mensagem de quem pediu a música).
function post_music_card(array $me, string $room, array $track, int $queued): void
{
    $row = [
        'id' => uuid(), 'client_id' => null, 'sender' => $me['name'], 'text' => '', 'created_at' => iso(), 'reply_to' => null,
        'reactions' => '{}', 'deleted' => 0, 'source' => 'music', 'media' => encode(['music' => $track + ['queued' => $queued]]), 'room' => $room,
    ];
    insert_message($row);
    emit('message', to_message($row), 'all', null, null, $room);
}

// Comandos: play (com query = pede música; sem = continua), pause, resume, seek, skip, ended (a música acabou), stop,
// remove (tira da fila) e jump (toca agora uma da fila).
function music_act(array $me, array $body, ?array $localTrack = null): array
{
    if (!$me['room']) return ['ok' => false, 'error' => 'Escolha uma conversa.'];
    $room = $me['room']['id'];
    $op = str($body['op'] ?? '');
    $query = text_slice(text_trim(str($body['query'] ?? '')), 300);
    if ($op === 'playl') return local_music_request($me, $query);
    $track = $localTrack ? $localTrack + ['uid' => bin2hex(random_bytes(8)), 'by' => $me['name']] : null;
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
    $state = music_state($room, true);
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
                    $state = array_merge($state, ['now' => $track, 'playing' => true, 'position' => 0, 'updatedAt' => $now]);
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
            $state = array_merge($state, ['now' => $picked, 'playing' => true, 'position' => 0, 'updatedAt' => $now]);
            $action['track'] = $picked;
            break;
        default:
            return ['ok' => false, 'error' => 'Comando de música desconhecido.'];
    }
    save_music($room, $state);
    if ($track) post_music_card($me, $room, $card ?? $track, $action['queued']);
    $public = music_public($state);
    emit('music', ['state' => $public, 'action' => $action, 'room' => $room], 'all', null, null, $room);
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

// local: mandando um vídeo do aparelho para o servidor.
const WATCH_SERVICES = ['youtube', 'netflix', 'max', 'twitch', 'local'];

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

// "Vistos por vocês": os 12 últimos da sala, sem repetir. O vídeo do aparelho fica de fora (o arquivo sai do servidor
// quando a sala troca de vídeo), e da Netflix e da HBO Max só entra o que tem título certo (o endereço de um filme ou episódio).
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

// Cada conversa tem a sua sala (settings: watch:<conversa>).
function watch_state(string $room, bool $lock = false): array
{
    if ($lock) query('INSERT IGNORE INTO ' . t('settings') . " (name, value) VALUES (?, '{}')", ["watch:$room"]);
    $raw = query('SELECT value FROM ' . t('settings') . ' WHERE name = ?' . ($lock ? ' FOR UPDATE' : ''), ["watch:$room"])->fetchColumn();
    $state = $raw ? json_decode((string) $raw, true) : null;
    return is_array($state) ? array_merge(watch_blank(), $state) : watch_blank();
}

function save_watch(string $room, array $state): void
{
    query('INSERT INTO ' . t('settings') . ' (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)', ["watch:$room", encode($state)]);
}

function watch_public(array $state): array
{
    return $state + ['serverNow' => now_ms()];
}

// Comandos: start (query = link ou nome; video = escolhido no catálogo; local = vídeo do aparelho, já no servidor), pause, resume,
// seek, ended, countdown, browse (quem está escolhendo), stop e search (o catálogo, sem mexer na sala).
function watch_act(array $me, array $body): array
{
    $op = str($body['op'] ?? '');
    if ($op === 'search') return watch_catalog($body);
    if (!$me['room']) return ['ok' => false, 'error' => 'Escolha uma conversa.'];
    $room = $me['room']['id'];
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
            // O vídeo que esta pessoa mandou para esta conversa (api.php?action=watch-upload), já inteiro.
            $file = find_watch_file(str($local['key'] ?? ''));
            if (!$file || $file['room'] !== $room || !same_name($file['owner'], $me['name'])) return ['ok' => false, 'error' => 'Esse vídeo não está mais no servidor. Escolha de novo.'];
            clearstatcache();
            if ((int) @filesize(watch_file_path($file['key'])) < $file['size']) return ['ok' => false, 'error' => 'O vídeo ainda não terminou de subir.'];
            $item = ['source' => 'local', 'title' => $file['name'], 'name' => $file['name'], 'key' => $file['key'], 'url' => 'api.php?action=watch-file&k=' . $file['key'],
                'size' => $file['size'], 'duration' => max(0, min(86400, (float) ($local['duration'] ?? 0)))];
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
    $state = watch_state($room, true);
    $before = $state['now'];
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
            // Netflix e HBO Max: os dois players ficam parados no mesmo segundo até STREAM_START_MS e começam juntos
            // (dá tempo de o título carregar no aparelho da outra pessoa), sem contagem na tela.
            $state = ['now' => $item, 'playing' => true, 'position' => $streamed ? ($reported ?? 0) : 0, 'updatedAt' => $now + ($streamed ? STREAM_START_MS : 0),
                'browsing' => null, 'recent' => watch_recent($state['recent'], $item)];
            $action['item'] = $item;
            // Os dois sons juntos não dá: a música pausa.
            $music = music_state($room, true);
            if ($music['now'] && $music['playing']) {
                $music['position'] += ($now - $music['updatedAt']) / 1000;
                $music['playing'] = false;
                $music['updatedAt'] = $now;
                save_music($room, $music);
                emit('music', ['state' => music_public($music), 'action' => ['op' => 'pause', 'by' => $me['name']], 'room' => $room], 'all', null, null, $room);
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
                // Netflix e HBO Max: continuam juntos um instante depois (o aviso chega nos dois antes).
                $state['updatedAt'] = $now + (in_array($state['now']['source'] ?? '', ['netflix', 'max'], true) ? STREAM_RESUME_MS : 0);
            }
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
    save_watch($room, $state);
    // Trocou de vídeo ou fechou: o arquivo do vídeo do aparelho que passava sai do servidor.
    if (($before['source'] ?? '') === 'local' && isset($before['key']) && ($state['now']['key'] ?? '') !== $before['key']) drop_watch_file((string) $before['key']);
    $public = watch_public($state);
    emit('watch', ['state' => $public, 'action' => $action, 'room' => $room], 'all', null, null, $room);
    return ['ok' => true, 'state' => $public, 'action' => $action];
}

// ---------- Watch Party: vídeo do aparelho no servidor ----------
// Quem escolhe manda o arquivo em pedaços (api.php?action=watch-upload) e cada um assiste de lá
// (api.php?action=watch-file): quem mandou pode sair que o vídeo continua. O arquivo fica em filmes/<chave>; o dono, a
// conversa, o nome, o tamanho e o tipo, em settings (watchfile:<chave>).

// Pedaço do envio: 8 MB, ou menos se o post_max_size da hospedagem não deixar.
function watch_chunk(): int
{
    $post = ini_bytes((string) ini_get('post_max_size'));
    return $post > 0 ? max(65536, min(WATCH_CHUNK, $post - 65536)) : WATCH_CHUNK;
}

function watch_file_path(string $key): string
{
    return WATCH_DIR . '/' . $key;
}

function find_watch_file(string $key): ?array
{
    if (!preg_match('/^[0-9a-f]{32}$/', $key)) return null;
    $raw = query('SELECT value FROM ' . t('settings') . ' WHERE name = ?', ["watchfile:$key"])->fetchColumn();
    $file = $raw ? json_decode((string) $raw, true) : null;
    return is_array($file) ? $file : null;
}

function save_watch_file(array $file): void
{
    query('INSERT INTO ' . t('settings') . ' (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)', ['watchfile:' . $file['key'], encode($file)]);
}

function drop_watch_file(string $key): void
{
    if (!preg_match('/^[0-9a-f]{32}$/', $key)) return;
    @unlink(watch_file_path($key));
    query('DELETE FROM ' . t('settings') . ' WHERE name = ?', ["watchfile:$key"]);
}

// Antes de um envio novo: sai o que a conversa tinha e não está passando (um envio por vez em cada sala), e o que
// alguém largou no meio há mais de um dia.
function prune_watch_files(string $room): void
{
    foreach (query('SELECT value FROM ' . t('settings') . " WHERE name LIKE 'watchfile:%'")->fetchAll(PDO::FETCH_COLUMN) as $raw) {
        $file = json_decode((string) $raw, true);
        if (!is_array($file) || !isset($file['key'], $file['room'])) continue;
        if ((watch_state((string) $file['room'])['now']['key'] ?? '') === $file['key']) continue;
        if ($file['room'] === $room || now_ms() - (int) ($file['at'] ?? 0) > DAY_MS) drop_watch_file((string) $file['key']);
    }
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
function transcribe_message(string $id, string $name): array
{
    if (str(config()['transcribe_key']) === '') return ['ok' => false, 'error' => 'A transcrição ainda não foi ativada: falta a chave no config.php (veja o LEIA-ME).'];
    $voiceFile = function (?array $row): ?array {
        $media = $row && !$row['deleted'] && !empty($row['media']) ? json_decode((string) $row['media'], true) : null;
        return is_array($media['file']['voice'] ?? null) ? $media : null;
    };
    $media = $voiceFile(member_message($name, $id));
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
        emit_message('message:update', to_message($row));
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
//   letter → cartinha para a outra pessoa, com fotos e áudios (só quem escreveu muda ou apaga);
//   prefs  → de cada pessoa: os hábitos da rotina, os horários dos lembretes e os lembretes já mostrados.
// As fotos (e os áudios das cartinhas) ficam na tabela files, como as das mensagens, com o id do registro no lugar
// de message_id.

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
const PAPERS = ['creme', 'rosa', 'azul', 'lilas', 'verde', 'branco', 'amarelo', 'pessego', 'kraft', 'noite'];
// Fundo e borda do papel (mesmas listas do app.js; o primeiro é o padrão).
const LETTER_PATTERNS = ['linhas', 'liso', 'quadriculado', 'pontos', 'coracoes', 'estrelas'];
const LETTER_BORDERS = ['nenhuma', 'simples', 'dupla', 'pontilhada', 'rosa'];
// Letras da cartinha (mesma lista do app.js; o primeiro é o padrão) e quantas fotos e áudios cabem nela.
const LETTER_FONTS = ['classica', 'mao', 'cursiva', 'bilhete', 'maquina', 'moderna'];
const LETTER_PHOTOS = 6;
const LETTER_AUDIOS = 3;

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

// Áudio de uma cartinha: a chave de um áudio enviado por api.php?action=upload (solto, de quem está salvando, ou que já
// é dela), com a duração e a forma de onda medidas no navegador. voice = gravado na hora (senão, um arquivo, que fica
// com o nome dele). Devolve o que fica guardado, ou null.
function item_audio($audio, string $owner, string $itemId): ?array
{
    $key = is_array($audio) ? str($audio['key'] ?? '') : '';
    if (!preg_match('/^[0-9a-f]{32}$/', $key)) return null;
    $file = query('SELECT name FROM ' . t('files') . " WHERE file_key = ? AND kind IN ('audio', 'video') AND (message_id = ? OR (message_id IS NULL AND owner = ?))", [$key, $itemId, $owner])->fetch();
    $sound = clean_voice($audio);
    if (!$file || !$sound) return null;
    $voice = (bool) ($audio['voice'] ?? false);
    return ['key' => $key, 'url' => file_url($key), 'name' => $voice ? 'Mensagem de voz' : $file['name'], 'voice' => $voice] + $sound;
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
    emit_us(['kind' => 'habits', 'by' => $me['name'], 'owner' => $me['name'], 'habits' => $habits]);
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
    emit_us(['kind' => 'prompts', 'by' => $me['name']], 'self', $me);
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
    emit_us(['kind' => 'day', 'by' => $me['name'], 'item' => $item, 'meal' => $meal]);
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
        unset($item['body'], $item['html'], $item['decor']);
    }
    return $item;
}

// Texto com formatação (o editor da cartinha, como num Word): só as marcas de LETTER_TAGS e os estilos de clean_style
// passam, sem nenhum outro atributo. Marca desconhecida sai e o texto dela fica; script, style e afins somem inteiros.
const LETTER_TAGS = ['p', 'div', 'br', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'blockquote', 'font'];
const LETTER_DROP = ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'head', 'title', 'meta', 'link', 'img', 'video', 'audio', 'form', 'input', 'button', 'textarea', 'select', 'frame', 'frameset'];
const LETTER_HTML_MAX = 150000;
// As letras do editor (mesmas do app.js e do styles.css): o nome que o navegador escreve → a fonte com o reserva.
const LETTER_FAMILIES = [
    'georgia' => 'Georgia, "Times New Roman", serif', 'caveat' => '"Caveat", cursive', 'dancing script' => '"Dancing Script", cursive',
    'patrick hand' => '"Patrick Hand", cursive', 'special elite' => '"Special Elite", "Courier New", monospace', 'poppins' => '"Poppins", sans-serif', 'inter' => '"Inter", sans-serif',
];
const LETTER_SIZES = ['x-small', 'small', 'medium', 'large', 'x-large', 'xx-large', 'xxx-large'];

function clean_css_color(string $value): ?string
{
    $value = strtolower(trim($value));
    if (preg_match('/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/', $value)) return $value;
    if (preg_match('/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d+)\s*)?\)$/', $value, $m) && max($m[1], $m[2], $m[3]) <= 255) {
        return isset($m[4]) ? "rgba($m[1], $m[2], $m[3], $m[4])" : "rgb($m[1], $m[2], $m[3])";
    }
    return $value === 'transparent' ? $value : null;
}

function clean_style(string $style): string
{
    $out = [];
    foreach (explode(';', $style) as $rule) {
        $parts = explode(':', $rule, 2);
        if (count($parts) < 2) continue;
        $prop = strtolower(trim($parts[0]));
        $value = strtolower(trim(str_ireplace('!important', '', $parts[1])));
        switch ($prop) {
            case 'color':
            case 'background-color':
                $color = clean_css_color($value);
                if ($color) $out[$prop] = $color;
                break;
            case 'font-size':
                if (in_array($value, LETTER_SIZES, true)) $out[$prop] = $value;
                elseif (preg_match('/^(\d{1,2}(?:\.\d{1,2})?)px$/', $value, $m) && $m[1] >= 8 && $m[1] <= 72) $out[$prop] = $value;
                break;
            case 'font-family':
                $family = trim(explode(',', $value)[0], " \"'");
                if (isset(LETTER_FAMILIES[$family])) $out[$prop] = LETTER_FAMILIES[$family];
                break;
            case 'font-weight':
                if (preg_match('/^(bold|bolder|normal|[1-9]00)$/', $value)) $out[$prop] = $value;
                break;
            case 'font-style':
                if (in_array($value, ['italic', 'normal'], true)) $out[$prop] = $value;
                break;
            case 'text-decoration':
            case 'text-decoration-line':
                $lines = array_values(array_intersect(preg_split('/\s+/', $value), ['underline', 'line-through', 'none']));
                if ($lines) $out['text-decoration-line'] = implode(' ', $lines);
                break;
            case 'text-align':
                if (in_array($value, ['left', 'center', 'right', 'justify', 'start', 'end'], true)) $out[$prop] = $value;
                break;
        }
    }
    return implode('; ', array_map(fn($prop, $value) => "$prop: $value", array_keys($out), $out));
}

function letter_nodes(DOMNode $node, int $depth = 0): string
{
    $out = '';
    foreach ($node->childNodes as $child) {
        if ($child instanceof DOMText) {
            $out .= htmlspecialchars($child->nodeValue, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
            continue;
        }
        if (!$child instanceof DOMElement) continue;
        $tag = strtolower($child->tagName);
        if (in_array($tag, LETTER_DROP, true) || $depth > 40) continue;
        if ($tag === 'br') {
            $out .= '<br>';
            continue;
        }
        $inner = letter_nodes($child, $depth + 1);
        if (!in_array($tag, LETTER_TAGS, true)) {
            $out .= $inner;
            continue;
        }
        $style = $child->getAttribute('style');
        // <font> (alguns navegadores ainda escrevem assim) vira <span> com o mesmo estilo.
        if ($tag === 'font') {
            $tag = 'span';
            $size = (int) $child->getAttribute('size');
            if ($size >= 1 && $size <= 7) $style .= ';font-size:' . LETTER_SIZES[$size - 1];
            if ($child->hasAttribute('color')) $style .= ';color:' . $child->getAttribute('color');
            if ($child->hasAttribute('face')) $style .= ';font-family:' . $child->getAttribute('face');
        }
        $style = clean_style($style);
        $attrs = $style !== '' ? ' style="' . htmlspecialchars($style, ENT_QUOTES, 'UTF-8') . '"' : '';
        $out .= "<$tag$attrs>$inner</$tag>";
    }
    return $out;
}

function clean_letter_html(string $html): string
{
    if (trim($html) === '') return '';
    // Sem a extensão DOM do PHP (rara numa hospedagem), a cartinha vai como texto puro.
    if (!class_exists('DOMDocument')) return htmlspecialchars(html_entity_decode(strip_tags(preg_replace('#<br>|</(?:p|div|li|h\d)>#i', "\n", $html) ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8'), ENT_QUOTES, 'UTF-8');
    $doc = new DOMDocument();
    $errors = libxml_use_internal_errors(true);
    $doc->loadHTML('<?xml encoding="utf-8"?><body>' . $html . '</body>', LIBXML_NONET);
    libxml_clear_errors();
    libxml_use_internal_errors($errors);
    $body = $doc->getElementsByTagName('body')->item(0);
    return $body ? letter_nodes($body) : '';
}

// O texto puro da cartinha formatada (prévia da lista e o "tem alguma coisa escrita?").
function letter_text(string $html): string
{
    $text = preg_replace('#<br>|</(?:p|div|li|h1|h2|h3|blockquote)>#', "\n", $html) ?? $html;
    return clean_body(html_entity_decode(strip_tags($text), ENT_QUOTES | ENT_HTML5, 'UTF-8'), LETTER_MAX);
}

// Imagens e figurinhas soltas no papel, cada uma onde a pessoa deixou: x e y (o centro) e w (a largura) em fração do
// papel, rot em graus, z (quem fica por cima) e a moldura. Foto: uma imagem enviada (como as fotos da cartinha).
// Figurinha: da coleção de quem escreve, ou que já estava na cartinha ($old: endereço → [largura, altura]).
const LETTER_DECOR = 16;
const DECOR_FRAMES = ['none', 'polaroid', 'round', 'tape', 'shadow'];

function letter_decor($item, string $owner, string $itemId, array $old): ?array
{
    if (!is_array($item)) return null;
    $number = fn($key, float $min, float $max, float $default): float => is_numeric($item[$key] ?? null) ? round(max($min, min($max, (float) $item[$key])), 4) : $default;
    $place = ['x' => $number('x', 0, 1, .5), 'y' => $number('y', 0, 1, .5), 'w' => $number('w', .06, 1, .3), 'rot' => $number('rot', -180, 180, 0),
        'z' => (int) $number('z', 0, 99, 1), 'frame' => clean_choice($item['frame'] ?? 'none', DECOR_FRAMES, 'none')];
    $type = $item['type'] ?? '';
    if ($type === 'photo') {
        $photo = item_photo($item, $owner, $itemId);
        return $photo ? ['type' => 'photo'] + $photo + $place : null;
    }
    if ($type !== 'sticker') return null;
    $url = str($item['url'] ?? '');
    if (isset($old[$url])) return ['type' => 'sticker', 'url' => $url, 'width' => $old[$url][0], 'height' => $old[$url][1]] + $place;
    $sticker = sticker_media($item, $owner);
    return $sticker ? ['type' => 'sticker', 'url' => $sticker['url'], 'width' => $sticker['width'], 'height' => $sticker['height']] + $place : null;
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
            emit_us(['kind' => 'event', 'by' => $me['name'], 'item' => $item, 'created' => !$row]);
            return ['ok' => true, 'item' => $item];

        case 'event:delete':
            $row = find_item('event', $id);
            if ($row) {
                delete_item($row);
                emit_us(['kind' => 'event', 'by' => $me['name'], 'id' => $id, 'deleted' => true, 'title' => item_data($row)['title'] ?? '']);
            }
            return ['ok' => true];

        case 'goal:save':
            $row = $id !== '' ? find_item('goal', $id) : null;
            if ($id !== '' && !$row) return ['ok' => false, 'error' => 'Esse sonho foi apagado.'];
            $goal = clean_goal($body, $row ? item_data($row) : []);
            if (!$goal) return ['ok' => false, 'error' => 'Dê um nome para o sonho ou a meta.'];
            $item = item_public(save_item($row, $row['id'] ?? uuid(), 'goal', $row['owner'] ?? $me['name'], null, $goal));
            emit_us(['kind' => 'goal', 'by' => $me['name'], 'item' => $item, 'action' => $row ? 'edit' : 'new']);
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
            emit_us(['kind' => 'goal', 'by' => $me['name'], 'item' => $item, 'action' => substr($op, 5)] + $extra);
            return ['ok' => true, 'item' => $item];

        case 'goal:delete':
            $row = find_item('goal', $id);
            if ($row) {
                delete_item($row);
                emit_us(['kind' => 'goal', 'by' => $me['name'], 'id' => $id, 'deleted' => true]);
            }
            return ['ok' => true];

        case 'letter:save':
            $row = $id !== '' ? find_item('letter', $id) : null;
            if ($id !== '' && !$row) return ['ok' => false, 'error' => 'Essa cartinha foi apagada.'];
            if ($row && $row['owner'] !== $me['name']) return ['ok' => false, 'error' => 'Só quem escreveu muda a cartinha.'];
            $itemId = $row['id'] ?? uuid();
            // Formatada (html, do editor) ou texto puro (body, como antes).
            $html = clean_letter_html(str($body['html'] ?? ''));
            if (strlen($html) > LETTER_HTML_MAX) return ['ok' => false, 'error' => 'A cartinha ficou grande demais. Tire um pouco da formatação.'];
            $text = $html !== '' ? letter_text($html) : clean_body($body['body'] ?? '', LETTER_MAX);
            if ($text === '') $html = '';
            $photos = array_values(array_filter(array_map(fn($photo) => item_photo($photo, $me['name'], $itemId), array_slice((array) ($body['photos'] ?? []), 0, LETTER_PHOTOS))));
            $audios = array_values(array_filter(array_map(fn($audio) => item_audio($audio, $me['name'], $itemId), array_slice((array) ($body['audios'] ?? []), 0, LETTER_AUDIOS))));
            $old = $row ? item_data($row) : [];
            $oldStickers = [];
            foreach ((array) ($old['decor'] ?? []) as $piece) if (($piece['type'] ?? '') === 'sticker') $oldStickers[$piece['url']] = [$piece['width'], $piece['height']];
            $decor = array_values(array_filter(array_map(fn($piece) => letter_decor($piece, $me['name'], $itemId, $oldStickers), array_slice((array) ($body['decor'] ?? []), 0, LETTER_DECOR))));
            if ($text === '' && !$photos && !$audios && !$decor) return ['ok' => false, 'error' => 'Escreva alguma coisa na cartinha.'];
            $paperColor = preg_match('/^#[0-9a-f]{6}$/i', str($body['paperColor'] ?? '')) ? strtolower($body['paperColor']) : '';
            $letter = [
                'title' => clean_line($body['title'] ?? '', 120) ?: 'Cartinha',
                'body' => $text,
                'html' => $html,
                'paper' => in_array($body['paper'] ?? '', PAPERS, true) ? $body['paper'] : 'creme',
                'paperColor' => $paperColor,
                'pattern' => clean_choice($body['pattern'] ?? '', LETTER_PATTERNS, LETTER_PATTERNS[0]),
                'border' => clean_choice($body['border'] ?? '', LETTER_BORDERS, LETTER_BORDERS[0]),
                'font' => in_array($body['font'] ?? '', LETTER_FONTS, true) ? $body['font'] : LETTER_FONTS[0],
                'photos' => $photos,
                'audios' => $audios,
                'decor' => $decor,
                'to' => $old['to'] ?? peer_of($me['name']),
                'readAt' => $old['readAt'] ?? null,
                'edited' => (bool) $row,
            ];
            $saved = save_item($row, $itemId, 'letter', $me['name'], null, $letter);
            keep_photos($itemId, $me['name'], array_merge(array_column($photos, 'key'), array_column($audios, 'key'), array_column(array_filter($decor, fn($piece) => $piece['type'] === 'photo'), 'key')));
            emit_us(['kind' => 'letter', 'by' => $me['name'], 'item' => letter_public($saved), 'action' => $row ? 'edit' : 'new']);
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
                emit_us(['kind' => 'letter', 'by' => $me['name'], 'item' => letter_public($row), 'action' => 'read']);
            }
            return ['ok' => true, 'item' => letter_public($row, true)];

        case 'letter:delete':
            $row = find_item('letter', $id);
            if ($row && $row['owner'] !== $me['name']) return ['ok' => false, 'error' => 'Só quem escreveu apaga a cartinha.'];
            if ($row) {
                delete_item($row);
                emit_us(['kind' => 'letter', 'by' => $me['name'], 'id' => $id, 'deleted' => true]);
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
//              10 pontos por resposta certa, 5 se os dois escreveram a mesma;
//   linha4   → 4 em linha (as vermelhas são de quem começou): a peça cai na coluna, 4 seguidas em qualquer direção ganha;
//   forca    → forca com a palavra e a dica de lib/jogos.php: acertou a letra, pontua e joga de novo. A palavra nunca
//              sai do servidor antes do fim.
// Cartas com spicy (modo +18): o baralho com 18 no fim do nome.

const GAME_NAMES = [
    'vd' => 'Verdade ou desafio', 'quem' => 'Quem é mais provável?', 'isso' => 'Isso ou aquilo', 'pergunta' => 'Perguntinha',
    'velha' => 'Jogo da velha', 'dama' => 'Dama', 'memoria' => 'Jogo da memória', 'stop' => 'Stop',
    'linha4' => '4 em linha', 'forca' => 'Forca',
];
// 4 em linha: 7 colunas e 6 linhas (casas 0 a 41, linha a linha de cima para baixo); a peça cai até a casa vazia mais
// baixa da coluna. Forca: quantos erros até o boneco ficar completo.
const LINHA4_COLS = 7;
const LINHA4_ROWS = 6;
const FORCA_LIVES = 6;
// Os jogos de carta com baralho +18 (modo 🔥): o baralho "verdade18", "quem18"…
const SPICY_GAMES = ['vd', 'quem', 'isso', 'pergunta'];
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

// Jogadas possíveis de uma cor ([from, to, over]: over = a peça capturada). A pedra anda e come só para a frente; a dama
// anda e come de longe, para todos os lados. Havendo captura, só valem as capturas; no meio de uma sequência (chain), só
// as capturas da peça que está capturando.
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
            // A pedra come só para a frente; a dama, para todos os lados.
            if (!$king && $dr !== $forward) continue;
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
            // O que foi comido (a casa e a peça) e o número da jogada: o navegador anima só a jogada nova.
            $game['taken'] = $move[2] !== null ? ['at' => $move[2], 'piece' => $board[$move[2]]] : null;
            $game['ply'] = ($game['ply'] ?? 0) + 1;
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

        case 'linha4:drop':
            $col = $body['col'] ?? null;
            if (!is_int($col) || $col < 0 || $col >= LINHA4_COLS) return 'Escolha uma coluna.';
            $cell = null;
            for ($row = LINHA4_ROWS - 1; $row >= 0 && $cell === null; $row--) if ($game['board'][$row * LINHA4_COLS + $col] === '') $cell = $row * LINHA4_COLS + $col;
            if ($cell === null) return 'Essa coluna está cheia.';
            $piece = $seat === 0 ? 'R' : 'Y';
            $game['board'][$cell] = $piece;
            $game['last'] = $cell;
            $line = linha4_line($game['board'], $cell);
            if ($line) {
                $game['winner'] = $me;
                $game['line'] = $line;
            } elseif (!in_array('', $game['board'], true)) {
                $game['winner'] = 'empate';
            } else {
                $game['turn'] = $other;
            }
            return null;

        // Forca: acertou, ganha um ponto por letra que apareceu e joga de novo; errou, o boneco ganha uma parte e a vez
        // passa. Palavra completa: ganha quem fez mais pontos. Boneco completo: ninguém ganha.
        case 'forca:guess':
            $letter = fold(str($body['letter'] ?? ''));
            if (!preg_match('/^[a-z]$/', $letter)) return 'Escolha uma letra.';
            if (in_array($letter, $game['guessed'], true)) return 'Essa letra já foi.';
            $game['guessed'][] = $letter;
            $hits = substr_count(fold($game['word']), $letter);
            $game['last'] = ['by' => $me, 'letter' => $letter, 'hits' => $hits];
            if ($hits) {
                $game['scores'][$me] += $hits;
                if (!in_array(null, forca_mask($game), true)) $game['winner'] = best_of($game['scores']);
            } elseif (++$game['wrong'] >= FORCA_LIVES) {
                $game['winner'] = 'empate';
                $game['hanged'] = true;
            } else {
                $game['turn'] = $other;
            }
            return null;
    }
    return 'Jogada desconhecida.';
}

// As 4 (ou mais) casas em linha que passam pela peça que acabou de cair, ou null.
function linha4_line(array $board, int $cell): ?array
{
    $piece = $board[$cell];
    $row = intdiv($cell, LINHA4_COLS);
    $col = $cell % LINHA4_COLS;
    foreach ([[0, 1], [1, 0], [1, 1], [1, -1]] as [$dr, $dc]) {
        $line = [$cell];
        foreach ([1, -1] as $sign) {
            for ($step = 1; $step < 4; $step++) {
                $r = $row + $dr * $step * $sign;
                $c = $col + $dc * $step * $sign;
                if ($r < 0 || $r >= LINHA4_ROWS || $c < 0 || $c >= LINHA4_COLS || $board[$r * LINHA4_COLS + $c] !== $piece) break;
                $line[] = $r * LINHA4_COLS + $c;
            }
        }
        if (count($line) >= 4) {
            sort($line);
            return $line;
        }
    }
    return null;
}

// A palavra da forca como o navegador vê: as letras já chutadas (com o acento de verdade), null nas que faltam, e
// espaço e hífen à mostra.
function forca_mask(array $game): array
{
    return array_map(fn($char) => preg_match('/^[a-z]$/', fold($char)) ? (in_array(fold($char), $game['guessed'], true) ? $char : null) : $char,
        preg_split('//u', $game['word'], -1, PREG_SPLIT_NO_EMPTY));
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
        // A palavra só sai do servidor quando a partida acaba.
        case 'forca':
            $game['mask'] = forca_mask($game);
            $game['scores'] = (object) $game['scores'];
            if (!$game['winner']) unset($game['word']);
            break;
    }
    return $game;
}

function game_act(array $me, array $body): array
{
    $op = str($body['op'] ?? '');
    if ($op === 'new') {
        $type = str($body['type'] ?? '');
        if (!$me['room']) return ['ok' => false, 'error' => 'Escolha uma conversa para jogar.'];
        $peer = room_peer($me['room'], $me['name']);
        // Modo +18: o baralho apimentado (verdade18, quem18…), marcado na partida com spicy.
        $spicy = ($body['spicy'] ?? false) === true && in_array($type, SPICY_GAMES, true);
        $deck = fn(string $name): string => $spicy ? $name . '18' : $name;
        switch ($type) {
            case 'vd':
                $game = ['type' => 'vd', 'for' => $peer, 'choice' => null, 'prompt' => null];
                break;
            case 'quem':
            case 'pergunta':
                $game = ['type' => $type, 'prompt' => draw_card($deck($type)), ($type === 'quem' ? 'votes' : 'answers') => []] + ($type === 'quem' ? ['names' => [$me['name'], $peer]] : []);
                break;
            case 'isso':
                $game = ['type' => 'isso', 'options' => draw_card($deck('isso')), 'votes' => []];
                break;
            case 'linha4':
                $game = ['type' => 'linha4', 'seats' => [$me['name'], $peer], 'turn' => $me['name'], 'board' => array_fill(0, LINHA4_COLS * LINHA4_ROWS, ''), 'last' => null, 'winner' => null, 'line' => null];
                break;
            case 'forca':
                [$word, $hint] = draw_card('forca');
                $game = ['type' => 'forca', 'seats' => [$me['name'], $peer], 'turn' => $me['name'], 'word' => $word, 'hint' => $hint, 'guessed' => [], 'wrong' => 0,
                    'lives' => FORCA_LIVES, 'last' => null, 'scores' => [$me['name'] => 0, $peer => 0], 'winner' => null];
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
        if ($spicy) $game['spicy'] = true;
        $row = [
            'id' => uuid(), 'client_id' => null, 'sender' => $me['name'], 'text' => '', 'created_at' => iso(), 'reply_to' => null,
            'reactions' => '{}', 'deleted' => 0, 'source' => 'game', 'media' => encode(['game' => $game]), 'room' => $me['room']['id'],
        ];
        insert_message($row);
        set_read($row['room'], $me['name'], $row['id'], $row['created_at']);
        $message = to_message($row);
        emit_message('message', $message);
        return ['ok' => true, 'message' => $message];
    }

    // Placar: as partidas de tabuleiro da conversa que já acabaram (todas, não só as do trecho carregado), por jogo: as
    // vitórias de cada um e os empates.
    if ($op === 'score') {
        $score = [];
        foreach (query('SELECT media FROM ' . t('messages') . " WHERE source = 'game' AND deleted = 0 AND room = ?", [$me['room']['id'] ?? ''])->fetchAll(PDO::FETCH_COLUMN) as $media) {
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

    $row = member_message($me['name'], str($body['id'] ?? ''));
    $media = $row && !$row['deleted'] && $row['media'] ? json_decode((string) $row['media'], true) : null;
    $game = $media['game'] ?? null;
    if (!$game) return ['ok' => false, 'error' => 'Esse jogo não existe mais.'];
    if ($op === 'get') return ['ok' => true, 'message' => to_message($row)];
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
            $game['prompt'] = draw_card($choice . (empty($game['spicy']) ? '' : '18'));
            break;
        case 'vote':
            $value = $body['value'] ?? null;
            $valid = $game['type'] === 'quem' ? in_array($value, $game['names'] ?? [], true) : ($game['type'] === 'isso' && in_array($value, [0, 1], true));
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
    emit_message('message:update', $message);
    return ['ok' => true, 'message' => $message, 'mine' => $mine];
}

// ---------- mensagens ----------

function to_message(array $row): array
{
    $deleted = (bool) $row['deleted'];
    $reactions = json_decode((string) $row['reactions'], true);
    // A coluna media guarda o GIF ({url, width, height, title}), o arquivo ({file: {...}}), o cartão de música
    // ({music: {...}}), o joguinho ({game: {...}}) ou a chamada ({call: {...}}).
    $media = $deleted || empty($row['media']) ? null : json_decode((string) $row['media'], true);
    $file = is_array($media) && isset($media['file']) ? file_info($media['file']) : null;
    $music = is_array($media) && isset($media['music']) ? $media['music'] : null;
    $game = is_array($media) && isset($media['game']) ? game_public($media['game']) : null;
    $call = is_array($media) && isset($media['call']) ? $media['call'] : null;
    return [
        'id' => $row['id'],
        'clientId' => $row['client_id'] !== null && $row['client_id'] !== '' ? $row['client_id'] : null,
        'sender' => $row['sender'],
        'text' => $deleted ? '' : $row['text'],
        'gif' => is_array($media) && !$file && !$music && !$game && !$call ? $media : null,
        'file' => $file,
        'music' => $music,
        'game' => $game,
        'call' => $call,
        'createdAt' => $row['created_at'],
        'replyTo' => $row['reply_to'] ? json_decode($row['reply_to'], true) : null,
        // Reações sempre como objeto JSON ({}), igual à versão Node.
        'reactions' => (object) (is_array($reactions) ? $reactions : []),
        'deleted' => $deleted,
        'source' => $row['source'] ?: 'web',
        'room' => $row['room'] ?? '',
        // Lida pela outra pessoa, e quando (readAt null com read = lida antes de o chat guardar a hora).
        'read' => ($row['read_at'] ?? null) !== null,
        'readAt' => ($row['read_at'] ?? null) ?: null,
    ];
}

function find_message(string $id): ?array
{
    if ($id === '') return null;
    $row = query('SELECT * FROM ' . t('messages') . ' WHERE id = ?', [$id])->fetch();
    return $row ?: null;
}

// A mensagem, se name é da conversa dela (senão, como se não existisse).
function member_message(string $name, string $id): ?array
{
    $row = find_message($id);
    return $row && room_member(find_room((string) $row['room']), $name) ? $row : null;
}

// A mensagem de uma conversa (um trecho nunca começa numa mensagem de outra).
function room_message(string $room, string $id): ?array
{
    $row = find_message($id);
    return $row && $row['room'] === $room ? $row : null;
}

function insert_message(array $row): int
{
    query(
        'INSERT INTO ' . t('messages') . ' (id, client_id, sender, text, created_at, reply_to, reactions, deleted, source, media, room) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [$row['id'], $row['client_id'], $row['sender'], $row['text'], $row['created_at'], $row['reply_to'], $row['reactions'], $row['deleted'], $row['source'], $row['media'], $row['room']]
    );
    return (int) db()->lastInsertId();
}

function page(string $room, string $before = ''): array
{
    $limit = PAGE_SIZE + 1;
    if ($before !== '') {
        $anchor = room_message($room, $before);
        if (!$anchor) return ['items' => [], 'hasMore' => false];
        $rows = query('SELECT * FROM ' . t('messages') . " WHERE room = ? AND n < ? ORDER BY n DESC LIMIT $limit", [$room, $anchor['n']])->fetchAll();
    } else {
        $rows = query('SELECT * FROM ' . t('messages') . " WHERE room = ? ORDER BY n DESC LIMIT $limit", [$room])->fetchAll();
    }
    $hasMore = count($rows) > PAGE_SIZE;
    $rows = array_reverse(array_slice($rows, 0, PAGE_SIZE));
    return ['items' => array_map('to_message', $rows), 'hasMore' => $hasMore];
}

// Um trecho antigo da conversa (pesquisa ou "ir para o dia"): a mensagem pedida (id), ou a primeira desde from (hora
// ISO do começo do dia, no fuso de quem pediu; depois da última, a última), com metade da página antes e o resto
// depois. hasNewer = ainda tem mensagens depois do trecho.
function around(string $room, string $id, string $from = ''): array
{
    if ($id !== '') {
        $anchor = room_message($room, $id);
    } elseif (preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/', $from)) {
        $anchor = query('SELECT * FROM ' . t('messages') . ' WHERE room = ? AND created_at >= ? ORDER BY n LIMIT 1', [$room, $from])->fetch()
            ?: query('SELECT * FROM ' . t('messages') . ' WHERE room = ? ORDER BY n DESC LIMIT 1', [$room])->fetch();
    } else {
        return ['ok' => false, 'error' => 'Dia inválido.'];
    }
    if (!$anchor) return ['ok' => false, 'error' => $id !== '' ? 'Essa mensagem não existe mais.' : 'A conversa ainda está vazia.'];
    $before = intdiv(PAGE_SIZE, 2);
    $after = PAGE_SIZE - $before - 1;
    $older = query('SELECT * FROM ' . t('messages') . ' WHERE room = ? AND n < ? ORDER BY n DESC LIMIT ' . ($before + 1), [$room, $anchor['n']])->fetchAll();
    $newer = query('SELECT * FROM ' . t('messages') . ' WHERE room = ? AND n > ? ORDER BY n LIMIT ' . ($after + 1), [$room, $anchor['n']])->fetchAll();
    $rows = array_merge(array_reverse(array_slice($older, 0, $before)), [$anchor], array_slice($newer, 0, $after));
    return ['ok' => true, 'items' => array_map('to_message', $rows), 'target' => $anchor['id'], 'hasMore' => count($older) > $before, 'hasNewer' => count($newer) > $after];
}

// Descendo num trecho antigo: a página depois de after, e hasNewer se ainda tem mais.
function page_after(string $room, string $after): array
{
    $anchor = room_message($room, $after);
    if (!$anchor) return ['items' => [], 'hasNewer' => false];
    $rows = query('SELECT * FROM ' . t('messages') . ' WHERE room = ? AND n > ? ORDER BY n LIMIT ' . (PAGE_SIZE + 1), [$room, $anchor['n']])->fetchAll();
    return ['items' => array_map('to_message', array_slice($rows, 0, PAGE_SIZE)), 'hasNewer' => count($rows) > PAGE_SIZE];
}

// Pesquisa na conversa: o texto (e a legenda das fotos), o nome dos arquivos, a transcrição dos áudios e as músicas
// pedidas, sem diferença de maiúsculas nem acentos. Das mais novas para as mais antigas, SEARCH_PAGE por vez
// (before = id da última que já veio). O LIKE do banco separa as candidatas e o fold confere onde o termo está (no
// JSON da coluna media, o LIKE também acharia os nomes dos campos).
function search_messages(string $room, string $query, string $before = ''): array
{
    $query = text_slice(text_trim(preg_replace('/\s+/u', ' ', $query) ?? ''), 100);
    $needle = fold($query);
    if (text_length($needle) < 2) return ['ok' => false, 'error' => 'Escreva pelo menos 2 letras.'];
    $from = PHP_INT_MAX;
    if ($before !== '') {
        $anchor = room_message($room, $before);
        if (!$anchor) return ['ok' => true, 'items' => [], 'hasMore' => false];
        $from = (int) $anchor['n'];
    }
    $like = '%' . strtr($query, ['!' => '!!', '%' => '!%', '_' => '!_']) . '%';
    $found = [];
    $more = false;
    do {
        $rows = query('SELECT * FROM ' . t('messages') . " WHERE room = ? AND deleted = 0 AND n < ? AND (text LIKE ? ESCAPE '!' OR media LIKE ? ESCAPE '!') ORDER BY n DESC LIMIT 200", [$room, $from, $like, $like])->fetchAll();
        foreach ($rows as $row) {
            $from = (int) $row['n'];
            if (!search_hit($row, $needle)) continue;
            if (count($found) === SEARCH_PAGE) {
                $more = true;
                break 2;
            }
            $found[] = to_message($row);
        }
    } while (count($rows) === 200);
    return ['ok' => true, 'items' => $found, 'hasMore' => $more];
}

function search_hit(array $row, string $needle): bool
{
    $media = empty($row['media']) ? [] : (json_decode((string) $row['media'], true) ?: []);
    $file = is_array($media['file'] ?? null) ? $media['file'] : [];
    $music = is_array($media['music'] ?? null) ? $media['music'] : [];
    // O nome do áudio gravado ("Áudio 2026-10-19 14.03.12.m4a") não conta: só a transcrição.
    $fields = [$row['text'], isset($file['voice']) ? '' : ($file['name'] ?? ''), $file['voice']['text'] ?? '', $music['title'] ?? '', $music['artist'] ?? ''];
    foreach ($fields as $field) {
        if (is_string($field) && $field !== '' && strpos(fold($field), $needle) !== false) return true;
    }
    return false;
}

function reads(string $room): array
{
    $reads = [];
    foreach (query('SELECT name, read_id, read_at FROM ' . t('reads') . ' WHERE room = ? AND read_id IS NOT NULL', [$room])->fetchAll() as $row) {
        $reads[$row['name']] = ['id' => $row['read_id'], 'at' => $row['read_at']];
    }
    return $reads;
}

// Até onde cada pessoa da conversa já recebeu (nome → id da mensagem).
function delivered(string $room): array
{
    return query('SELECT name, got_id FROM ' . t('reads') . ' WHERE room = ? AND got_id IS NOT NULL', [$room])->fetchAll(PDO::FETCH_KEY_PAIR);
}

// Um aparelho desta pessoa está conectado (buscou novidades): tudo o que a outra pessoa mandou até agora chegou. Marca em
// cada conversa dela e avisa quem mandou (os ✓✓ cinza). Só escreve quando tem mensagem nova.
function mark_delivered(string $name): void
{
    foreach (rooms_of($name) as $room) {
        $last = query('SELECT id, n FROM ' . t('messages') . ' WHERE room = ? AND sender <> ? ORDER BY n DESC LIMIT 1', [$room['id'], $name])->fetch();
        if (!$last) continue;
        $got = (int) query('SELECT m.n FROM ' . t('reads') . ' r JOIN ' . t('messages') . ' m ON m.id = r.got_id WHERE r.room = ? AND r.name = ?', [$room['id'], $name])->fetchColumn();
        if ($got >= (int) $last['n']) continue;
        query('INSERT INTO ' . t('reads') . ' (room, name, got_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE got_id = VALUES(got_id)', [$room['id'], $name, $last['id']]);
        emit('delivered', ['name' => $name, 'id' => $last['id'], 'room' => $room['id']], 'peer', ['name' => $name], null, $room['id']);
    }
}

// Histórico de quem conecta (ou troca de conversa): a conversa aberta (room, com quem é, as mensagens, as leituras, a
// música, a Watch Party e as partidas dela), a lista de conversas, as chamadas abertas, o tema da conta (null = nunca
// escolheu) e a chave da busca de GIFs (chave do GIPHY, feita para ficar no navegador; vazia = GIFs desligados).
// couple = esta pessoa é do casal (o Nosso cantinho aparece).
function history(string $me, ?array $room): array
{
    $id = $room['id'] ?? '';
    return ($room ? page($id) : ['items' => [], 'hasMore' => false]) + [
        'room' => $id,
        'peer' => $room ? room_peer($room, $me) : null,
        'rooms' => room_list($me),
        'couple' => in_array($me, users(), true) && couple_room() !== null,
        'reads' => (object) ($room ? reads($id) : []),
        'delivered' => (object) ($room ? delivered($id) : []),
        'me' => $me,
        'theme' => find_account($me)['theme'] ?? null,
        'wallpaper' => wallpaper_info(find_account($me)),
        'gifKey' => str(config()['giphy_key']),
        'stickers' => sticker_list($me),
        'countdown' => in_array($me, users(), true) ? countdown_state() : null,
        'fileMax' => file_max(),
        'watchChunk' => watch_chunk(),
        'transcribe' => str(config()['transcribe_key']) !== '',
        'music' => music_public(music_state($id)),
        'watch' => watch_public(watch_state($id)),
        'games' => $room ? open_games($id) : [],
        // As chamadas abertas com esta pessoa: quem conecta depois (estava offline) vê tocando, ou entra nela.
        'calls' => array_values(array_map('call_public', array_filter(all_calls(), fn($call) => in_array($me, [$call['caller'], $call['callee']], true)))),
        'serverNow' => now_ms(),
    ];
}

// Partidas ainda rolando (até 20, das mais novas), que vão junto com o histórico: a mesinha e os avisos continuam
// valendo mesmo quando a partida é mais antiga que as mensagens carregadas (o chat recarrega só as mais novas quando
// fica um tempo sem conexão, como com o celular bloqueado).
function open_games(string $room): array
{
    $open = [];
    foreach (query('SELECT * FROM ' . t('messages') . " WHERE room = ? AND source = 'game' AND deleted = 0 ORDER BY n DESC LIMIT 200", [$room])->fetchAll() as $row) {
        $message = to_message($row);
        $game = $message['game'];
        if (!$game) continue;
        $playing = isset($game['seats']) ? empty($game['winner']) : ($game['type'] === 'vd' ? empty($game['choice']) : empty($game['done']));
        if ($playing) $open[] = $message;
        if (count($open) === 20) break;
    }
    return array_reverse($open);
}

function set_read(string $room, string $name, string $id, string $at): void
{
    query('INSERT INTO ' . t('reads') . ' (room, name, read_id, read_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE read_id = VALUES(read_id), read_at = VALUES(read_at)', [$room, $name, $id, $at]);
}

// name leu até a mensagem row (antes, até a de número from) na conversa dela: as da outra pessoa nesse trecho ganham a
// hora da leitura, que aparece nos dados da mensagem. Devolve quantas.
function mark_read(string $name, array $row, string $at, int $from): int
{
    set_read($row['room'], $name, $row['id'], $at);
    return query('UPDATE ' . t('messages') . ' SET read_at = ? WHERE room = ? AND n > ? AND n <= ? AND sender <> ? AND read_at IS NULL', [$at, $row['room'], $from, $row['n'], $name])->rowCount();
}

// Número da última mensagem da conversa que name leu (0 = nenhuma).
function read_upto(string $room, string $name): int
{
    return (int) query('SELECT m.n FROM ' . t('reads') . ' r JOIN ' . t('messages') . ' m ON m.id = r.read_id WHERE r.room = ? AND r.name = ?', [$room, $name])->fetchColumn();
}

// ---------- conexões, presença e eventos ----------

// Registra um evento para as conexões. Escopos: "all" (todas), "peer" (abas de chat da outra pessoa, ou só a conexão
// "to") e "self" (as minhas outras abas de chat). Com room, só as duas pessoas da conversa recebem.
function emit(string $type, $data = null, string $scope = 'all', ?array $from = null, ?string $to = null, ?string $room = null): void
{
    query(
        'INSERT INTO ' . t('events') . ' (at, type, data, scope, from_conn, from_name, to_conn, room) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [now_ms(), $type, $data === null ? null : encode($data), $scope, $from['conn'] ?? null, $from['name'] ?? null, $to, $room]
    );
}

// Mensagem nova ou mudada: vai para a conversa dela.
function emit_message(string $type, array $message): void
{
    emit($type, $message, 'all', null, null, $message['room']);
}

// Novidade do Nosso cantinho: só o casal.
function emit_us(array $data, string $scope = 'all', ?array $from = null): void
{
    emit('us', $data, $scope, $from, null, couple_room()['id'] ?? null);
}

function event_for(array $event, string $conn, array $client): bool
{
    if (!empty($event['to_conn']) && $event['to_conn'] !== $conn) return false;
    if (!empty($event['room']) && !room_member(find_room((string) $event['room']), $client['name'])) return false;
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

// Quem aparece para name (ele e os contatos dele): online, ativo agora, visto por último e a foto.
function presence(string $name): array
{
    $names = [$name];
    foreach (rooms_of($name) as $room) $names[] = room_peer($room, $name);
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
    ], array_values(array_filter(accounts(), fn($account) => in_array($account['name'], $names, true))));
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
    if ($current && $current['name'] !== $name) throw new HttpError(403, 'Essa conexão pertence a outra pessoa.');
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
    // A conexão saiu; só há espera para reentrar enquanto outra pessoa permanecer na sala.
    foreach (all_calls() as $call) {
        if (in_array($conn, [$call['callerConn'], $call['calleeConn']], true)) {
            call_leave($call, $client['name'], $conn, $forever ? now_ms() : (int) $client['ping']);
        }
    }
    if ($client['client'] === 'web') {
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
    $stale = query('SELECT conn, ping FROM ' . t('clients') . ' WHERE ping < ?', [$now - client_ttl_ms()])->fetchAll();
    foreach ($stale as $client) {
        drop((string) $client['conn']);
    }
    call_sweep();
    local_music_sweep();
    query('DELETE FROM ' . t('gone') . ' WHERE at < ?', [$now - EVENT_KEEP_MS]);
    query('DELETE FROM ' . t('events') . ' WHERE at < ? AND seq < ?', [$now - EVENT_KEEP_MS, last_seq()]);
    // Arquivo enviado que nunca virou mensagem (envio cancelado, aba fechada no meio).
    query('DELETE FROM ' . t('files') . ' WHERE message_id IS NULL AND created_at < ?', [$now - DAY_MS]);
}

// ---------- ações vindas do navegador ----------

// $me: conn, name, client e room (a conversa da ação, a que estava aberta quando ela foi feita; null = nenhuma).
function act(array $me, string $event, $data)
{
    $name = $me['name'];
    $body = is_array($data) ? $data : [];
    $room = $me['room']['id'] ?? '';

    switch ($event) {
        case 'message':
            return send_message($me, $body);

        case 'history:before':
            return page($room, str($body['before'] ?? ''));

        case 'history:around':
            return around($room, str($body['id'] ?? ''), str($body['from'] ?? ''));

        case 'history:after':
            return page_after($room, str($body['after'] ?? ''));

        case 'search':
            return search_messages($room, str($body['query'] ?? ''), str($body['before'] ?? ''));

        // Abre outra conversa: o histórico dela, como ao conectar.
        case 'room':
            $id = str($body['id'] ?? '');
            $target = $id !== '' ? pick_room($name, $id) : null;
            if (!$target) return ['ok' => false, 'error' => 'Essa conversa não existe.'];
            return ['ok' => true] + history($name, $target);

        case 'rooms':
            return ['ok' => true, 'rooms' => room_list($name)];

        // Adicionar pessoas: criar o link de convite ou aceitar o de alguém.
        case 'invite':
            return invite_act($me, $body);

        case 'avatar':
            return set_avatar($name, $body['image'] ?? null);

        // Números do perfil: os seus ou, com name, os da pessoa da conversa aberta.
        case 'stats':
            $who = str($body['name'] ?? '');
            return stats($me['room'] && $who === room_peer($me['room'], $name) ? $who : $name, $me['room']);

        case 'wallpaper':
            return set_wallpaper($me, $body);

        case 'music':
            return music_act($me, $body);

        case 'watch':
            return watch_act($me, $body);

        // Nosso cantinho (só do casal): o dia de cada um, agenda, sonhos e metas, cartinhas e lembretes.
        case 'us':
            if (!in_array($name, users(), true)) return ['ok' => false, 'error' => 'O Nosso cantinho é só do casal.'];
            return us_act($me, $body);

        case 'game':
            return game_act($me, $body);

        case 'sticker':
            return sticker_act($me, $body);

        // Contagem regressiva do topo (só do casal).
        case 'countdown':
            if (!in_array($name, users(), true)) return ['ok' => false, 'error' => 'A contagem é só do casal.'];
            return countdown_act($me, $body);

        // Tema escolhido: fica na conta e muda na hora nas outras abas da mesma pessoa.
        case 'theme':
            $theme = str($body['theme'] ?? '');
            if (!in_array($theme, THEMES, true)) return ['ok' => false, 'error' => 'Tema desconhecido.'];
            query('UPDATE ' . t('users') . ' SET theme = ? WHERE name = ?', [$theme, $name]);
            emit('theme', ['theme' => $theme], 'self', $me);
            return ['ok' => true];

        case 'react':
            $emoji = str($body['emoji'] ?? '');
            $row = member_message($name, str($body['id'] ?? ''));
            if (!$row || $row['deleted'] || !in_array($emoji, REACTIONS, true)) return null;
            $reactions = json_decode((string) $row['reactions'], true) ?: [];
            $list = (array) ($reactions[$emoji] ?? []);
            $list = in_array($name, $list, true) ? array_values(array_diff($list, [$name])) : array_merge($list, [$name]);
            if ($list) $reactions[$emoji] = $list;
            else unset($reactions[$emoji]);
            $row['reactions'] = encode((object) $reactions);
            query('UPDATE ' . t('messages') . ' SET reactions = ? WHERE n = ?', [$row['reactions'], $row['n']]);
            emit_message('message:update', to_message($row));
            return null;

        case 'delete':
            $row = member_message($name, str($body['id'] ?? ''));
            // Cartões de música (os comandos), jogos e chamadas não se apagam.
            if (!$row || $row['sender'] !== $name || $row['deleted'] || in_array($row['source'], ['music', 'game', 'call'], true)) return null;
            $row = array_merge($row, ['deleted' => 1, 'text' => '', 'media' => null, 'reactions' => '{}']);
            query('UPDATE ' . t('messages') . " SET deleted = 1, text = '', media = NULL, reactions = '{}' WHERE n = ?", [$row['n']]);
            // A foto ou o arquivo some junto (o endereço para de funcionar).
            query('DELETE FROM ' . t('files') . ' WHERE message_id = ?', [$row['id']]);
            emit_message('message:update', to_message($row));
            return null;

        case 'seen':
            $row = member_message($name, str($body['id'] ?? ''));
            if (!$row) return null;
            $upto = read_upto($row['room'], $name);
            if ($row['n'] <= $upto) return null;
            $at = iso();
            mark_read($name, $row, $at, $upto);
            emit('seen', ['name' => $name, 'id' => $row['id'], 'at' => $at, 'room' => $row['room']], 'all', null, null, $row['room']);
            return null;

        case 'visibility':
            query('UPDATE ' . t('clients') . " SET visible = ? WHERE conn = ? AND client = 'web'", [(int) (bool) $data, $me['conn']]);
            emit('presence');
            return null;

        // Digitando (true ou false) ou gravando um áudio ("audio"), na conversa aberta.
        case 'typing':
            if ($room === '') return null;
            emit('typing', ['name' => $name, 'active' => (bool) $data, 'audio' => $data === 'audio', 'room' => $room], 'peer', $me, null, $room);
            return null;

        // Sinalização WebRTC: só para a conexão do outro lado de uma chamada atendida (to).
        case 'webrtc-offer':
        case 'webrtc-answer':
        case 'webrtc-ice':
        case 'webrtc-restart':
        case 'call-state':
            $to = str($body['to'] ?? '');
            $paired = false;
            foreach (all_calls() as $call) {
                $ends = [$call['callerConn'], $call['calleeConn']];
                if ($to !== '' && in_array($me['conn'], $ends, true) && in_array($to, $ends, true) && $to !== $me['conn']
                    && (!isset($body['id']) || $body['id'] === $call['id'])
                    && (!isset($body['generation']) || (int) $body['generation'] === (int) ($call['generation'] ?? 0))) {
                    $paired = true;
                    if ($event === 'call-state') {
                        $role = $me['conn'] === $call['callerConn'] ? 'caller' : 'callee';
                        $call['states'][$role] = clean_call_state($body);
                        save_call($call);
                    }
                }
            }
            if (!$paired) return null;
            emit($event, array_merge($body, ['from' => $me['conn'], 'name' => $name]), 'peer', $me, $to);
            if ($event === 'webrtc-answer') emit('call-handled', null, 'self', $me);
            return null;

        // Chamada: começar (toca para a outra pessoa, mesmo offline), atender, recusar e ver como está.
        case 'call':
            return call_act($me, $body);

        // Sair (inclusive recarregar/fechar a página): só desprende esta conexão e preserva a sala.
        case 'call-ended':
        case 'call-leave':
            $id = str($body['id'] ?? '');
            foreach (all_calls() as $call) {
                $mine = $id !== '' ? $call['id'] === $id : in_array($me['conn'], [$call['callerConn'], $call['calleeConn']], true);
                if ($mine && in_array($name, [$call['caller'], $call['callee']], true)) call_leave($call, $name, $me['conn'], null, isset($body['lease']) ? (int) $body['lease'] : null);
            }
            return null;
    }
    return null;
}

// ---------- chamadas ----------
// Estilo Discord: ligar não depende de a outra pessoa estar online. Cada conversa tem no máximo uma chamada aberta, em
// settings (name = 'call:<conversa>'): quem ligou e de qual conexão, para quem, o tipo, quando começou e quem atendeu
// (a conexão) e quando. Ela toca CALL_RING_MS nos aparelhos da outra pessoa (o site aberto e o serviço do app do
// Android). Com uma pessoa, fica disponível por CALL_WAIT_MS; entradas renovam a espera e o par completo a cancela.
// Sem participantes, encerra imediatamente.
// Atendeu, quem ligou manda a oferta WebRTC direto para a conexão que atendeu. Cada um fica numa chamada por vez. Cada
// chamada também vira uma mensagem na conversa (source 'call', media {call: {...}}): tocando, acontecendo, quanto durou,
// recusada ou perdida.

function all_calls(): array
{
    $calls = [];
    foreach (query('SELECT value FROM ' . t('settings') . " WHERE name LIKE 'call:%'")->fetchAll(PDO::FETCH_COLUMN) as $raw) {
        $call = json_decode((string) $raw, true);
        if (is_array($call) && isset($call['id'], $call['room'])) {
            // Compatibilidade com as salas abertas antes da atualização.
            $calls[] = $call + [
                'generation' => 0,
                'waitingUntil' => $call['callerConn'] && $call['calleeConn'] ? null : $call['startedAt'] + CALL_WAIT_MS,
                'joined' => $call['answeredAt'] !== null ? [$call['caller'], $call['callee']] : [$call['caller']],
                'states' => ['caller' => $call['state'], 'callee' => clean_call_state(null)],
                'leases' => ['caller' => 0, 'callee' => 0],
            ];
        }
    }
    return $calls;
}

function find_call(string $id): ?array
{
    foreach (all_calls() as $call) if ($id !== '' && $call['id'] === $id) return $call;
    return null;
}

function save_call(array $call): void
{
    query('INSERT INTO ' . t('settings') . ' (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)', ['call:' . $call['room'], encode($call)]);
}

function call_sweep(): void
{
    foreach (all_calls() as $call) {
        if (!$call['callerConn'] && !$call['calleeConn']) call_finish($call, 'empty');
        elseif ($call['waitingUntil'] !== null && $call['waitingUntil'] <= now_ms()) call_finish($call, 'timeout', null, (int) $call['waitingUntil']);
    }
}

function call_changed(array $call): void
{
    update_call_log($call);
    emit('call-update', call_public($call), 'all', null, null, $call['room']);
}

function call_leave(array $call, string $name, string $conn, ?int $at = null, ?int $lease = null): void
{
    $role = $call['caller'] === $name ? 'caller' : ($call['callee'] === $name ? 'callee' : '');
    if ($role === '' || $call[$role . 'Conn'] !== $conn) return;
    if ($lease !== null && $lease !== (int) ($call['leases'][$role] ?? 0)) return;
    $call[$role . 'Conn'] = null;
    $call['generation'] = (int) ($call['generation'] ?? 0) + 1;
    if (!$call['callerConn'] && !$call['calleeConn']) {
        // O horário de presença pode anteceder a última resposta por alguns milissegundos.
        $endedAt = max($at ?? now_ms(), (int) ($call['answeredAt'] ?? $call['startedAt']));
        call_finish($call, 'empty', $name, $endedAt);
        return;
    }
    // Sair de uma sala já em espera não estende o prazo; uma entrada real pode renová-lo.
    $deadline = ($at ?? now_ms()) + CALL_WAIT_MS;
    $call['waitingUntil'] = $call['waitingUntil'] === null ? $deadline : min($call['waitingUntil'], $deadline);
    save_call($call);
    call_changed($call);
    if ($role === 'caller' && $call['answeredAt'] === null) emit('call-handled', ['id' => $call['id']], 'all', null, null, $call['room']);
}

// O que os aparelhos sabem de uma chamada: from = a conexão de quem ligou; ringUntil no relógio do servidor; state = o
// que quem ligou tem ligado (microfone, câmera, tela).
function call_public(?array $call): ?array
{
    if (!$call) return null;
    $participants = [];
    foreach (['caller', 'callee'] as $role) {
        if ($call[$role . 'Conn']) $participants[] = ['name' => $call[$role], 'conn' => $call[$role . 'Conn'], 'state' => $call['states'][$role] ?? clean_call_state(null), 'lease' => (int) ($call['leases'][$role] ?? 0)];
    }
    return [
        'id' => $call['id'], 'room' => $call['room'], 'caller' => $call['caller'], 'callee' => $call['callee'], 'media' => $call['media'],
        'from' => $call['callerConn'], 'state' => $call['states']['caller'] ?? $call['state'], 'startedAt' => $call['startedAt'],
        'ringUntil' => $call['callerConn'] && $call['answeredAt'] === null ? $call['startedAt'] + CALL_RING_MS : 0,
        'answered' => $call['answeredAt'] !== null,
        'answeredAt' => $call['answeredAt'], 'participants' => $participants, 'joined' => $call['joined'] ?? [$call['caller']],
        'waitingUntil' => $call['waitingUntil'] ?? null, 'generation' => (int) ($call['generation'] ?? 0),
    ];
}

function clean_call_state($state): array
{
    $state = is_array($state) ? $state : [];
    return ['mic' => ($state['mic'] ?? true) !== false, 'cam' => ($state['cam'] ?? false) === true, 'screen' => ($state['screen'] ?? false) === true];
}

// A mensagem da chamada na conversa. status: ringing, live ou ended; result (no fim): answered, declined ou missed.
function call_log(array $call, array $changes = []): array
{
    return array_merge([
        'id' => $call['id'], 'media' => $call['media'], 'caller' => $call['caller'], 'callee' => $call['callee'],
        'status' => $call['callerConn'] && $call['calleeConn'] ? 'live' : ($call['answeredAt'] === null && $call['callerConn'] && count($call['joined'] ?? []) === 1 ? 'ringing' : 'waiting'), 'result' => null,
        'startedAt' => $call['startedAt'], 'answeredAt' => $call['answeredAt'], 'endedAt' => null,
        'waitingUntil' => $call['waitingUntil'] ?? null,
    ], $changes);
}

function update_call_log(array $call, array $changes = []): void
{
    $row = find_message((string) $call['message']);
    if (!$row || $row['deleted']) return;
    $row['media'] = encode(['call' => call_log($call, $changes)]);
    query('UPDATE ' . t('messages') . ' SET media = ? WHERE n = ?', [$row['media'], $row['n']]);
    emit_message('message:update', to_message($row));
}

// "Chamada perdida", "Chamada recusada" ou o tipo (citação de uma resposta).
function call_label(array $call): string
{
    $result = $call['result'] ?? null;
    if ($result === 'missed') return 'Chamada perdida';
    if ($result === 'declined') return 'Chamada recusada';
    return CALL_NAMES[$call['media'] ?? ''] ?? 'Chamada';
}

// Fim definitivo: sala vazia, timeout (cinco minutos com uma pessoa esperando) ou recusa explícita.
// O histórico usa a hora da saída da última pessoa ou a hora real do vencimento.
function call_finish(array $call, string $reason, ?string $by = null, ?int $endedAt = null): void
{
    query('DELETE FROM ' . t('settings') . ' WHERE name = ?', ['call:' . $call['room']]);
    $result = $call['answeredAt'] !== null ? 'answered' : ($reason === 'declined' ? 'declined' : 'missed');
    update_call_log($call, ['status' => 'ended', 'result' => $result, 'endedAt' => $endedAt ?? now_ms(), 'waitingUntil' => null]);
    emit('call-ended', ['id' => $call['id'], 'room' => $call['room'], 'name' => $by, 'reason' => $reason, 'result' => $result, 'caller' => $call['caller'], 'media' => $call['media']], 'all', null, null, $call['room']);
}

function call_act(array $me, array $body): array
{
    call_sweep();
    $op = str($body['op'] ?? '');
    $name = $me['name'];
    if ($op === 'get') {
        $call = find_call(str($body['id'] ?? ''));
        return ['ok' => true, 'call' => $call && in_array($name, [$call['caller'], $call['callee']], true) ? call_public($call) : null];
    }

    if ($op === 'start') {
        if (!$me['room']) return ['ok' => false, 'error' => 'Escolha uma conversa para ligar.'];
        $room = $me['room'];
        $peer = room_peer($room, $name);
        foreach (all_calls() as $open) {
            $people = [];
            if ($open['callerConn']) $people[] = $open['caller'];
            if ($open['calleeConn']) $people[] = $open['callee'];
            elseif ($open['answeredAt'] === null && $open['callerConn']) $people[] = $open['callee'];
            if ($open['room'] === $room['id']) {
                if ($open['answeredAt'] !== null) return ['ok' => false, 'error' => 'Já tem uma chamada acontecendo.'];
                return ['ok' => false, 'error' => $open['caller'] === $peer ? "$peer já está te ligando." : 'Você já está ligando de outro aparelho.'];
            }
            if (in_array($name, $people, true)) return ['ok' => false, 'error' => 'Você já está em outra chamada.'];
            if (in_array($peer, $people, true)) return ['ok' => false, 'error' => "$peer está em outra chamada agora."];
        }
        $media = in_array($body['media'] ?? '', array_keys(CALL_NAMES), true) ? $body['media'] : 'audio';
        $startedAt = now_ms();
        $call = [
            'id' => uuid(), 'room' => $room['id'], 'caller' => $name, 'callerConn' => $me['conn'], 'callee' => $peer, 'media' => $media,
            'state' => clean_call_state($body['state'] ?? null), 'startedAt' => $startedAt, 'answeredAt' => null, 'calleeConn' => null, 'message' => null,
            'waitingUntil' => $startedAt + CALL_WAIT_MS, 'generation' => 0, 'joined' => [$name],
            'states' => ['caller' => clean_call_state($body['state'] ?? null), 'callee' => clean_call_state(null)],
            'leases' => ['caller' => 0, 'callee' => 0],
        ];
        $row = [
            'id' => uuid(), 'client_id' => null, 'sender' => $name, 'text' => '', 'created_at' => iso(), 'reply_to' => null,
            'reactions' => '{}', 'deleted' => 0, 'source' => 'call', 'media' => encode(['call' => call_log($call)]), 'room' => $room['id'],
        ];
        insert_message($row);
        set_read($room['id'], $name, $row['id'], $row['created_at']);
        $call['message'] = $row['id'];
        save_call($call);
        emit_message('message', to_message($row));
        emit('call-ring', call_public($call), 'peer', $me, null, $room['id']);
        emit('call-update', call_public($call), 'all', null, null, $room['id']);
        return ['ok' => true, 'call' => call_public($call), 'online' => web_online($peer)];
    }

    $call = find_call(str($body['id'] ?? ''));
    if (!$call) return ['ok' => false, 'error' => 'Essa chamada já terminou.'];
    if (!in_array($name, [$call['caller'], $call['callee']], true)) return ['ok' => false, 'error' => 'Essa chamada não é para você.'];

    switch ($op) {
        // Só a primeira conexão que atende entra; as outras (o site em outro aparelho, o app) param de tocar.
        case 'accept':
        case 'join':
        case 'resume':
            if ($op === 'accept' && $call['callee'] !== $name) return ['ok' => false, 'error' => 'Essa chamada não é para você.'];
            $role = $call['caller'] === $name ? 'caller' : 'callee';
            $previous = $call[$role . 'Conn'];
            if ($previous === $me['conn'] && empty($body['renegotiate'])) return ['ok' => true, 'call' => call_public($call)];
            if ($previous && $previous !== $me['conn'] && find_client($previous) && $op !== 'resume') return ['ok' => false, 'error' => $op === 'accept' ? 'Você já atendeu em outro aparelho.' : 'Você já está nessa chamada em outro aparelho.'];
            foreach (all_calls() as $other) {
                if ($other['id'] !== $call['id'] && (($other['caller'] === $name && $other['callerConn']) || ($other['callee'] === $name && $other['calleeConn']))) return ['ok' => false, 'error' => 'Você já está em outra chamada.'];
            }
            $call[$role . 'Conn'] = $me['conn'];
            $call['states'][$role] = clean_call_state($body['state'] ?? null);
            $call['joined'] = array_values(array_unique(array_merge($call['joined'], [$name])));
            $call['generation']++;
            $call['leases'][$role] = $call['generation'];
            $paired = $call['callerConn'] && $call['calleeConn'];
            if ($paired && $call['answeredAt'] === null) $call['answeredAt'] = now_ms();
            $call['waitingUntil'] = $paired ? null : now_ms() + CALL_WAIT_MS;
            save_call($call);
            if ($previous && $previous !== $me['conn']) emit('call-replaced', ['id' => $call['id']], 'self', $me, $previous, $call['room']);
            call_changed($call);
            if ($paired) emit('call-accepted', ['id' => $call['id'], 'room' => $call['room'], 'from' => $call['calleeConn'], 'name' => $call['callee'], 'state' => $call['states']['callee'], 'generation' => $call['generation']], 'all', null, $call['callerConn'], $call['room']);
            emit('call-handled', ['id' => $call['id']], 'self', $me);
            return ['ok' => true, 'call' => call_public($call)];

        case 'decline':
            if ($call['callee'] !== $name) return ['ok' => false, 'error' => 'Essa chamada não é para você.'];
            if ($call['answeredAt'] === null && !$call['calleeConn']) call_finish($call, 'declined', $name);
            return ['ok' => true];
        case 'leave':
            call_leave($call, $name, $me['conn'], null, isset($body['lease']) ? (int) $body['lease'] : null);
            return ['ok' => true, 'call' => call_public(find_call($call['id']))];
    }
    return ['ok' => false, 'error' => 'Ação desconhecida.'];
}

// Números da tela de perfil: mensagens enviadas, reações dadas e desde quando vocês conversam (a conversa aberta).
function stats(string $name, ?array $room): array
{
    $messages = (int) query('SELECT COUNT(*) FROM ' . t('messages') . " WHERE sender = ? AND deleted = 0 AND source NOT IN ('music', 'game', 'call')", [$name])->fetchColumn();
    $since = $room ? query('SELECT created_at FROM ' . t('messages') . ' WHERE room = ? ORDER BY n LIMIT 1', [$room['id']])->fetchColumn() : null;
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

// ---------- contagem regressiva (topo do site) ----------
// Até o próximo encontro: o dia (e a hora, se quiser) e o texto, iguais para os dois (settings, nome "countdown").
// shortcut: sem nada gravado, vale a viagem de 12/12/2026 que o casal pediu; depois de mudar no site, vale o que foi gravado.
const COUNTDOWN_DEFAULT = ['day' => '2026-12-12', 'time' => null, 'label' => 'Até a gente se ver', 'by' => null];

function countdown_state(): ?array
{
    $raw = query('SELECT value FROM ' . t('settings') . " WHERE name = 'countdown'")->fetchColumn();
    if ($raw === false) return COUNTDOWN_DEFAULT;
    $state = json_decode((string) $raw, true);
    return is_array($state) && !empty($state['day']) ? $state : null;
}

// Marcar (day, time opcional, label) ou desligar (off).
function countdown_act(array $me, array $body): array
{
    if (($body['off'] ?? false) === true) {
        $state = null;
    } else {
        $day = clean_day($body['day'] ?? '');
        if (!$day) return ['ok' => false, 'error' => 'Escolha o dia.'];
        $time = ($body['time'] ?? null) === null || $body['time'] === '' ? null : clean_clock($body['time']);
        if (($body['time'] ?? null) && !$time) return ['ok' => false, 'error' => 'Hora inválida.'];
        $state = ['day' => $day, 'time' => $time, 'label' => clean_line($body['label'] ?? '', 60) ?: COUNTDOWN_DEFAULT['label'], 'by' => $me['name']];
    }
    query('INSERT INTO ' . t('settings') . " (name, value) VALUES ('countdown', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [encode($state ?? ['off' => true])]);
    emit('countdown', ['countdown' => $state], 'all', null, null, couple_room()['id'] ?? null);
    return ['ok' => true, 'countdown' => $state];
}

// ---------- figurinhas ----------
// Cada pessoa tem a sua coleção (items, kind sticker): GIFs do GIPHY (só o endereço) e imagens (foto ou GIF do
// aparelho, ou copiada de uma mensagem), guardadas em files presas à figurinha (message_id = id da figurinha). Na
// conversa, a figurinha é um GIF com sticker = true (aparece sem balão).
const STICKERS_MAX = 300;
const STICKER_FILE_MAX = 3000000;
const STICKER_FILE_URL = '#^api\.php\?action=file&k=([0-9a-f]{32})$#';

function sticker_list(string $owner): array
{
    return array_map('item_public', query('SELECT * FROM ' . t('items') . " WHERE kind = 'sticker' AND owner = ? ORDER BY n DESC", [$owner])->fetchAll());
}

// Figurinha que vai numa mensagem: GIF do GIPHY ou imagem de uma figurinha da coleção de quem manda.
function sticker_media($gif, string $owner)
{
    $url = str($gif['url'] ?? '');
    if (!preg_match(STICKER_FILE_URL, $url, $match)) {
        $clean = clean_gif($gif);
        return $clean ? ['title' => '', 'sticker' => true] + $clean : false;
    }
    $file = query('SELECT f.width, f.height FROM ' . t('files') . ' f JOIN ' . t('items') . " i ON i.id = f.message_id AND i.kind = 'sticker' WHERE f.file_key = ? AND f.kind = 'image' AND i.owner = ?", [$match[1], $owner])->fetch();
    return $file ? ['url' => $url, 'width' => (int) $file['width'], 'height' => (int) $file['height'], 'title' => '', 'sticker' => true] : false;
}

// Copia uma imagem de files para uma figurinha nova (a da mensagem some quando a mensagem é apagada).
function copy_sticker_file(string $key, string $owner, string $itemId): ?array
{
    $file = query('SELECT width, height, size FROM ' . t('files') . " WHERE file_key = ? AND kind = 'image'", [$key])->fetch();
    if (!$file || (int) $file['size'] > STICKER_FILE_MAX) return null;
    $copy = bin2hex(random_bytes(16));
    query('INSERT INTO ' . t('files') . ' (file_key, owner, name, type, kind, size, width, height, data, message_id, created_at) SELECT ?, ?, name, type, kind, size, width, height, data, ?, ? FROM ' . t('files') . ' WHERE file_key = ?',
        [$copy, $owner, $itemId, now_ms(), $key]);
    return ['url' => file_url($copy), 'width' => (int) $file['width'], 'height' => (int) $file['height']];
}

// add: de um GIF do GIPHY (gif), de uma imagem que acabou de subir (file) ou de uma mensagem com GIF, foto ou
// figurinha (message). delete: tira da coleção.
function sticker_act(array $me, array $body): array
{
    $name = $me['name'];
    $op = str($body['op'] ?? '');
    if ($op === 'delete') {
        $row = find_item('sticker', str($body['id'] ?? ''));
        if (!$row || $row['owner'] !== $name) return ['ok' => false, 'error' => 'Essa figurinha não está mais aqui.'];
        // shortcut: só o registro sai; a imagem fica em files para as figurinhas já enviadas continuarem aparecendo.
        query('DELETE FROM ' . t('items') . ' WHERE n = ?', [$row['n']]);
    } elseif ($op === 'add') {
        if (count(sticker_list($name)) >= STICKERS_MAX) return ['ok' => false, 'error' => 'A coleção está cheia (' . STICKERS_MAX . ' figurinhas). Tire alguma antes.'];
        $itemId = uuid();
        $sticker = null;
        $gif = $body['gif'] ?? null;
        if (isset($body['message'])) {
            $row = member_message($name, str($body['message']));
            $media = $row && !$row['deleted'] && $row['media'] ? json_decode((string) $row['media'], true) : null;
            // Foto/GIF enviado ou figurinha de imagem: copia o arquivo. GIF do GIPHY: só o endereço.
            $key = $media['file']['key'] ?? (preg_match(STICKER_FILE_URL, (string) ($media['url'] ?? ''), $match) ? $match[1] : null);
            $gif = $key === null && isset($media['url']) ? $media : null;
            if ($key !== null) $sticker = copy_sticker_file((string) $key, $name, $itemId);
            if (!$sticker && !$gif) return ['ok' => false, 'error' => 'Só dá para salvar fotos e GIFs (até 3 MB) como figurinha.'];
        }
        if (!$sticker && isset($body['file'])) {
            $key = str($body['file']);
            $file = query('SELECT width, height, size FROM ' . t('files') . " WHERE file_key = ? AND owner = ? AND kind = 'image' AND message_id IS NULL", [$key, $name])->fetch();
            if (!$file) return ['ok' => false, 'error' => 'Essa imagem não serve para figurinha.'];
            if ((int) $file['size'] > STICKER_FILE_MAX) return ['ok' => false, 'error' => 'Figurinha muito grande (até 3 MB).'];
            query('UPDATE ' . t('files') . ' SET message_id = ? WHERE file_key = ?', [$itemId, $key]);
            $sticker = ['url' => file_url($key), 'width' => (int) $file['width'], 'height' => (int) $file['height']];
        }
        if (!$sticker && $gif !== null) {
            $clean = clean_gif($gif);
            if (!$clean) return ['ok' => false, 'error' => 'GIF inválido.'];
            foreach (sticker_list($name) as $old) if ($old['url'] === $clean['url']) return ['ok' => true, 'stickers' => sticker_list($name), 'already' => true];
            $sticker = ['url' => $clean['url'], 'width' => $clean['width'], 'height' => $clean['height']];
        }
        if (!$sticker) return ['ok' => false, 'error' => 'Escolha um GIF ou uma imagem.'];
        save_item(null, $itemId, 'sticker', $name, null, $sticker);
    } else {
        return ['ok' => false, 'error' => 'Ação desconhecida.'];
    }
    $list = sticker_list($name);
    emit('stickers', ['stickers' => $list], 'self', $me);
    return ['ok' => true, 'stickers' => $list];
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
    if (isset($media['call'])) return call_label($media['call']);
    return $media ? (!empty($media['sticker']) ? 'Figurinha' : 'GIF') : '';
}

function send_message(array $me, array $body): array
{
    if (!$me['room']) return ['ok' => false, 'error' => 'Escolha uma conversa.'];
    $room = $me['room']['id'];
    // Foto ou arquivo já enviado em api.php?action=upload (chave). Áudio gravado no chat vem com voice.
    $fileKey = str($body['file'] ?? '');
    $gif = $fileKey === '' ? (!empty($body['gif']['sticker']) ? sticker_media($body['gif'], $me['name']) : clean_gif($body['gif'] ?? null)) : null;
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

    $original = room_message($room, str($body['replyTo'] ?? ''));
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
        'room' => $room,
    ];
    $n = insert_message($row);
    if ($file) query('UPDATE ' . t('files') . ' SET message_id = ? WHERE file_key = ?', [$row['id'], $file['key']]);
    // Quem responde leu o que veio antes: as mensagens da outra pessoa ficam lidas (e ela vê na hora).
    $read = mark_read($me['name'], ['n' => $n] + $row, $row['created_at'], read_upto($room, $me['name']));
    $message = to_message($row);
    emit_message('message', $message);
    if ($read) emit('seen', ['name' => $me['name'], 'id' => $row['id'], 'at' => $row['created_at'], 'room' => $room], 'all', null, null, $room);
    return ['ok' => true, 'message' => $message];
}
