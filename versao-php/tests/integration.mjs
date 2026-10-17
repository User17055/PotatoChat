import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

// Teste de integração da versão PHP + MySQL: sobe o servidor embutido do PHP (php -S) e conversa
// com ele usando o mesmo realtime.js do site, como o navegador faria.
// Banco de teste (variáveis opcionais): POTATO_TEST_DB_HOST, _PORT, _NAME, _USER, _PASS.
// As tabelas usam um prefixo próprio a cada execução e são apagadas no fim.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = path.join(root, "site");
const port = 8197;
const longPort = 8198;
const baseUrl = `http://localhost:${port}`;
const longUrl = `http://localhost:${longPort}`;
const secret = "segredo-de-integracao-com-mais-de-32-caracteres";
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "potato-php-"));
const configFile = path.join(temp, "config.php");
const env = (name, fallback) => process.env[`POTATO_TEST_DB_${name}`] || fallback;
const prefix = `teste${Date.now().toString(36)}_`;
const db = { host: env("HOST", "127.0.0.1"), port: Number(env("PORT", 3399)), name: env("NAME", "potato_teste"), user: env("USER", "potato"), pass: env("PASS", "senha-teste"), prefix };

const giphyKey = "chave-de-teste-do-giphy";
await fs.writeFile(configFile, `<?php return ${phpValue({ token_secret: secret, db, poll_wait: 3, giphy_key: giphyKey, music_lookup: false })};`);

function phpValue(value) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(phpValue).join(", ")}]`;
  return `[${Object.entries(value).map(([key, item]) => `'${key}' => ${phpValue(item)}`).join(", ")}]`;
}

// O PHP local pode ter o pdo_mysql desligado no php.ini: liga só para o teste.
const phpArgs = execFileSync("php", ["-r", "echo extension_loaded('pdo_mysql') ? 1 : 0;"]).toString() === "1" ? [] : ["-d", "extension=pdo_mysql"];

// Consulta direta ao banco (para conferir o que foi gravado).
function sql(statement) {
  const code = `require ${phpValue(path.join(site, "lib", "potato.php").replaceAll("\\", "/"))}; $s = query(str_replace('{p}', ${phpValue(prefix)}, ${phpValue(statement)})); echo json_encode($s->columnCount() ? $s->fetchAll() : [], JSON_UNESCAPED_UNICODE);`;
  return JSON.parse(execFileSync("php", [...phpArgs, "-r", code], { env: { ...process.env, POTATO_CONFIG: configFile } }).toString() || "[]");
}

// Consulta sem passar pelo site (que atualizaria as tabelas antes): para montar um banco da versão 1.
function rawSql(statement) {
  const code = `$c = (require getenv('POTATO_CONFIG'))['db']; $pdo = new PDO("mysql:host={$c['host']};port={$c['port']};dbname={$c['name']};charset=utf8mb4", $c['user'], $c['pass']); $pdo->exec(str_replace('{p}', ${phpValue(prefix)}, ${phpValue(statement)}));`;
  execFileSync("php", [...phpArgs, "-r", code], { env: { ...process.env, POTATO_CONFIG: configFile } });
}

// PNG de verdade (cores lisas), para testar a foto de perfil.
function makePng(width, height) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), data])));
    return Buffer.concat([length, Buffer.from(type), data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0xc8)]);
  const pixels = zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", pixels), chunk("IEND", Buffer.alloc(0))]);
}

// GIF de verdade: tela de 16×16 com um quadro de 1 pixel (o GIF mínimo clássico). padding = bytes extras no fim.
function makeGif(padding = 0) {
  const gif = Buffer.from("474946383961" + "10001000" + "800000" + "000000ffffff" + "2c000000000100010000" + "0202440100" + "3b", "hex");
  return Buffer.concat([gif, Buffer.alloc(padding)]);
}

function startServer(listen, env = {}) {
  const server = spawn("php", [...phpArgs, "-S", `localhost:${listen}`, "-t", site], {
    env: { ...process.env, POTATO_CONFIG: configFile, ...env },
    stdio: ["ignore", "ignore", "pipe"]
  });
  server.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    if (/PHP (Warning|Notice|Fatal|Deprecated)/i.test(text)) console.error(text);
  });
  return server;
}

async function waitForServer(url) {
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(`${url}/api.php?action=health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Servidor ${url} não iniciou a tempo.`);
}

// O suficiente de "navegador" para o realtime.js rodar no Node.
globalThis.document = { baseURI: `${baseUrl}/`, hidden: false };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
Object.defineProperty(globalThis.navigator, "sendBeacon", {
  value: (url, blob) => { blob.text().then((body) => fetch(url, { method: "POST", body })).catch(() => {}); return true; }
});
const { io } = await import("../site/realtime.js");

async function api(action, body, url = baseUrl) {
  const response = await fetch(`${url}/api.php?action=${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

// Foto ou arquivo: corpo cru, sessão e nome nos cabeçalhos (como o app.js faz).
async function upload(token, name, data, type = "application/octet-stream") {
  const response = await fetch(`${baseUrl}/api.php?action=upload`, { method: "POST", headers: { "Content-Type": type, "X-Potato-Token": token, "X-Potato-Name": encodeURIComponent(name) }, body: data });
  return { status: response.status, body: await response.json() };
}

const login = (name, password, confirm) => api("login", confirm === undefined ? { name, password } : { name, password, confirm });
const welcome = async () => (await fetch(`${baseUrl}/api.php?action=welcome`)).json();

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = io({ auth: { token, client: "web" } });
    socket.once = (event, handler) => {
      const wrapper = (...args) => { socket.off(event, wrapper); handler(...args); };
      return socket.on(event, wrapper);
    };
    socket.once("history", (history) => { socket.history = history; resolve(socket); });
    socket.once("connect_error", reject);
  });
}

