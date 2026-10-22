-- Potato Chat: tabelas do banco MySQL (prefixo potato_).
-- Opcional: o site cria tudo sozinho no primeiro acesso. Use este arquivo só se preferir importar pelo phpMyAdmin.
-- Se mudar o prefixo em config.php, troque "potato_" aqui também.
-- Já importou a versão anterior deste arquivo? Não precisa fazer nada: no primeiro acesso o site
-- acrescenta sozinho as colunas novas (senha, foto, tema e papel de parede em potato_users, GIF em potato_messages)
-- e as tabelas potato_files (fotos e arquivos das mensagens) e potato_items (Nosso cantinho).

CREATE TABLE IF NOT EXISTS `potato_settings` (
  name VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  value TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- As duas contas: nome, senha (só o hash), foto de perfil, tema e papel de parede.
CREATE TABLE IF NOT EXISTS `potato_users` (
  position INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  created_at VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  pass_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  avatar MEDIUMTEXT CHARACTER SET ascii COLLATE ascii_bin NULL,
  avatar_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  avatar_key CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  theme VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  wallpaper MEDIUMTEXT CHARACTER SET ascii COLLATE ascii_bin NULL,
  wallpaper_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  wallpaper_key CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  wallpaper_style VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  KEY user_avatar (avatar_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `potato_messages` (
  n BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  client_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  sender VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  text TEXT NOT NULL,
  created_at VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reply_to TEXT NULL,
  reactions TEXT NOT NULL,
  deleted TINYINT(1) NOT NULL DEFAULT 0,
  source VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'web',
  media TEXT NULL,
  UNIQUE KEY message_id (id),
  KEY message_client (sender, client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `potato_status` (
  name VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
  read_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  read_at VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  last_seen VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `potato_clients` (
  conn VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  name VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  client VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  visible TINYINT(1) NOT NULL DEFAULT 0,
  ping BIGINT NOT NULL,
  hits TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `potato_events` (
  seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  at BIGINT NOT NULL,
  type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  data MEDIUMTEXT NULL,
  scope VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  from_conn VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  from_name VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  to_conn VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  KEY event_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `potato_gone` (
  conn VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `potato_logins` (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ip VARCHAR(45) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  at BIGINT NOT NULL,
  KEY login_ip (ip, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fotos e arquivos das mensagens (até 10 MB cada). message_id fica vazio entre o envio do arquivo e o da mensagem
-- (nas fotos do Nosso cantinho, é o id do registro em potato_items).
CREATE TABLE IF NOT EXISTS `potato_files` (
  file_key CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  owner VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  name VARCHAR(200) NOT NULL,
  type VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  kind VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  size INT UNSIGNED NOT NULL,
  width INT UNSIGNED NULL,
  height INT UNSIGNED NULL,
  data MEDIUMBLOB NOT NULL,
  message_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at BIGINT NOT NULL,
  KEY file_message (message_id, created_at),
  KEY file_owner (owner, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Nosso cantinho: o dia de cada um (day), compromissos da agenda (event), sonhos e metas (goal), cartinhas (letter) e
-- as preferências de cada pessoa (prefs: hábitos e lembretes). Os detalhes ficam em JSON na coluna data.
CREATE TABLE IF NOT EXISTS `potato_items` (
  n BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  day VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NULL,
  data MEDIUMTEXT NOT NULL,
  created_at VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_at VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  UNIQUE KEY item_id (id),
  KEY item_kind (kind, owner, day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