const next = (socket, event, ms = 8000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Evento não chegou: ${event}`)), ms);
  socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
});
const silent = (socket, event, ms = 3500) => new Promise((resolve, reject) => {
  const fail = () => reject(new Error(`Evento inesperado: ${event}`));
  socket.on(event, fail);
  setTimeout(() => { socket.off(event, fail); resolve(); }, ms);
});
// Espera até o evento chegar com o conteúdo esperado (a presença chega várias vezes).
const until = (socket, event, accept, ms = 8000) => new Promise((resolve, reject) => {
  const check = (payload) => {
    if (!accept(payload)) return;
    clearTimeout(timer);
    socket.off(event, check);
    resolve(payload);
  };
  const timer = setTimeout(() => { socket.off(event, check); reject(new Error(`Evento não chegou: ${event}`)); }, ms);
  socket.on(event, check);
});
const withAck = (socket, event, data) => new Promise((resolve, reject) => {
  socket.timeout(10000).emit(event, data, (error, result) => (error ? reject(error) : resolve(result)));
});

// Banco da versão 1 (sem senhas, fotos nem GIFs), com uma conta antiga: o site precisa atualizar sozinho.
rawSql(`CREATE TABLE {p}settings (name VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY, value TEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE {p}users (position INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL, created_at VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE {p}messages (n BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, client_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL, sender VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL, text TEXT NOT NULL, created_at VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, reply_to TEXT NULL, reactions TEXT NOT NULL, deleted TINYINT(1) NOT NULL DEFAULT 0, source VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'web', UNIQUE KEY message_id (id), KEY message_client (sender, client_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO {p}settings (name, value) VALUES ('schema', '1');
INSERT INTO {p}users (name, created_at) VALUES ('Pessoa 1', '2026-01-01T00:00:00.000Z');`);

const servers = [startServer(port), startServer(longPort, { POTATO_LONG_POLL: "1" })];

try {
  await Promise.all([waitForServer(baseUrl), waitForServer(longUrl)]);

  const home = await fetch(baseUrl);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /Potato Chat/);
  assert.match(html, /frame-ancestors|importmap/);
  assert.match(home.headers.get("content-security-policy"), /frame-ancestors 'self' chrome-extension:/);
  for (const file of ["vendor/gsap.min.js", "realtime.js", "app.js", "styles.css", "img/login-bg.png"]) {
    assert.equal((await fetch(`${baseUrl}/${file}`)).status, 200, file);
  }

  // As tabelas da versão 1 ganharam as colunas novas, e a conta antiga continua lá (ainda sem senha).
  const columns = sql("SHOW COLUMNS FROM {p}users").map((row) => row.Field);
  for (const column of ["pass_hash", "avatar", "avatar_type", "avatar_key", "theme", "wallpaper", "wallpaper_type", "wallpaper_key", "wallpaper_style"]) assert.ok(columns.includes(column), column);
  assert.ok(sql("SHOW COLUMNS FROM {p}messages").some((row) => row.Field === "media"), "media");
  assert.equal(sql("SELECT value FROM {p}settings WHERE name = 'schema'")[0].value, "6");
  assert.ok(sql("SHOW COLUMNS FROM {p}files").some((row) => row.Field === "data"), "tabela de arquivos");
  assert.deepEqual(await welcome(), { open: 2 });

  // Primeiro acesso: o servidor pede a senha de novo antes de guardar, e não aceita senha curta.
  assert.deepEqual((await login("pessoa 1", "senha-1")).body, { confirm: true, name: "Pessoa 1" });
  assert.equal((await login("Pessoa 1", "senha-1", "senha-um")).body.error, "As senhas não são iguais. Digite de novo.");
  assert.equal((await login("Pessoa 1", "abc", "abc")).status, 400);
  const firstLogin = await login("Pessoa 1", "senha-1", "senha-1");
  assert.equal(firstLogin.status, 200);
  assert.equal(firstLogin.body.created, true);
  assert.deepEqual(await welcome(), { open: 1 });
  const secondLogin = await login("Pessoa 2", "senha-2", "senha-2");
  assert.equal(secondLogin.status, 200);
  assert.deepEqual(await welcome(), { open: 0 });

  // Depois disso, nome e senha valem para sempre: senha errada não entra, e a terceira pessoa nem cria conta.
  assert.equal((await login("Pessoa 1", "senha-2")).status, 401);
  const thirdLogin = await login("Intrusa", "qualquer", "qualquer");
  assert.equal(thirdLogin.status, 403);
  assert.equal(thirdLogin.body.error, "Nosso chat é só de Pessoa 1 e Pessoa 2.");
  // A mesma pessoa entra com outra caixa de letra e sem acento.
  assert.equal((await login("pessoa 1", "senha-1")).body.name, "Pessoa 1");
  assert.equal((await login("PESSÔA 2", "senha-2")).body.name, "Pessoa 2");
  const accounts = sql("SELECT name, pass_hash FROM {p}users ORDER BY position");
  assert.deepEqual(accounts.map((row) => row.name), ["Pessoa 1", "Pessoa 2"]);
  assert.ok(accounts.every((row) => row.pass_hash.startsWith("$2y$")), "a senha fica só como hash");

  const first = await connect(firstLogin.body.token);
  const second = await connect(secondLogin.body.token);
  assert.deepEqual(first.history.items, []);
  assert.equal(first.history.hasMore, false);
  assert.equal(first.history.me, "Pessoa 1");

  // Extensão: conexão própria, que não conta como "online".
  const extension = { token: firstLogin.body.token, conn: "extensao-teste-1", client: "extension" };
  const extensionStart = await api("connect", extension);
  assert.equal(extensionStart.status, 200);
  const presence = extensionStart.body.presence.find((person) => person.name === "Pessoa 1");
  assert.equal(presence.online, true);

  // Envio com confirmação + entrega "em tempo real".
  const received = next(second, "message");
  const ack = await withAck(first, "message", { text: "  Mensagem de integração  ", clientId: "cliente-1" });
  assert.equal(ack.ok, true);
  const message = await received;
  assert.equal(message.sender, "Pessoa 1");
  assert.equal(message.text, "Mensagem de integração");
  assert.equal(message.clientId, "cliente-1");
  assert.deepEqual(message.reactions, {});

  // Reenvio após queda não duplica.
  const retry = await withAck(first, "message", { text: "Mensagem de integração", clientId: "cliente-1" });
  assert.equal(retry.message.id, message.id);
  assert.equal((await withAck(first, "message", { text: "   " })).error, "Mensagem vazia.");

  // Resposta, reação, leitura e apagar.
  const reply = await withAck(second, "message", { text: "Respondendo", clientId: "cliente-2", replyTo: message.id });
  assert.equal(reply.message.replyTo.id, message.id);
  assert.equal(reply.message.replyTo.text, "Mensagem de integração");

  const reacted = next(first, "message:update");
  second.emit("react", { id: message.id, emoji: "❤️" });
  assert.deepEqual((await reacted).reactions, { "❤️": ["Pessoa 2"] });

  const seen = next(second, "seen");
  first.emit("seen", { id: message.id }); // já lida (foi quem enviou): ignorada
  first.emit("seen", { id: reply.message.id });
  const receipt = await seen;
  assert.equal(receipt.name, "Pessoa 1");
  assert.equal(receipt.id, reply.message.id);

  const notMine = silent(first, "message:update");
  first.emit("delete", { id: reply.message.id });
  await notMine;
  const deleted = next(first, "message:update");
  second.emit("delete", { id: reply.message.id });
  assert.equal((await deleted).deleted, true);

  // Números do perfil: mensagem apagada não conta, e cada reação conta para quem reagiu.
  assert.deepEqual(await withAck(first, "stats"), { messages: 1, reactions: 0, since: message.createdAt });
  assert.deepEqual(await withAck(second, "stats"), { messages: 0, reactions: 1, since: message.createdAt });

  // Página anterior do histórico.
  const older = await withAck(first, "history:before", { before: message.id });
  assert.deepEqual(older, { items: [], hasMore: false });

  // GIF: a chave da busca chega com o histórico, e o servidor só aceita imagens do próprio GIPHY.
  assert.equal(first.history.gifKey, giphyKey);
  const gif = { url: "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/l0MYt5jPR6QX5pnqM/200.webp?cid=790b7611&rid=200.webp&ct=g", width: "356", height: "200", title: "Batata dançando" };
  const gifArrived = next(second, "message");
  const gifSent = await withAck(first, "message", { text: "texto junto é ignorado", gif, clientId: "cliente-gif" });
  assert.equal(gifSent.ok, true);
  const gifMessage = await gifArrived;
  assert.equal(gifMessage.text, "");
  assert.deepEqual(gifMessage.gif, { url: gif.url, width: 356, height: 200, title: "Batata dançando" });
  assert.equal(message.gif, null);
  assert.deepEqual(JSON.parse(sql(`SELECT media FROM {p}messages WHERE id = '${gifMessage.id}'`)[0].media), gifMessage.gif);
  for (const bad of [
    { ...gif, url: "https://giphy.com.exemplo.net/media/x/200.gif" },
    { ...gif, url: "http://media.giphy.com/media/x/200.gif" },
    { ...gif, url: "javascript:alert(1)" },
    { ...gif, url: "https://media.giphy.com/media/x/200.gif\" onerror=\"x" },
    { ...gif, width: 0 },
    "https://media.giphy.com/media/x/200.gif"
  ]) {
    assert.equal((await withAck(first, "message", { gif: bad, clientId: "gif-ruim" })).error, "GIF inválido.", JSON.stringify(bad));
  }
  // Resposta a um GIF cita "GIF"; apagar o GIF tira o endereço do banco.
  const gifReply = await withAck(second, "message", { text: "Que GIF!", clientId: "cliente-gif-2", replyTo: gifMessage.id });
  assert.equal(gifReply.message.replyTo.text, "GIF");
  const gifGone = next(second, "message:update");
  first.emit("delete", { id: gifMessage.id });
  const gifDeleted = await gifGone;
  assert.equal(gifDeleted.deleted, true);
  assert.equal(gifDeleted.gif, null);

  // Fotos e arquivos: o arquivo sobe primeiro e a mensagem vai depois, só com a chave dele.
  const fileMax = first.history.fileMax;
  assert.ok(fileMax > 0 && fileMax <= 10000000, `fileMax ${fileMax}`);
  const photoBytes = makePng(64, 48);
  const photoUp = await upload(firstLogin.body.token, "férias/praia.png", photoBytes, "image/png");
  assert.equal(photoUp.status, 200);
  const photoKey = photoUp.body.file.key;
  assert.match(photoKey, /^[0-9a-f]{32}$/);
  assert.deepEqual(photoUp.body.file, { key: photoKey, kind: "image", type: "image/png", width: 64, height: 48, name: "férias_praia.png", size: photoBytes.length });
  assert.equal((await upload("sessao-falsa", "oi.txt", Buffer.from("oi"))).status, 401);
  assert.equal((await upload(firstLogin.body.token, "vazio.txt", Buffer.alloc(0))).status, 400);
  assert.equal((await upload(firstLogin.body.token, "grande.bin", Buffer.alloc(fileMax + 1))).status, 413);
  // A chave é de quem enviou: a outra pessoa não consegue mandar.
  assert.equal((await withAck(second, "message", { file: photoKey, clientId: "arquivo-alheio" })).error, "Arquivo não encontrado. Tente enviar de novo.");
  const photoArrived2 = next(second, "message");
  assert.equal((await withAck(first, "message", { file: photoKey, clientId: "cliente-foto" })).ok, true);
  const photoMessage = await photoArrived2;
  assert.deepEqual(photoMessage.file, { url: `api.php?action=file&k=${photoKey}`, name: "férias_praia.png", type: "image/png", kind: "image", size: photoBytes.length, width: 64, height: 48 });
  assert.equal(photoMessage.gif, null);
  // Reenvio após queda devolve a mesma mensagem; a mesma chave não vale para outra.
  assert.equal((await withAck(first, "message", { file: photoKey, clientId: "cliente-foto" })).message.id, photoMessage.id);
  assert.equal((await withAck(first, "message", { file: photoKey, clientId: "cliente-foto-2" })).error, "Arquivo não encontrado. Tente enviar de novo.");
  // Imagem abre no chat (com proteção); faixa de bytes funciona; ?dl=1 baixa.
  const photoUrl = `${baseUrl}/${photoMessage.file.url}`;
  let served = await fetch(photoUrl);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/png");
  assert.match(served.headers.get("content-disposition"), /^inline; filename="f_rias_praia\.png"; filename\*=UTF-8''f%C3%A9rias_praia\.png$/);
  assert.match(served.headers.get("content-security-policy"), /sandbox/);
  assert.equal(served.headers.get("x-content-type-options"), "nosniff");
  assert.ok(Buffer.from(await served.arrayBuffer()).equals(photoBytes));
  served = await fetch(photoUrl, { headers: { Range: "bytes=0-9" } });
  assert.equal(served.status, 206);
  assert.equal(served.headers.get("content-range"), `bytes 0-9/${photoBytes.length}`);
  assert.ok(Buffer.from(await served.arrayBuffer()).equals(photoBytes.subarray(0, 10)));
  assert.equal((await fetch(photoUrl, { headers: { Range: `bytes=${photoBytes.length + 5}-` } })).status, 416);
  assert.match((await fetch(`${photoUrl}&dl=1`)).headers.get("content-disposition"), /^attachment;/);
  const photoReply = await withAck(second, "message", { text: "Que foto linda", clientId: "cliente-foto-3", replyTo: photoMessage.id });
  assert.equal(photoReply.message.replyTo.text, "Foto");
  // HTML disfarçado vira arquivo comum: sempre baixa, nunca abre dentro do site.
  const htmlUp = await upload(firstLogin.body.token, "pagina.html", Buffer.from("<script>alert(1)</script>"), "text/html");
  assert.equal(htmlUp.body.file.kind, "file");
  assert.equal(htmlUp.body.file.type, "application/octet-stream");
  const htmlSent = await withAck(first, "message", { file: htmlUp.body.file.key, clientId: "cliente-html" });
  served = await fetch(`${baseUrl}/${htmlSent.message.file.url}`);
  assert.equal(served.headers.get("content-type"), "application/octet-stream");
  assert.match(served.headers.get("content-disposition"), /^attachment;/);
  assert.equal((await withAck(second, "message", { text: "?", clientId: "cliente-html-2", replyTo: htmlSent.message.id })).message.replyTo.text, "pagina.html");
  // Apagar a mensagem apaga o arquivo.
  const photoGone2 = next(second, "message:update");
  first.emit("delete", { id: photoMessage.id });
  assert.equal((await photoGone2).file, null);
  assert.equal((await fetch(photoUrl)).status, 404);
  assert.equal(sql(`SELECT COUNT(*) AS n FROM {p}files WHERE file_key = '${photoKey}'`)[0].n, 0);
  // Arquivo que nunca virou mensagem some depois de um dia.
  const orphan = await upload(firstLogin.body.token, "esquecido.txt", Buffer.from("tchau"));
  rawSql(`UPDATE {p}files SET created_at = 1 WHERE file_key = '${orphan.body.file.key}';`);
  await fetch(`${baseUrl}/api.php?action=health`);
  assert.equal(sql(`SELECT COUNT(*) AS n FROM {p}files WHERE file_key = '${orphan.body.file.key}'`)[0].n, 0);

  // Foto de perfil: fica no banco, aparece na presença da outra pessoa e é servida pela API.
  const png = makePng(40, 40);
  const photoOf = (list, name) => list.find((person) => person.name === name)?.avatar;
  const photoArrived = until(second, "presence", (list) => Boolean(photoOf(list, "Pessoa 1")));
  const saved = await withAck(first, "avatar", { image: `data:image/png;base64,${png.toString("base64")}` });
  assert.equal(saved.ok, true);
  assert.match(saved.avatar, /^api\.php\?action=avatar&k=[0-9a-f]{32}$/);
  assert.equal(photoOf(await photoArrived, "Pessoa 1"), saved.avatar);
  const photo = await fetch(`${baseUrl}/${saved.avatar}`);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get("content-type"), "image/png");
  assert.match(photo.headers.get("cache-control"), /immutable/);
  assert.ok(Buffer.from(await photo.arrayBuffer()).equals(png));
  assert.equal((await withAck(first, "avatar", { image: "data:image/png;base64,AAAA" })).error, "Imagem inválida.");
  assert.equal((await withAck(first, "avatar", { image: `data:image/bmp;base64,${png.toString("base64")}` })).error, "Formato de imagem não aceito.");
  assert.equal((await withAck(first, "avatar", { image: `data:image/gif;base64,${png.toString("base64")}` })).error, "Imagem inválida.");
  assert.equal((await withAck(first, "avatar", { image: `data:image/jpeg;base64,${png.toString("base64")}` })).error, "Imagem inválida.");
  // GIF animado vale como foto, inteiro, até 700 KB.
  const gifPhoto = await withAck(second, "avatar", { image: `data:image/gif;base64,${makeGif().toString("base64")}` });
  assert.equal(gifPhoto.ok, true);
  const gifServed = await fetch(`${baseUrl}/${gifPhoto.avatar}`);
  assert.equal(gifServed.headers.get("content-type"), "image/gif");
  assert.ok(Buffer.from(await gifServed.arrayBuffer()).equals(makeGif()));
  assert.equal((await withAck(second, "avatar", { image: `data:image/gif;base64,${makeGif(705000).toString("base64")}` })).error, "Imagem grande demais.");
  assert.equal((await fetch(`${baseUrl}/api.php?action=avatar&k=${"0".repeat(32)}`)).status, 404);
  // Trocar a foto muda o endereço; remover apaga do banco.
  const swapped = await withAck(second, "avatar", { image: `data:image/png;base64,${makePng(64, 48).toString("base64")}` });
  assert.ok(swapped.ok);
  assert.notEqual(swapped.avatar, saved.avatar);
  const photoGone = until(second, "presence", (list) => photoOf(list, "Pessoa 1") === null);
  assert.deepEqual(await withAck(first, "avatar", { image: null }), { ok: true, avatar: null });
  await photoGone;
  assert.equal((await fetch(`${baseUrl}/${saved.avatar}`)).status, 404);
  assert.equal(sql("SELECT avatar FROM {p}users WHERE name = 'Pessoa 1'")[0].avatar, null);

  // Tema: fica na conta, muda na hora nas outras abas da mesma pessoa e não vai para a outra pessoa.
  assert.equal(first.history.theme, null);
  const firstTab2 = await connect(firstLogin.body.token);
  const themed = next(firstTab2, "theme");
  const notForPeer = silent(second, "theme", 2500);
  assert.deepEqual(await withAck(first, "theme", { theme: "rosa" }), { ok: true });
  assert.deepEqual(await themed, { theme: "rosa" });
  await notForPeer;
  assert.equal((await withAck(first, "theme", { theme: "neon" })).error, "Tema desconhecido.");
  firstTab2.disconnect();
  const firstTab3 = await connect(firstLogin.body.token);
  assert.equal(firstTab3.history.theme, "rosa");
  firstTab3.disconnect();
  assert.equal(sql("SELECT theme FROM {p}users WHERE name = 'Pessoa 1'")[0].theme, "rosa");

  // Papel de parede: fica na conta, muda nas outras abas da mesma pessoa e não vai para a outra pessoa.
  assert.equal(first.history.wallpaper, null);
  const wallTab = await connect(firstLogin.body.token);
  const wallArrived = next(wallTab, "wallpaper");
  const wallNotForPeer = silent(second, "wallpaper", 2500);
  const wallImage = `data:image/png;base64,${makePng(200, 120).toString("base64")}`;
  const wallSaved = await withAck(first, "wallpaper", { image: wallImage, style: { light: -250, blur: 7.4, tint: "40", extra: 1 } });
  assert.equal(wallSaved.ok, true);
  assert.match(wallSaved.wallpaper.url, /^api\.php\?action=wallpaper&k=[0-9a-f]{32}$/);
  assert.deepEqual(wallSaved.wallpaper.style, { light: -100, blur: 7, tint: 40 });
  assert.deepEqual(await wallArrived, { wallpaper: wallSaved.wallpaper });
  await wallNotForPeer;
  const wallServed = await fetch(`${baseUrl}/${wallSaved.wallpaper.url}`);
  assert.equal(wallServed.status, 200);
  assert.equal(wallServed.headers.get("content-type"), "image/png");
  // Só os ajustes: a foto continua a mesma.
  const wallTuned = await withAck(first, "wallpaper", { style: { light: 30, blur: 0, tint: 0 } });
  assert.equal(wallTuned.wallpaper.url, wallSaved.wallpaper.url);
  assert.deepEqual(wallTuned.wallpaper.style, { light: 30, blur: 0, tint: 0 });
  const wallTab2 = await connect(firstLogin.body.token);
  assert.deepEqual(wallTab2.history.wallpaper, wallTuned.wallpaper);
  wallTab2.disconnect();
  assert.equal((await withAck(first, "wallpaper", { image: "data:image/svg+xml;base64,PHN2Zz4=" })).error, "Formato de imagem não aceito.");
  assert.equal((await withAck(first, "wallpaper", { image: `data:image/png;base64,${makePng(20, 20).toString("base64")}` })).error, "Imagem inválida.");
  assert.equal((await withAck(second, "wallpaper", { style: { light: 0 } })).error, "Escolha uma foto primeiro.");
  assert.deepEqual(await withAck(first, "wallpaper", { image: null }), { ok: true, wallpaper: null });
  assert.equal((await fetch(`${baseUrl}/${wallSaved.wallpaper.url}`)).status, 404);
  wallTab.disconnect();

  // Mensagem enviada pela extensão chega para os dois lados.
  const fromExtension = next(second, "message");
  const sent = await api("ops", { ...extension, ops: [{ event: "message", data: { text: "Via extensão", clientId: "cliente-3" } }] });
  assert.equal(sent.body.results[0].ok, true);
  assert.equal((await fromExtension).source, "extension");

  // Digitando e sinalização de chamada vão só para a outra pessoa, nunca para as próprias conexões.
  const typing = next(second, "typing");
  first.emit("typing", true);
  assert.deepEqual(await typing, { name: "Pessoa 1", active: true });

  const cursor = (await api("poll", { ...extension, cursor: 0 })).body.cursor;
  const offer = next(second, "webrtc-offer");
  first.emit("webrtc-offer", { media: "audio", description: { type: "offer", sdp: "x" } });
  const incoming = await offer;
  assert.equal(incoming.name, "Pessoa 1");
  assert.equal(incoming.from, first.id);

  // Resposta e candidatos chegam em ordem, só na aba que ligou.
  const answer = next(first, "webrtc-answer");
  const ice = next(first, "webrtc-ice");
  second.emit("webrtc-answer", { description: { type: "answer", sdp: "y" }, to: incoming.from });
  second.emit("webrtc-ice", { candidate: { candidate: "c1" }, to: incoming.from });
  assert.equal((await answer).from, second.id);
  assert.equal((await ice).candidate.candidate, "c1");
  const extensionEvents = (await api("poll", { ...extension, cursor })).body.events.map((event) => event.type);
  assert.ok(!extensionEvents.includes("webrtc-offer"), "a extensão não pode receber a chamada");
  assert.ok(!extensionEvents.includes("typing"));

  // Long polling: a consulta fica esperando e volta assim que chega algo.
  const waiting = { token: secondLogin.body.token, conn: "espera-longa-1", client: "web" };
  const start = await api("connect", waiting, longUrl);
  const started = Date.now();
  const pending = api("poll", { ...waiting, cursor: start.body.cursor }, longUrl);
  await new Promise((resolve) => setTimeout(resolve, 700));
  await withAck(first, "message", { text: "Acordou?", clientId: "cliente-4" });
  const woke = await pending;
  const elapsed = Date.now() - started;
  assert.ok(woke.body.events.some((event) => event.type === "message" && event.data.text === "Acordou?"));
  assert.ok(elapsed < 2500, `long polling demorou ${elapsed} ms`);
  const idle = Date.now();
  const empty = await api("poll", { ...waiting, cursor: woke.body.cursor }, longUrl);
  assert.deepEqual(empty.body.events, []);
  assert.ok(Date.now() - idle >= 2500, "long polling deveria esperar quando não há novidade");
  await api("disconnect", waiting, longUrl);

  // Sessões criadas pela versão Node continuam valendo (mesmo formato de token).
  const body = Buffer.from(JSON.stringify({ name: "Pessoa 2", expiresAt: Date.now() + 864e5, nonce: crypto.randomUUID() })).toString("base64url");
  const nodeToken = `${body}.${crypto.createHmac("sha256", secret).update(body).digest("base64url")}`;
  const fromNode = await api("connect", { token: nodeToken, conn: "sessao-node-1", client: "web" });
  assert.equal(fromNode.status, 200);
  assert.equal(fromNode.body.session.name, "Pessoa 2"); // sessão curta é renovada
  await api("disconnect", { token: nodeToken, conn: "sessao-node-1" });
  assert.equal((await api("connect", { token: `${body}.assinatura-falsa`, conn: "sessao-falsa-1" })).status, 401);

  // Sair: a outra pessoa vê "visto por último".
  const left = next(second, "presence");
  first.disconnect();
  const after = (await left).find((person) => person.name === "Pessoa 1");
  assert.equal(after.online, false);
  assert.ok(after.lastSeen);

  second.disconnect();
  await api("disconnect", extension);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const health = await (await fetch(`${baseUrl}/api.php?action=health`)).json();
  assert.deepEqual(health, { ok: true, people: 0 });

  const stored = sql("SELECT * FROM {p}messages ORDER BY n");
  assert.equal(stored.length, 10);
  assert.equal(JSON.parse(stored[0].reactions)["❤️"][0], "Pessoa 2");
  assert.equal(stored[1].deleted, 1);
  assert.equal(stored[1].text, "");
  assert.equal(stored[2].deleted, 1);
  assert.equal(stored[2].media, null);
  assert.equal(JSON.parse(stored[3].reply_to).text, "GIF");
  // Foto apagada não deixa nada no banco; o arquivo enviado fica guardado na mensagem.
  assert.equal(stored[4].deleted, 1);
  assert.equal(stored[4].media, null);
  assert.equal(JSON.parse(stored[6].media).file.name, "pagina.html");
  assert.equal(stored[8].source, "extension");
  assert.equal(stored[9].text, "Acordou?");
  const status = Object.fromEntries(sql("SELECT name, last_seen FROM {p}status").map((row) => [row.name, row.last_seen]));
  assert.ok(status["Pessoa 1"]);
  assert.ok(status["Pessoa 2"]);
  assert.equal(sql("SELECT COUNT(*) AS total FROM {p}clients")[0].total, 0);

  // Histórico paginado: mais de 60 mensagens viram páginas.
  // (o limite é de 25 mensagens a cada 10 s por conexão: manda em lotes de 20, cada um por uma conexão)
  for (let batch = 0; batch < 4; batch += 1) {
    const sender = { token: secondLogin.body.token, conn: `lote-de-envio-${batch}`, client: "web" };
    const ops = [];
    for (let i = batch * 20; i < Math.min(65, batch * 20 + 20); i += 1) ops.push({ event: "message", data: { text: `Mensagem ${i}`, clientId: `lote-${i}` } });
    const result = await api("ops", { ...sender, ops });
    assert.ok(result.body.results.every((item) => item.ok), JSON.stringify(result.body));
    await api("disconnect", sender);
  }
  // A 26ª mensagem seguida da mesma conexão é recusada.
  const flood = { token: secondLogin.body.token, conn: "enxurrada-1", client: "web" };
  const flooded = await api("ops", { ...flood, ops: Array.from({ length: 26 }, (_, i) => ({ event: "message", data: { text: `x${i}`, clientId: `x${i}` } })) });
  assert.equal(flooded.body.results[25].error, "Calma! Muitas mensagens em pouco tempo.");
  await api("disconnect", flood);
  sql("DELETE FROM {p}messages WHERE text LIKE 'x%'");
  const again = await connect(secondLogin.body.token);
  assert.equal(again.history.items.length, 60);
  assert.equal(again.history.hasMore, true);
  assert.equal(again.history.items.at(-1).text, "Mensagem 64");
  const before = await withAck(again, "history:before", { before: again.history.items[0].id });
  assert.equal(before.items.length, 15);
  assert.equal(before.hasMore, false);
  assert.equal(before.items[0].text, "Mensagem de integração");
  again.disconnect();

  // Senha esquecida: apagar o pass_hash no phpMyAdmin derruba as sessões e libera escolher outra senha.
  sql("DELETE FROM {p}logins");
  sql("UPDATE {p}users SET pass_hash = NULL WHERE name = 'Pessoa 2'");
  assert.equal((await api("connect", { token: secondLogin.body.token, conn: "sem-senha-1", client: "web" })).status, 401);
  assert.deepEqual(await welcome(), { open: 1 });
  assert.deepEqual((await login("Pessoa 2", "senha-nova")).body, { confirm: true, name: "Pessoa 2" });
  assert.equal((await login("Pessoa 2", "senha-nova", "senha-nova")).status, 200);
  assert.equal((await login("Pessoa 2", "senha-2")).status, 401);
  assert.equal((await api("connect", { token: secondLogin.body.token, conn: "sem-senha-2", client: "web" })).status, 200);
  await api("disconnect", { token: secondLogin.body.token, conn: "sem-senha-2" });

  // Bot de música (/play): uma fila só para os dois, com o tempo marcado no relógio do servidor.
  // (Sem internet nos testes: os links são reconhecidos, mas o título não é consultado.)
  const dj1 = await connect(firstLogin.body.token);
  const dj2 = await connect(secondLogin.body.token);
  assert.equal(dj1.history.music.now, null);
  assert.ok(dj1.history.music.serverNow > 0);
  const musicSeen = next(dj2, "music");
  const cardSeen = next(dj2, "message");
  const played = await withAck(dj1, "music", { op: "play", query: "olha essa: https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s" });
  assert.equal(played.ok, true);
  assert.equal(played.state.now.source, "youtube");
  assert.equal(played.state.now.id, "dQw4w9WgXcQ");
  assert.equal(played.state.now.by, "Pessoa 1");
  assert.equal(played.state.now.thumb, "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg");
  assert.equal(played.state.playing, true);
  assert.deepEqual((await musicSeen).state.now, played.state.now);
  const card = await cardSeen;
  assert.equal(card.source, "music");
  assert.equal(card.text, "");
  assert.equal(card.music.id, "dQw4w9WgXcQ");
  assert.equal(card.music.queued, 0);
  assert.equal(card.music.cover, "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  // Responder ao cartão cita a música (sem emoji).
  const cardReply = await withAck(dj2, "message", { text: "Amo essa", clientId: "cliente-musica", replyTo: card.id });
  assert.equal(cardReply.message.replyTo.text, "Música: Vídeo do YouTube");
  // Com música tocando, a próxima vai para a fila.
  const queued = await withAck(dj2, "music", { op: "play", query: "https://open.spotify.com/intl-pt/track/4cOdK2wGLETKBW3PvgPWqT?si=abc" });
  assert.deepEqual([queued.state.queue.length, queued.state.queue[0].source, queued.state.queue[0].type, queued.state.queue[0].by, queued.action.queued], [1, "spotify", "track", "Pessoa 2", 1]);
  assert.equal(queued.state.now.uid, played.state.now.uid);
  // Pausar guarda em que segundo parou; /play sozinho continua.
  await new Promise((resolve) => setTimeout(resolve, 400));
  const paused = await withAck(dj1, "music", { op: "pause" });
  assert.equal(paused.state.playing, false);
  assert.ok(paused.state.position >= 0.3, `posição ${paused.state.position}`);
  const resumed = await withAck(dj2, "music", { op: "play" });
  assert.deepEqual([resumed.action.op, resumed.state.playing], ["resume", true]);
  assert.equal((await withAck(dj1, "music", { op: "seek", position: 42 })).state.position, 42);
  // A música acaba nos dois aparelhos ao mesmo tempo: só um aviso faz pular.
  const uid = played.state.now.uid;
  const ends = await Promise.all([withAck(dj1, "music", { op: "ended", uid }), withAck(dj2, "music", { op: "ended", uid })]);
  for (const end of ends) assert.deepEqual([end.state.now.source, end.state.queue.length, end.state.position], ["spotify", 0, 0]);
  // Quem entra depois recebe a fila com o histórico.
  const dj3 = await connect(firstLogin.body.token);
  assert.equal(dj3.history.music.now.uid, ends[0].state.now.uid);
  dj3.disconnect();
  // Erros e o fim da fila.
  assert.equal((await withAck(dj1, "music", { op: "play", query: "anavitoria trevo" })).error, "A busca pelo nome está desligada.");
  assert.equal((await withAck(dj1, "music", { op: "dançar" })).error, "Comando de música desconhecido.");
  const lastSkip = await withAck(dj2, "music", { op: "skip" });
  assert.deepEqual([lastSkip.state.now, lastSkip.state.playing], [null, false]);
  assert.equal((await withAck(dj1, "music", { op: "pause" })).error, "Nada tocando agora.");
  assert.equal((await withAck(dj1, "music", { op: "play" })).error, "Nada tocando. Use /play com o nome ou o link de uma música.");
  await withAck(dj1, "music", { op: "play", query: "https://youtu.be/dQw4w9WgXcQ" });
  await withAck(dj1, "music", { op: "play", query: "spotify:album:4LH4d3cOWNNsVw41Gqt2kv" });
  // Tocar agora uma da fila (botão do cartão): ela sai da fila e começa do zero.
  const third = await withAck(dj2, "music", { op: "play", query: "https://youtu.be/9bZkp7q19f0" });
  const album = third.state.queue[0];
  assert.deepEqual([album.title, album.artist, third.state.queue.length], ["Álbum do Spotify", "Álbum", 2]);
  const jumpSeen = new Promise((resolve) => dj1.on("music", function seen(payload) {
    if (payload.action?.op !== "jump") return;
    dj1.off("music", seen);
    resolve(payload);
  }));
  const jumped = await withAck(dj2, "music", { op: "jump", uid: album.uid });
  assert.deepEqual([jumped.state.now.uid, jumped.state.queue.map((item) => item.id), jumped.state.playing, jumped.state.position], [album.uid, ["9bZkp7q19f0"], true, 0]);
  assert.equal((await jumpSeen).action.track.uid, album.uid);
  assert.equal((await withAck(dj2, "music", { op: "jump", uid: album.uid })).error, "Essa música não está mais na fila.");
  const stopped = await withAck(dj2, "music", { op: "stop" });
  assert.deepEqual([stopped.state.now, stopped.state.queue], [null, []]);
  // Assistir junto: um vídeo para os dois, com play/pause compartilhado; começar um vídeo pausa a música.
  assert.equal(dj1.history.watch.now, null);
  await withAck(dj1, "music", { op: "play", query: "https://youtu.be/dQw4w9WgXcQ" });
  const watchSeen = next(dj2, "watch");
  const watching = await withAck(dj1, "watch", { op: "start", query: "assiste: https://www.youtube.com/watch?v=aqz-KE-bpKQ" });
  assert.deepEqual([watching.state.now.source, watching.state.now.id, watching.state.now.by, watching.state.playing], ["youtube", "aqz-KE-bpKQ", "Pessoa 1", true]);
  assert.equal((await watchSeen).action.item.uid, watching.state.now.uid);
  assert.equal((await withAck(dj2, "music", { op: "seek", position: 1 })).state.playing, false);
  const watchPaused = await withAck(dj2, "watch", { op: "pause" });
  assert.equal(watchPaused.state.playing, false);
  assert.equal((await withAck(dj1, "watch", { op: "resume" })).state.playing, true);
  assert.equal((await withAck(dj1, "watch", { op: "seek", position: 90 })).state.position, 90);
  const twitch = await withAck(dj2, "watch", { op: "start", query: "https://www.twitch.tv/videos/123456789" });
  assert.deepEqual([twitch.state.now.source, twitch.state.now.kind, twitch.state.now.id, twitch.state.position], ["twitch", "video", "123456789", 0]);
  const channel = (await withAck(dj2, "watch", { op: "start", query: "twitch.tv/Gaules" })).state.now;
  assert.deepEqual([channel.kind, channel.id], ["channel", "gaules"]);
  const local = await withAck(dj1, "watch", { op: "start", local: { name: "filme/da noite.mp4", size: 1234, duration: 5400.5 } });
  assert.deepEqual([local.state.now.source, local.state.now.name, local.state.now.duration], ["local", "filme_da noite.mp4", 5400.5]);
  assert.equal((await withAck(dj1, "watch", { op: "start", query: "https://clips.twitch.tv/AlgumClipe" })).error, "Clipe da Twitch não dá para assistir junto: use o link do vídeo ou do canal.");
  assert.equal((await withAck(dj1, "watch", { op: "start", query: "um filme bom" })).error, "Não achei esse vídeo. Cole o link do YouTube ou da Twitch (ou escolha um vídeo do aparelho).");
  const watchEnded = await withAck(dj2, "watch", { op: "ended", uid: local.state.now.uid });
  assert.equal(watchEnded.state.playing, false);
  assert.deepEqual((await withAck(dj1, "watch", { op: "stop" })).state.now, null);
  await withAck(dj1, "music", { op: "stop" });

  // O cartão do bot não conta como mensagem no perfil.
  const statsBefore = (await withAck(dj1, "stats")).messages;
  await withAck(dj1, "music", { op: "play", query: "https://youtu.be/dQw4w9WgXcQ" });
  assert.equal((await withAck(dj1, "stats")).messages, statsBefore);
  await withAck(dj1, "music", { op: "stop" });
  dj1.disconnect();
  dj2.disconnect();

  // Muitas tentativas de senha: bloqueia.
  let blocked = 0;
  for (let i = 0; i < 14; i += 1) if ((await login("Pessoa 1", "errada")).status === 429) blocked += 1;
  assert.ok(blocked >= 1);

  console.log("Integração PHP + MySQL aprovada: atualização do banco antigo, página, contas com senha própria, sala de duas pessoas, GIFs, fotos e arquivos (envio, entrega protegida, faixas de bytes, limpeza), foto de perfil (também em GIF), tema, papel de parede, bot de música, extensão, confirmação, deduplicação, respostas, reações, leitura, apagar, digitando, chamadas, long polling, sessões da versão Node, paginação, senha esquecida e persistência.");
} finally {
  servers.forEach((server) => server.kill());
  try {
    const tables = sql(`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE '${prefix}%'`);
    if (tables.length) sql(`DROP TABLE ${tables.map((table) => `\`${table.name}\``).join(", ")}`);
  } catch {}
  await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
}
