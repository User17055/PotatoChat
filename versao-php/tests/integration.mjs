import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
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
// Serviço de transcrição falso (no formato da OpenAI/Groq): guarda o que recebeu e responde o texto (ou o erro) combinado.
const transcriber = { calls: [], status: 200, text: "  Oi, tudo bem? Chego às oito.  " };
const transcriberServer = http.createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    transcriber.calls.push({ headers: request.headers, body: Buffer.concat(chunks) });
    response.writeHead(transcriber.status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(transcriber.status === 200 ? { text: transcriber.text } : { error: { message: "chave inválida" } }));
  });
});
await new Promise((resolve) => transcriberServer.listen(0, "127.0.0.1", resolve));
const transcribeUrl = `http://127.0.0.1:${transcriberServer.address().port}/v1/audio/transcriptions`;
await fs.writeFile(configFile, `<?php return ${phpValue({ token_secret: secret, db, poll_wait: 3, giphy_key: giphyKey, music_lookup: false, transcribe_key: "chave-de-transcricao", transcribe_url: transcribeUrl, transcribe_model: "modelo-de-teste", turn_urls: ["turn:turn.example:3478?transport=udp", "turns:turn.example:5349?transport=tcp"], turn_secret: "segredo-turn-teste", turn_ttl: 600 })};`);

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

// Resultado de uma expressão PHP com o lib/potato.php carregado (para testar uma função direto).
function php(expression) {
  const code = `require ${phpValue(path.join(site, "lib", "potato.php").replaceAll("\\", "/"))}; echo json_encode(${expression}, JSON_UNESCAPED_UNICODE);`;
  return JSON.parse(execFileSync("php", [...phpArgs, "-r", code], { env: { ...process.env, POTATO_CONFIG: configFile } }).toString());
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

// Watch Party: um pedaço do vídeo do aparelho (como o app.js manda).
async function watchUpload(token, { key = "", offset = 0, size, name = "filme.mp4", room = "" }, data) {
  const headers = { "Content-Type": "application/octet-stream", "X-Potato-Token": token, "X-Potato-Key": key, "X-Potato-Offset": String(offset), "X-Potato-Size": String(size), "X-Potato-Name": encodeURIComponent(name), "X-Potato-Room": room };
  const response = await fetch(`${baseUrl}/api.php?action=watch-upload`, { method: "POST", headers, body: data });
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
  assert.ok(sql("SHOW COLUMNS FROM {p}messages").some((row) => row.Field === "read_at"), "read_at");
  assert.equal(sql("SELECT value FROM {p}settings WHERE name = 'schema'")[0].value, "9");
  assert.ok(sql("SHOW COLUMNS FROM {p}items").some((row) => row.Field === "data"), "tabela do nosso cantinho");
  for (const table of ["rooms", "reads", "invites"]) assert.ok(sql(`SHOW COLUMNS FROM {p}${table}`).length, `tabela ${table}`);
  assert.ok(sql("SHOW COLUMNS FROM {p}messages").some((row) => row.Field === "room"), "conversa da mensagem");
  assert.ok(sql("SHOW COLUMNS FROM {p}files").some((row) => row.Field === "data"), "tabela de arquivos");
  assert.deepEqual(await welcome(), { open: 2 });

  // Primeiro acesso: o servidor pede a senha de novo antes de guardar, e não aceita senha curta.
  assert.deepEqual((await login("pessoa 1", "senha-1")).body, { confirm: true, name: "Pessoa 1" });
  assert.equal((await login("Pessoa 1", "senha-1", "senha-um")).body.error, "As senhas não são iguais. Digite de novo.");
  assert.equal((await login("Pessoa 1", "abc", "abc")).status, 400);
  const firstLogin = await login("Pessoa 1", "senha-1", "senha-1");
  assert.equal(firstLogin.status, 200);
  assert.equal(firstLogin.body.created, true);
  assert.equal((await api("rtc-config", {})).status, 401);
  const rtc = await api("rtc-config", { token: firstLogin.body.token });
  assert.equal(rtc.status, 200);
  assert.equal(rtc.body.turnConfigured, true);
  assert.ok(rtc.body.expiresAt > Date.now() && rtc.body.expiresAt <= Date.now() + 601000);
  const turn = rtc.body.iceServers.at(-1);
  assert.equal(turn.credential, crypto.createHmac("sha1", "segredo-turn-teste").update(turn.username).digest("base64"));
  assert.ok(!JSON.stringify(rtc.body).includes("segredo-turn-teste"));
  assert.deepEqual(await welcome(), { open: 1 });
  const secondLogin = await login("Pessoa 2", "senha-2", "senha-2");
  assert.equal(secondLogin.status, 200);
  assert.deepEqual(await welcome(), { open: 0 });

  // Depois disso, nome e senha valem para sempre: senha errada não entra, e a terceira pessoa nem cria conta.
  assert.equal((await login("Pessoa 1", "senha-2")).status, 401);
  const thirdLogin = await login("Intrusa", "qualquer", "qualquer");
  assert.equal(thirdLogin.status, 403);
  assert.equal(thirdLogin.body.error, "Para criar uma conta, peça um convite para quem já usa o Potato Chat.");
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
  assert.deepEqual([message.read, message.readAt], [false, null]);
  const replyRead = until(first, "seen", (receipt) => receipt.name === "Pessoa 2");
  const reply = await withAck(second, "message", { text: "Respondendo", clientId: "cliente-2", replyTo: message.id });
  assert.equal(reply.message.replyTo.id, message.id);
  assert.equal(reply.message.replyTo.text, "Mensagem de integração");
  // Responder conta como ler: quem escreveu vê na hora, e a hora fica na mensagem (dados da mensagem).
  assert.deepEqual(await replyRead, { name: "Pessoa 2", id: reply.message.id, at: reply.message.createdAt, room: first.history.room });
  assert.equal(reply.message.read, false);

  const reacted = next(first, "message:update");
  second.emit("react", { id: message.id, emoji: "❤️" });
  assert.deepEqual((await reacted).reactions, { "❤️": ["Pessoa 2"] });

  const seen = until(second, "seen", (receipt) => receipt.name === "Pessoa 1");
  first.emit("seen", { id: message.id }); // já lida (foi quem enviou): ignorada
  first.emit("seen", { id: reply.message.id });
  const receipt = await seen;
  assert.equal(receipt.id, reply.message.id);
  assert.deepEqual(sql("SELECT read_at FROM {p}messages ORDER BY n").map((row) => row.read_at), [reply.message.createdAt, receipt.at]);
  const readHistory = await withAck(first, "history:around", { id: message.id });
  assert.deepEqual(readHistory.items.map((item) => [item.read, item.readAt]), [[true, reply.message.createdAt], [true, receipt.at]]);

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

  // Digitando vai só para a outra pessoa da conversa, nunca para as próprias conexões (a sinalização da chamada está no
  // bloco das chamadas).
  const cursor = (await api("poll", { ...extension, cursor: 0 })).body.cursor;
  const typing = next(second, "typing");
  first.emit("typing", true);
  assert.deepEqual(await typing, { name: "Pessoa 1", active: true, audio: false, room: first.history.room });
  // Sem chamada atendida entre as duas conexões, a sinalização não passa.
  const stray = silent(second, "webrtc-offer", 1500);
  first.emit("webrtc-offer", { to: second.id, media: "audio", description: { type: "offer", sdp: "x" } });
  await stray;
  const extensionEvents = (await api("poll", { ...extension, cursor })).body.events.map((event) => event.type);
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

  // Trecho antigo (pesquisa, resposta antiga ou "ir para um dia"): metade da página antes da mensagem e o resto depois;
  // descendo, vem a próxima página até o fim.
  const tenth = sql("SELECT id FROM {p}messages WHERE text = 'Mensagem 10'")[0].id;
  const around = await withAck(again, "history:around", { id: tenth });
  assert.deepEqual([around.ok, around.target, around.items.length, around.hasMore, around.hasNewer], [true, tenth, 50, false, true]);
  assert.deepEqual([around.items[0].text, around.items[20].text, around.items.at(-1).text], ["Mensagem de integração", "Mensagem 10", "Mensagem 39"]);
  const below = await withAck(again, "history:after", { after: around.items.at(-1).id });
  assert.deepEqual([below.items.length, below.items[0].text, below.items.at(-1).text, below.hasNewer], [25, "Mensagem 40", "Mensagem 64", false]);
  const firstDay = await withAck(again, "history:around", { from: "2000-01-01T00:00:00.000Z" });
  assert.deepEqual([firstDay.target, firstDay.items.length, firstDay.hasMore, firstDay.hasNewer], [message.id, 30, false, true]);
  const lastDay = await withAck(again, "history:around", { from: "2999-01-01T00:00:00.000Z" });
  assert.deepEqual([lastDay.items.at(-1).text, lastDay.items.length, lastDay.hasMore, lastDay.hasNewer], ["Mensagem 64", 31, true, false]);
  assert.equal((await withAck(again, "history:around", { from: "ontem" })).error, "Dia inválido.");
  assert.equal((await withAck(again, "history:around", { id: "nao-existe" })).error, "Essa mensagem não existe mais.");

  // Pesquisa: na conversa inteira, sem diferença de maiúsculas e acentos, 30 de cada vez, das mais novas para as mais
  // antigas; apagadas não aparecem, e os nomes dos campos do JSON dos arquivos não contam.
  const found = [];
  let page = { hasMore: true, items: [] };
  while (page.hasMore) {
    page = await withAck(again, "search", { query: "  MENSAGEM  ", before: found.at(-1)?.id || "" });
    assert.ok(page.ok && page.items.length <= 30);
    found.push(...page.items);
  }
  assert.deepEqual([found[0].text, found[30].text, found.at(-1).text], ["Mensagem 64", "Mensagem 34", "Mensagem de integração"]);
  assert.equal(new Set(found.map((item) => item.id)).size, found.length);
  assert.deepEqual((await withAck(again, "search", { query: "integracao" })).items.map((item) => item.id), [message.id]);
  assert.equal((await withAck(again, "search", { query: "pagina" })).items[0].file.name, "pagina.html");
  for (const query of ["kind", "Respondendo", "a%", "m_ns"]) assert.deepEqual((await withAck(again, "search", { query })).items, [], query);
  assert.equal((await withAck(again, "search", { query: " x " })).error, "Escreva pelo menos 2 letras.");
  // Junto com outras ações, a pesquisa passa pelo caminho normal (com a trava) e dá o mesmo resultado.
  const together = await api("ops", { token: secondLogin.body.token, conn: "pesquisa-junto", client: "web", ops: [{ event: "search", data: { query: "integração" } }, { event: "stats" }] });
  assert.deepEqual(together.body.results[0].items.map((item) => item.id), [message.id]);
  await api("disconnect", { token: secondLogin.body.token, conn: "pesquisa-junto" });
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
  // Vídeo do aparelho: sobe em pedaços para o servidor e os dois assistem de lá (quem mandou pode sair).
  const movie = Buffer.concat([Buffer.from("000000186674797069736f6d0000020069736f6d69736f32", "hex"), crypto.randomBytes(3000)]);
  const room = dj1.history.room;
  const junk = Buffer.from("não é vídeo nenhum");
  assert.equal((await watchUpload(firstLogin.body.token, { size: junk.length, room }, junk)).body.error, "Esse arquivo não é um vídeo que o navegador toca (use MP4, WebM ou MOV).");
  assert.match((await watchUpload(firstLogin.body.token, { size: 5e9, room }, movie.subarray(0, 10))).body.error, /grande demais/);
  const part1 = (await watchUpload(firstLogin.body.token, { size: movie.length, name: "filme/da noite.mp4", room }, movie.subarray(0, 1000))).body;
  assert.deepEqual([part1.ok, part1.received], [true, 1000]);
  assert.equal((await withAck(dj1, "watch", { op: "start", local: { key: part1.key } })).error, "O vídeo ainda não terminou de subir.");
  // Pedaço repetido não grava de novo: o servidor diz até onde já tem. O envio é só de quem começou.
  assert.equal((await watchUpload(firstLogin.body.token, { key: part1.key, offset: 0, size: movie.length, room }, movie.subarray(0, 1000))).body.received, 1000);
  assert.equal((await watchUpload(secondLogin.body.token, { key: part1.key, offset: 1000, size: movie.length, room }, movie.subarray(1000))).body.ok, false);
  assert.equal((await watchUpload(firstLogin.body.token, { key: part1.key, offset: 1000, size: movie.length, room }, movie.subarray(1000))).body.received, movie.length);
  const local = await withAck(dj1, "watch", { op: "start", local: { key: part1.key, duration: 5400.5 } });
  assert.deepEqual([local.state.now.source, local.state.now.name, local.state.now.duration], ["local", "filme_da noite.mp4", 5400.5]);
  const servedWhole = await fetch(`${baseUrl}/${local.state.now.url}`);
  assert.deepEqual([servedWhole.status, servedWhole.headers.get("content-type")], [200, "video/mp4"]);
  assert.ok(Buffer.from(await servedWhole.arrayBuffer()).equals(movie));
  const servedPart = await fetch(`${baseUrl}/${local.state.now.url}`, { headers: { Range: "bytes=1000-" } });
  assert.deepEqual([servedPart.status, servedPart.headers.get("content-range")], [206, `bytes 1000-${movie.length - 1}/${movie.length}`]);
  assert.ok(Buffer.from(await servedPart.arrayBuffer()).equals(movie.subarray(1000)));
  assert.equal((await withAck(dj1, "watch", { op: "start", query: "https://clips.twitch.tv/AlgumClipe" })).error, "Clipe da Twitch não dá para assistir junto: use o link do vídeo ou do canal.");
  assert.equal((await withAck(dj1, "watch", { op: "start", query: "um filme bom" })).error, "Não achei esse vídeo. Cole o link do YouTube ou da Twitch (ou escolha um vídeo do aparelho).");
  const watchEnded = await withAck(dj2, "watch", { op: "ended", uid: local.state.now.uid });
  assert.equal(watchEnded.state.playing, false);
  // Trocou de vídeo: o arquivo sai do servidor.
  await withAck(dj2, "watch", { op: "start", query: "twitch.tv/Gaules" });
  assert.equal((await fetch(`${baseUrl}/${local.state.now.url}`)).status, 404);
  // Netflix e HBO Max: cada um assiste na própria conta; a sala guarda o segundo, faz a contagem e ouve a extensão.
  const netflix = await withAck(dj1, "watch", { op: "start", query: "Stranger Things", service: "netflix" });
  assert.deepEqual([netflix.state.now.source, netflix.state.now.title, netflix.state.now.url], ["netflix", "Stranger Things", "https://www.netflix.com/search?q=Stranger%20Things"]);
  const counting = await withAck(dj2, "watch", { op: "countdown" });
  assert.ok(counting.action.at >= counting.state.serverNow + 3000, "a contagem começa no futuro");
  const reported = await withAck(dj2, "watch", { op: "pause", position: 754.2, duration: 3200 });
  assert.deepEqual([reported.state.playing, reported.state.position, reported.state.now.duration], [false, 754.2, 3200]);
  const hbo = await withAck(dj1, "watch", { op: "start", query: "https://play.max.com/video/watch/abc-1/def-2" });
  assert.deepEqual([hbo.state.now.source, hbo.state.now.url], ["max", "https://play.max.com/video/watch/abc-1/def-2"]);
  assert.equal((await withAck(dj1, "watch", { op: "start", query: "https://www.netflix.com/br/watch/81231974?t=1" })).state.now.url, "https://www.netflix.com/watch/81231974");
  assert.deepEqual((await withAck(dj1, "watch", { op: "stop" })).state.now, null);
  // Catálogo: buscar não mexe na sala (sem internet nos testes, volta vazio); quem está escolhendo aparece para os dois.
  assert.deepEqual(await withAck(dj1, "watch", { op: "search", shelf: "alta" }), { ok: true, results: [] });
  const browseSeen = until(dj2, "watch", (payload) => payload.action.op === "browse");
  const browsing = await withAck(dj1, "watch", { op: "browse", service: "netflix" });
  assert.equal(browsing.state.browsing["Pessoa 1"].service, "netflix");
  assert.equal((await browseSeen).state.browsing["Pessoa 1"].service, "netflix");
  // Os dois escolhendo ao mesmo tempo: um não apaga o do outro; voltar tira só o seu.
  assert.deepEqual(Object.keys((await withAck(dj2, "watch", { op: "browse", service: "youtube" })).state.browsing).sort(), ["Pessoa 1", "Pessoa 2"]);
  assert.deepEqual(Object.keys((await withAck(dj2, "watch", { op: "browse", service: "" })).state.browsing), ["Pessoa 1"]);
  // A extensão viu o play num episódio: a sala começa com o nome e o segundo de lá; o mesmo episódio de novo não reinicia.
  const picked = await withAck(dj1, "watch", { op: "start", query: "https://www.netflix.com/watch/80057281", service: "netflix", title: "Stranger Things · T1:E1", position: 12.5 });
  assert.deepEqual([picked.state.now.title, picked.state.now.url, picked.state.position, picked.state.browsing], ["Stranger Things · T1:E1", "https://www.netflix.com/watch/80057281", 12.5, null]);
  const pickedAgain = await withAck(dj2, "watch", { op: "start", query: "https://www.netflix.com/watch/80057281", service: "netflix", title: "Stranger Things" });
  assert.deepEqual([pickedAgain.action.op, pickedAgain.state.now.uid], ["same", picked.state.now.uid]);
  // Do catálogo do YouTube: vem com nome, canal e duração; id inválido não passa.
  const fromCatalog = await withAck(dj2, "watch", { op: "start", video: { id: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", channel: "Rick Astley", duration: 213 } });
  assert.deepEqual([fromCatalog.state.now.source, fromCatalog.state.now.title, fromCatalog.state.now.channel, fromCatalog.state.now.duration], ["youtube", "Never Gonna Give You Up", "Rick Astley", 213]);
  assert.equal((await withAck(dj2, "watch", { op: "start", video: { id: "nope" } })).error, "Vídeo inválido.");
  // "Vistos por vocês": o mais novo primeiro, sem repetir e sem o vídeo do aparelho; fechar o vídeo não apaga.
  const recent = (await withAck(dj1, "watch", { op: "stop" })).state.recent.map((entry) => entry.key);
  assert.deepEqual(recent, ["youtube:dQw4w9WgXcQ", "netflix:https://www.netflix.com/watch/80057281", "netflix:https://www.netflix.com/watch/81231974", "max:https://play.max.com/video/watch/abc-1/def-2", "twitch:gaules", "twitch:123456789", "youtube:aqz-KE-bpKQ"]);
  await withAck(dj1, "music", { op: "stop" });

  // O cartão do bot não conta como mensagem no perfil.
  const statsBefore = (await withAck(dj1, "stats")).messages;
  await withAck(dj1, "music", { op: "play", query: "https://youtu.be/dQw4w9WgXcQ" });
  assert.equal((await withAck(dj1, "stats")).messages, statsBefore);
  await withAck(dj1, "music", { op: "stop" });
  // Perfil da outra pessoa: os números dela; um nome que não é do chat devolve os seus.
  assert.deepEqual(await withAck(dj1, "stats", { name: "Pessoa 2" }), await withAck(dj2, "stats"));
  assert.deepEqual(await withAck(dj1, "stats", { name: "Intrusa" }), await withAck(dj1, "stats"));

  // Mensagem de voz. O áudio gravado no navegador vem em MP4 com marca de vídeo (Chrome, Safari) ou em WebM
  // (Chrome, Firefox): o servidor vê pelas faixas que é só som. Os arquivos abaixo têm só o que a detecção lê.
  const box = (type, data) => Buffer.concat([Buffer.from([0, 0, 0, 8 + data.length]), Buffer.from(type), data]);
  const mp4 = (...handlers) => Buffer.concat([box("ftyp", Buffer.from("isom\0\0\x02\0isomiso2mp41", "latin1")), ...handlers.map((handler) => box("hdlr", Buffer.concat([Buffer.alloc(8), Buffer.from(handler), Buffer.alloc(13)])))]);
  const webm = (...codecs) => Buffer.concat([Buffer.from("1a45dfa3", "hex"), Buffer.alloc(8), ...codecs.map((codec) => Buffer.concat([Buffer.from([0x86, 0x80 | codec.length]), Buffer.from(codec)])), Buffer.from("1f43b675", "hex"), Buffer.alloc(64)]);
  for (const [name, data, kind, type] of [
    ["Áudio.m4a", mp4("soun"), "audio", "audio/mp4"],
    ["video.mp4", mp4("vide", "soun"), "video", "video/mp4"],
    ["Áudio.webm", webm("A_OPUS"), "audio", "audio/webm"],
    ["video.webm", webm("V_VP8", "A_OPUS"), "video", "video/webm"]
  ]) {
    const { file } = (await upload(firstLogin.body.token, name, data)).body;
    assert.deepEqual([file.kind, file.type], [kind, type], name);
  }
  // A mensagem leva a duração e a forma de onda (de 0 a 100) para o player; a outra pessoa recebe igual.
  const voiceUp = await upload(firstLogin.body.token, "Áudio 2026-10-19 14.03.12.m4a", mp4("soun"), "audio/mp4;codecs=mp4a.40.2");
  const voiceSeen = until(dj2, "message", (message) => message.clientId === "cliente-voz");
  const voiceSent = await withAck(dj1, "message", { file: voiceUp.body.file.key, voice: { duration: 75.94, peaks: [0, 50.6, 140, -3, "x", 100] }, clientId: "cliente-voz" });
  assert.deepEqual(voiceSent.message.file.voice, { duration: 75.9, peaks: [0, 50, 100, 0, 0, 100] });
  assert.equal(voiceSent.message.file.kind, "audio");
  assert.deepEqual((await voiceSeen).file, voiceSent.message.file);
  assert.equal((await fetch(`${baseUrl}/${voiceSent.message.file.url}`)).headers.get("content-type"), "audio/mp4");
  assert.equal((await withAck(dj2, "message", { text: "Que voz linda", clientId: "cliente-voz-resposta", replyTo: voiceSent.message.id })).message.replyTo.text, "Mensagem de voz (1:15)");
  // Quem abre o chat depois recebe a voz no histórico.
  const reopened = await connect(secondLogin.body.token);
  assert.deepEqual(reopened.history.items.find((message) => message.id === voiceSent.message.id).file.voice, voiceSent.message.file.voice);
  reopened.disconnect();
  // Forma de onda comprida demais é cortada; voz inválida, ou num arquivo que não toca, vira um anexo comum.
  const longVoice = await upload(firstLogin.body.token, "longo.webm", webm("A_OPUS"));
  assert.equal((await withAck(dj1, "message", { file: longVoice.body.file.key, voice: { duration: 3, peaks: Array(200).fill(50) }, clientId: "cliente-voz-longa" })).message.file.voice.peaks.length, 64);
  for (const [index, [data, voice]] of [
    [webm("A_OPUS"), { duration: 0, peaks: [] }],
    [webm("A_OPUS"), { duration: 4000, peaks: [] }],
    [webm("A_OPUS"), { duration: 5, peaks: "barras" }],
    [webm("A_OPUS"), "voz"],
    [Buffer.from("só texto"), { duration: 3, peaks: [10] }]
  ].entries()) {
    const up = await upload(firstLogin.body.token, "anexo.bin", data);
    const sentPlain = await withAck(dj1, "message", { file: up.body.file.key, voice, clientId: `cliente-voz-ruim-${index}` });
    assert.equal(sentPlain.ok, true);
    assert.equal("voice" in sentPlain.message.file, false, `voz ruim ${index}`);
  }
  // Transcrição: o servidor manda o áudio ao serviço do config.php e o texto fica na mensagem, para os dois.
  assert.equal(dj1.history.transcribe, true);
  const transcribe = (token, id) => api("transcribe", { token, id });
  const transcribedSeen = until(dj2, "message:update", (message) => message.id === voiceSent.message.id && message.file?.voice?.text !== undefined);
  const transcribed = await transcribe(secondLogin.body.token, voiceSent.message.id);
  assert.deepEqual(transcribed.body, { ok: true, text: "Oi, tudo bem? Chego às oito." });
  assert.equal((await transcribedSeen).file.voice.text, "Oi, tudo bem? Chego às oito.");
  const sentToService = transcriber.calls[0];
  assert.equal(sentToService.headers.authorization, "Bearer chave-de-transcricao");
  assert.match(sentToService.headers["content-type"], /^multipart\/form-data; boundary=/);
  const form = sentToService.body.toString("latin1");
  assert.match(form, /name="model"\r\n\r\nmodelo-de-teste\r\n/);
  assert.match(form, /name="language"\r\n\r\npt\r\n/);
  assert.match(form, /name="file"; filename="audio\.m4a"\r\nContent-Type: audio\/mp4\r\n\r\n/);
  assert.ok(sentToService.body.includes(mp4("soun")), "o áudio vai inteiro");
  // Pedir de novo devolve o que já foi feito, sem chamar o serviço; quem abre o chat depois já recebe o texto.
  assert.equal((await transcribe(firstLogin.body.token, voiceSent.message.id)).body.text, "Oi, tudo bem? Chego às oito.");
  assert.equal(transcriber.calls.length, 1);
  const reopenedAgain = await connect(firstLogin.body.token);
  assert.equal(reopenedAgain.history.items.find((message) => message.id === voiceSent.message.id).file.voice.text, "Oi, tudo bem? Chego às oito.");
  reopenedAgain.disconnect();
  // A pesquisa acha o que foi dito no áudio transcrito (sem acento), mas não o nome do arquivo gravado.
  assert.deepEqual((await withAck(dj1, "search", { query: "chego as OITO" })).items.map((item) => item.id), [voiceSent.message.id]);
  assert.deepEqual((await withAck(dj1, "search", { query: "14.03.12" })).items, []);
  // Só mensagem de voz; sessão vale; o erro do serviço chega explicado.
  assert.equal((await transcribe(firstLogin.body.token, (await withAck(dj1, "message", { text: "texto", clientId: "cliente-texto-transcricao" })).message.id)).body.error, "Só dá para transcrever mensagens de voz.");
  assert.equal((await transcribe("sessao-falsa", voiceSent.message.id)).status, 401);
  transcriber.status = 401;
  const otherVoice = await upload(firstLogin.body.token, "outro.webm", webm("A_OPUS"));
  const otherSent = await withAck(dj1, "message", { file: otherVoice.body.file.key, voice: { duration: 2, peaks: [5] }, clientId: "cliente-voz-sem-chave" });
  assert.equal((await transcribe(firstLogin.body.token, otherSent.message.id)).body.error, "O serviço de transcrição não aceitou a chave do config.php.");
  assert.equal("text" in sql(`SELECT media FROM {p}messages WHERE id = '${otherSent.message.id}'`).map((row) => JSON.parse(row.media).file.voice)[0], false);
  // Gravando: a outra pessoa vê "gravando um áudio".
  const recording = next(dj2, "typing");
  dj1.emit("typing", "audio");
  assert.deepEqual(await recording, { name: "Pessoa 1", active: true, audio: true, room: dj1.history.room });
  dj1.disconnect();
  dj2.disconnect();

  // Nosso cantinho e joguinhos (num bloco próprio: os nomes não se misturam com os de cima).
  {
    // ---------- Nosso cantinho ----------
    const us1 = await connect(firstLogin.body.token);
    const us2 = await connect(secondLogin.body.token);
    const us = (socket, data) => withAck(socket, "us", data);
    const day = "2026-10-22";
    const loaded = await us(us1, { op: "load", day });
    assert.equal(loaded.ok, true);
    assert.deepEqual([loaded.events, loaded.goals, loaded.letters], [[], [], []]);
    assert.deepEqual(loaded.habits, { "Pessoa 1": [], "Pessoa 2": [] });
    assert.equal(loaded.prompts.almoco, "13:30");
    assert.equal(loaded.prompts.lanche, null);
    assert.deepEqual(loaded.days["Pessoa 2"], { owner: "Pessoa 2", day, updatedAt: null, wake: null, meals: {}, done: [], mood: null, note: "", moments: [] });
    assert.equal((await us(us1, { op: "day", day: "2026-02-30" })).error, "Dia inválido.");

    // Hábitos da rotina: a outra pessoa vê a lista (para o cartão do dia).
    const habitsSeen = until(us2, "us", (change) => change.kind === "habits");
    const habits = (await us(us1, { op: "habits", habits: [{ text: "  Beber água  " }, { text: "Estudar", id: "<script>" }, { text: "   " }] })).habits;
    assert.deepEqual(habits.map((habit) => habit.text), ["Beber água", "Estudar"]);
    assert.ok(habits.every((habit) => /^[a-z0-9]{6,16}$/.test(habit.id)), "id inválido vira um novo");
    assert.deepEqual((await habitsSeen).habits, habits);

    // O dia: hora em que acordou, refeição com foto (só a foto de quem salva), hábitos feitos e humor.
    const mealPhoto = await upload(firstLogin.body.token, "almoco.png", makePng(32, 24));
    const peerPhoto = await upload(secondLogin.body.token, "dela.png", makePng(16, 16));
    const daySeen = until(us2, "us", (change) => change.kind === "day" && change.meal === "almoco");
    const lunch = await us(us1, { op: "day:save", day, wake: "7:05", meal: { name: "almoco", text: " Lasanha  da vó ", photo: { key: mealPhoto.body.file.key } }, done: [habits[0].id, "inventado"], mood: "amor" });
    assert.equal(lunch.ok, true);
    assert.equal(lunch.item.wake, "07:05");
    assert.equal(lunch.item.meals.almoco.text, "Lasanha da vó");
    assert.deepEqual(lunch.item.meals.almoco.photo, { key: mealPhoto.body.file.key, url: `api.php?action=file&k=${mealPhoto.body.file.key}`, width: 32, height: 24 });
    assert.deepEqual(lunch.item.done, [habits[0].id]);
    assert.equal(lunch.item.mood, "amor");
    assert.equal((await us(us1, { op: "day:save", day, mood: "😀" })).item.mood, null, "humor fora da lista não vale");
    await us(us1, { op: "day:save", day, mood: "amor" });
    assert.deepEqual((await daySeen).item, lunch.item);
    const dayRow = sql(`SELECT id FROM {p}items WHERE kind = 'day' AND owner = 'Pessoa 1' AND day = '${day}'`)[0];
    assert.equal(sql(`SELECT message_id FROM {p}files WHERE file_key = '${mealPhoto.body.file.key}'`)[0].message_id, dayRow.id);
    assert.equal((await us(us2, { op: "day:save", day, meal: { name: "cafe", text: "Pão", photo: mealPhoto.body.file.key } })).item.meals.cafe.photo, undefined);
    assert.equal((await us(us2, { op: "day:save", day, meal: { name: "brunch", text: "x" } })).error, "Refeição desconhecida.");
    // Momentos (fotos com legenda); tirar a foto do almoço apaga o arquivo dela.
    const moment = await us(us1, { op: "day:save", day, moments: [{ photo: { key: peerPhoto.body.file.key }, text: "não é minha" }, { photo: { key: mealPhoto.body.file.key }, text: " Olha o prato " }] });
    assert.deepEqual(moment.item.moments.map((item) => item.text), ["Olha o prato"]);
    const noPhoto = await us(us1, { op: "day:save", day, meal: { name: "almoco", text: "Lasanha da vó" }, moments: [] });
    assert.equal(noPhoto.item.meals.almoco.photo, undefined);
    assert.equal(sql(`SELECT COUNT(*) AS n FROM {p}files WHERE file_key = '${mealPhoto.body.file.key}'`)[0].n, 0);

    // Resposta pela notificação: a hora de acordar sai do texto (ou da hora do aparelho); a refeição guarda o texto.
    const answer = (socket, field, text, clock) => us(socket, { op: "reply", day, field, text, clock });
    assert.equal((await answer(us2, "acordar", "acordei 6 e meia")).item.wake, "06:30");
    assert.equal((await answer(us2, "acordar", "às 8h15")).item.wake, "08:15");
    assert.equal((await answer(us2, "acordar", "agora mesmo", "09:41")).item.wake, "09:41");
    assert.equal((await answer(us2, "acordar", "não sei")).error, "Diga a hora (ex.: 7:30).");
    assert.equal((await answer(us2, "jantar", "Sopinha")).item.meals.jantar.text, "Sopinha");
    assert.equal((await answer(us2, "jantar", "  ")).error, "Conte o que você comeu.");

    // Lembretes: só o primeiro aparelho mostra; o da refeição já respondida não aparece; o da rotina diz o que falta.
    const claim = (socket, key) => us(socket, { op: "claim", key });
    assert.equal((await claim(us1, `${day} almoco`)).fire, false);
    assert.equal((await claim(us1, `${day} jantar`)).fire, true);
    assert.equal((await claim(us1, `${day} jantar`)).fire, false);
    assert.deepEqual(await claim(us1, `${day} rotina`), { ok: true, fire: true, text: "Falta: Estudar" });
    assert.equal((await claim(us2, `${day} rotina`)).fire, false, "sem hábitos, sem lembrete da rotina");
    assert.deepEqual((await answer(us1, "rotina", "")).item.done, habits.map((habit) => habit.id));
    assert.equal((await claim(us1, "ev qualquer 2026-10-22")).fire, true);

    // Agenda: os dois mudam e apagam qualquer compromisso; a outra pessoa fica sabendo.
    assert.equal((await us(us1, { op: "event:save", title: "  ", date: day })).error, "Dê um nome e uma data para o compromisso.");
    const soon = new Date(Date.now() + 40 * 60000);
    const pad = (value) => String(value).padStart(2, "0");
    const soonDate = `${soon.getUTCFullYear()}-${pad(soon.getUTCMonth() + 1)}-${pad(soon.getUTCDate())}`;
    const soonTime = `${pad(soon.getUTCHours())}:${pad(soon.getUTCMinutes())}`;
    const eventSeen = until(us2, "us", (change) => change.kind === "event" && change.created);
    const event = await us(us1, { op: "event:save", title: "Cinema 🍿", date: soonDate, time: soonTime, place: "Shopping", icon: "film", who: "ambos", repeat: "nada", remind: 15 });
    assert.equal(event.ok, true);
    assert.equal(event.item.repeat, "none");
    assert.equal(event.item.icon, "film");
    assert.equal((await us(us1, { op: "event:save", id: event.item.id, title: "Cinema 🍿", date: soonDate, time: soonTime, place: "Shopping", icon: "<b>", remind: 15 })).item.icon, "calendar");
    assert.equal(event.item.end, null);
    const ranged = await us(us1, { op: "event:save", title: "Jantar", date: day, time: "19:00", end: "21:30" });
    assert.deepEqual([ranged.item.time, ranged.item.end], ["19:00", "21:30"]);
    assert.equal((await us(us1, { op: "event:save", id: ranged.item.id, title: "Jantar", date: day, time: "19:00", end: "18:00" })).item.end, null, "termina antes de começar: sem fim");
    assert.equal((await us(us1, { op: "event:save", id: ranged.item.id, title: "Jantar", date: day, end: "21:00" })).item.end, null, "o dia todo: sem fim");
    await us(us1, { op: "event:delete", id: ranged.item.id });
    assert.equal((await eventSeen).item.id, event.item.id);
    const schedule = await us(us2, { op: "schedule", tz: 0 });
    const remind = schedule.items.find((item) => item.kind === "event");
    assert.equal(remind.key, `ev ${event.item.id} ${soonDate}`);
    assert.equal(remind.at, Date.parse(`${soonDate}T${soonTime}:00Z`) - 15 * 60000);
    assert.equal(remind.text, `Daqui a 15 minutos · ${soonTime} · Shopping`);
    assert.ok(schedule.items.some((item) => item.kind === "prompt" && item.field === "almoco"), "lembretes da rotina");
    assert.ok(!schedule.items.some((item) => item.field === "lanche"), "lanche desligado por padrão");
    // Só para quem é o compromisso (ou para os dois).
    const edited = await us(us2, { op: "event:save", id: event.item.id, title: "Cinema", date: soonDate, time: soonTime, who: "Pessoa 1", remind: 15 });
    assert.equal(edited.item.owner, "Pessoa 1");
    assert.ok(!(await us(us2, { op: "schedule", tz: 0 })).items.some((item) => item.kind === "event"));
    assert.equal((await us(us1, { op: "prompts", prompts: { lanche: "16:30", almoco: null, cafe: "25:00" } })).prompts.lanche, "16:30");
    assert.deepEqual((await us(us1, { op: "load" })).prompts, { acordar: "09:30", cafe: null, almoco: null, lanche: "16:30", jantar: "20:30", rotina: "22:00" });
    // (O aviso do "Jantar" apagado lá em cima pode chegar atrasado: espera o do cinema.)
    const eventGone = until(us1, "us", (change) => change.kind === "event" && change.deleted && change.title !== "Jantar");
    assert.equal((await us(us2, { op: "event:delete", id: event.item.id })).ok, true);
    assert.equal((await eventGone).title, "Cinema");
    // Repetições: todo mês (dia 31 cai no último dia dos meses curtos), toda semana e todo ano.
    const occurs = (event, date) => php(`event_on(${phpValue(event)}, '${date}')`);
    assert.equal(occurs({ date: "2026-01-31", repeat: "monthly" }, "2026-02-28"), true);
    assert.equal(occurs({ date: "2026-01-31", repeat: "monthly" }, "2026-03-30"), false);
    assert.equal(occurs({ date: "2026-10-22", repeat: "weekly" }, "2026-10-29"), true);
    assert.equal(occurs({ date: "2026-10-22", repeat: "weekly" }, "2026-10-15"), false);
    assert.equal(occurs({ date: "2024-02-29", repeat: "yearly" }, "2025-02-28"), true);
    assert.equal(occurs({ date: "2026-10-22", repeat: "none" }, "2027-10-22"), false);

    // Sonhos e metas: dinheiro guardado pelos dois (não fica negativo), passos e realizado.
    const goal = await us(us1, { op: "goal:save", title: "Viagem pra praia", icon: "palmtree", target: 1500, steps: [{ text: "Escolher a praia" }, { text: "Reservar" }] });
    assert.equal(goal.item.target, 1500);
    assert.equal(goal.item.icon, "palmtree");
    assert.equal(goal.item.saved, 0);
    const depositSeen = until(us1, "us", (change) => change.kind === "goal" && change.action === "deposit");
    assert.equal((await us(us2, { op: "goal:deposit", id: goal.item.id, amount: 250.555 })).item.saved, 250.56);
    assert.equal((await depositSeen).amount, 250.56);
    const withdrawn = await us(us1, { op: "goal:deposit", id: goal.item.id, amount: -1000 });
    assert.equal(withdrawn.item.saved, 0);
    assert.deepEqual(withdrawn.item.deposits.map((deposit) => [deposit.by, deposit.amount]), [["Pessoa 1", -250.56], ["Pessoa 2", 250.56]]);
    assert.equal((await us(us1, { op: "goal:deposit", id: goal.item.id, amount: "muito" })).error, "Diga quanto.");
    assert.equal((await us(us1, { op: "goal:step", id: goal.item.id, step: goal.item.steps[0].id, done: true })).item.steps[0].done, true);
    const kept = await us(us2, { op: "goal:save", id: goal.item.id, title: "Viagem pra praia ☀️", steps: goal.item.steps, target: 0 });
    assert.equal(kept.item.target, null);
    assert.deepEqual(kept.item.deposits.length, 2, "editar não apaga o que foi guardado");
    const done = await us(us2, { op: "goal:done", id: goal.item.id, done: true });
    assert.equal(done.item.done, true);
    assert.ok(done.item.doneAt);

    // Cartinhas: na lista vai só o começo; a primeira vez que a outra pessoa abre, ela fica lida. Só quem escreveu muda.
    assert.equal((await us(us1, { op: "letter:save", title: "Oi", body: "   " })).error, "Escreva alguma coisa na cartinha.");
    const letterSeen = until(us2, "us", (change) => change.kind === "letter" && change.action === "new");
    const body = `Meu amor,\n\n\n\n\n${"você é tudo ".repeat(30)}`;
    const letter = await us(us1, { op: "letter:save", title: "  Pra você  ", body, paper: "rosa" });
    assert.equal(letter.item.body, `Meu amor,\n\n\n${"você é tudo ".repeat(30).trim()}`);
    assert.equal(letter.item.to, "Pessoa 2");
    const listed = (await letterSeen).item;
    assert.equal(listed.title, "Pra você");
    assert.equal(listed.body, undefined);
    assert.equal(listed.preview.length, 140);
    assert.equal(listed.readAt, null);
    assert.equal((await us(us1, { op: "letter:open", id: letter.item.id })).item.readAt, null, "quem escreveu não marca como lida");
    const readSeen = until(us1, "us", (change) => change.kind === "letter" && change.action === "read");
    const opened = await us(us2, { op: "letter:open", id: letter.item.id });
    assert.equal(opened.item.body, letter.item.body);
    assert.ok(opened.item.readAt);
    assert.equal((await readSeen).item.readAt, opened.item.readAt);
    assert.equal((await us(us2, { op: "letter:save", id: letter.item.id, body: "mudei" })).error, "Só quem escreveu muda a cartinha.");
    assert.equal((await us(us2, { op: "letter:delete", id: letter.item.id })).error, "Só quem escreveu apaga a cartinha.");
    const all = await us(us2, { op: "load" });
    assert.deepEqual([all.events.length, all.goals.length, all.letters.length], [0, 1, 1]);
    assert.equal(all.letters[0].body, undefined);
    assert.deepEqual(all.habits["Pessoa 1"], habits);
    assert.equal((await us(us1, { op: "letter:delete", id: letter.item.id })).ok, true);
    // Fotos, áudios e letra: só arquivos de quem escreve (foto que é foto, áudio que toca); pode ir sem texto.
    const letterPhoto = (await upload(firstLogin.body.token, "nos.png", makePng(4, 3))).body.file;
    const letterSong = (await upload(firstLogin.body.token, "Nossa música.m4a", mp4("soun"))).body.file;
    const letterVoice = (await upload(firstLogin.body.token, "voz.webm", webm("A_OPUS"))).body.file;
    const peerLetterPhoto = (await upload(secondLogin.body.token, "dela.png", makePng(2, 2))).body.file;
    const plainFile = (await upload(firstLogin.body.token, "nota.txt", Buffer.from("só texto"))).body.file;
    const richSeen = until(us2, "us", (change) => change.kind === "letter" && change.action === "new");
    const rich = await us(us1, {
      op: "letter:save", title: "Com fotos", body: "", paper: "azul", font: "mao",
      photos: [{ key: letterPhoto.key }, { key: peerLetterPhoto.key }, { key: letterSong.key }],
      audios: [{ key: letterPhoto.key, duration: 3, peaks: [] }, { key: letterSong.key, duration: 61.26, peaks: [10, 200, -1] }, { key: letterVoice.key, duration: 4, peaks: [50], voice: true }]
    });
    assert.equal(rich.ok, true, JSON.stringify(rich));
    assert.deepEqual([rich.item.font, rich.item.paper, rich.item.body], ["mao", "azul", ""]);
    assert.deepEqual(rich.item.photos.map((photo) => [photo.key, photo.width, photo.height]), [[letterPhoto.key, 4, 3]]);
    assert.deepEqual(rich.item.audios.map(({ key, name, voice, duration, peaks }) => [key, name, voice, duration, peaks]), [[letterSong.key, "Nossa música.m4a", false, 61.3, [10, 100, 0]], [letterVoice.key, "Mensagem de voz", true, 4, [50]]]);
    // Na lista (sem o texto) as fotos e os áudios já vão, para o cartão contar e a carta abrir com eles.
    const richListed = (await richSeen).item;
    assert.deepEqual([richListed.photos.length, richListed.audios.length, richListed.font], [1, 2, "mao"]);
    assert.equal((await fetch(`${baseUrl}/${rich.item.audios[1].url}`)).headers.get("content-type"), "audio/webm");
    // Editar: letra desconhecida volta para a clássica; o que saiu da cartinha é apagado do banco.
    const trimmed = await us(us1, { op: "letter:save", id: rich.item.id, title: "Com fotos", body: "Agora com texto", font: "comic", photos: [], audios: [{ key: plainFile.key, duration: 3, peaks: [] }, { key: letterVoice.key, duration: 0, peaks: [] }, { key: letterVoice.key, duration: 4, peaks: [50], voice: true }] });
    assert.deepEqual([trimmed.item.font, trimmed.item.photos, trimmed.item.audios.length], ["classica", [], 1]);
    assert.deepEqual(sql(`SELECT file_key FROM {p}files WHERE message_id = '${rich.item.id}'`).map((row) => row.file_key), [letterVoice.key]);
    // A outra pessoa não consegue usar os arquivos da cartinha numa dela.
    const stolen = await us(us2, { op: "letter:save", title: "Minha", body: "oi", audios: [{ key: letterVoice.key, duration: 4, peaks: [50] }], photos: [{ key: letterPhoto.key }] });
    assert.deepEqual([stolen.item.audios, stolen.item.photos], [[], []]);
    await us(us2, { op: "letter:delete", id: stolen.item.id });
    assert.equal((await us(us1, { op: "letter:delete", id: rich.item.id })).ok, true);
    assert.equal(sql(`SELECT COUNT(*) AS total FROM {p}files WHERE message_id = '${rich.item.id}'`)[0].total, 0);
    assert.equal((await us(us1, { op: "nada" })).error, "Ação desconhecida.");

    // ---------- Joguinhos ----------
    const game = (socket, data) => withAck(socket, "game", data);
    // Isso ou aquilo: o voto de cada um fica escondido até os dois votarem.
    const gameSeen = until(us2, "message", (message) => Boolean(message.game));
    const pair = await game(us1, { op: "new", type: "isso" });
    assert.equal(pair.message.game.type, "isso");
    assert.equal(pair.message.game.options.length, 2);
    assert.deepEqual([pair.message.game.votes, pair.message.game.players, pair.message.game.done], [{}, [], false]);
    assert.equal((await gameSeen).id, pair.message.id);
    const halfSeen = until(us2, "message:update", (message) => message.id === pair.message.id);
    const half = await game(us1, { op: "vote", id: pair.message.id, value: 0 });
    assert.equal(half.mine, 0);
    assert.deepEqual([half.message.game.votes, half.message.game.players], [{}, ["Pessoa 1"]]);
    assert.deepEqual((await halfSeen).game.votes, {}, "a outra pessoa não vê o voto antes de votar");
    assert.equal((await game(us1, { op: "vote", id: pair.message.id, value: 1 })).error, "Você já votou.");
    assert.equal((await game(us2, { op: "vote", id: pair.message.id, value: 2 })).error, "Voto inválido.");
    const both = await game(us2, { op: "vote", id: pair.message.id, value: 1 });
    assert.deepEqual([both.message.game.votes, both.message.game.done], [{ "Pessoa 1": 0, "Pessoa 2": 1 }, true]);
    // Quem é mais provável: vota num dos dois.
    const likely = await game(us2, { op: "new", type: "quem" });
    assert.match(likely.message.game.prompt, /^Quem é mais provável/);
    assert.deepEqual(likely.message.game.names, ["Pessoa 2", "Pessoa 1"]);
    assert.equal((await game(us1, { op: "vote", id: likely.message.id, value: "Intrusa" })).error, "Voto inválido.");
    assert.equal((await game(us1, { op: "vote", id: likely.message.id, value: "Pessoa 2" })).ok, true);
    // Verdade ou desafio: só a outra pessoa escolhe, e a carta aparece depois da escolha.
    const vd = await game(us1, { op: "new", type: "vd" });
    assert.deepEqual([vd.message.game.for, vd.message.game.prompt], ["Pessoa 2", null]);
    assert.equal((await game(us1, { op: "pick", id: vd.message.id, choice: "verdade" })).error, "Quem escolhe é Pessoa 2.");
    const picked = await game(us2, { op: "pick", id: vd.message.id, choice: "desafio" });
    assert.equal(picked.message.game.choice, "desafio");
    assert.ok(picked.message.game.prompt.length > 5);
    assert.equal((await game(us2, { op: "pick", id: vd.message.id, choice: "verdade" })).message.game.choice, "desafio", "a escolha não muda");
    // Perguntinha: as respostas aparecem quando os dois responderem.
    const question = await game(us1, { op: "new", type: "pergunta" });
    assert.equal((await game(us1, { op: "answer", id: question.message.id, text: "  " })).error, "Escreva sua resposta.");
    assert.deepEqual((await game(us1, { op: "answer", id: question.message.id, text: "A praia" })).message.game.answers, {});
    assert.deepEqual((await game(us2, { op: "answer", id: question.message.id, text: "O sofá 🛋️" })).message.game.answers, { "Pessoa 1": "A praia", "Pessoa 2": "O sofá 🛋️" });
    assert.equal((await game(us1, { op: "new", type: "xadrez" })).error, "Jogo desconhecido.");

    // Jogo da velha: cada um na sua vez, casa ocupada não vale, e a linha da vitória vem junto.
    const tic = await game(us1, { op: "new", type: "velha" });
    assert.deepEqual([tic.message.game.seats, tic.message.game.turn], [["Pessoa 1", "Pessoa 2"], "Pessoa 1"]);
    const mark = (socket, cell) => game(socket, { op: "move", id: tic.message.id, cell });
    assert.equal((await mark(us2, 0)).error, "Não é a sua vez.");
    await mark(us1, 0);
    assert.equal((await mark(us2, 0)).error, "Essa casa já foi.");
    await mark(us2, 3);
    await mark(us1, 1);
    await mark(us2, 4);
    const won = await mark(us1, 2);
    assert.deepEqual([won.message.game.winner, won.message.game.line, won.message.game.board.join("")], ["Pessoa 1", [0, 1, 2], "XXXOO"]);
    assert.equal((await mark(us2, 5)).error, "Esse jogo já acabou.");

    // Dama: quem começa fica com as brancas; o servidor diz as jogadas que valem e obriga a captura.
    const checkers = await game(us2, { op: "new", type: "dama" });
    const start = checkers.message.game;
    assert.deepEqual([start.board.filter((piece) => piece === "w").length, start.board.filter((piece) => piece === "b").length, start.turn], [12, 12, "Pessoa 2"]);
    assert.equal(start.moves.length, 7);
    const move = (socket, from, to) => game(socket, { op: "move", id: checkers.message.id, from, to });
    assert.equal((await move(us2, 44, 36)).error, "Essa jogada não vale.");
    await move(us2, 44, 35);
    await move(us1, 21, 28);
    assert.equal((await move(us2, 42, 33)).error, "Captura obrigatória: tem peça para comer!");
    const captured = await move(us2, 35, 21);
    assert.deepEqual([captured.message.game.board[28], captured.message.game.board[21], captured.message.game.turn], ["", "w", "Pessoa 1"]);
    // A jogada diz o que foi comido e o número dela (o navegador anima só a jogada nova).
    assert.deepEqual([captured.message.game.taken, captured.message.game.ply, captured.message.game.last], [{ at: 28, piece: "b" }, 3, [35, 21]]);
    assert.ok(captured.message.game.moves.every(([, , over]) => over === undefined) && captured.message.game.moves.length === 2, "as pretas também têm que comer");
    const resigned = await game(us1, { op: "resign", id: checkers.message.id });
    assert.deepEqual([resigned.message.game.winner, resigned.message.game.resigned], ["Pessoa 2", "Pessoa 1"]);
    // A mesinha pode perguntar como uma partida está (a aberta que não veio com o histórico).
    assert.equal((await game(us1, { op: "get", id: checkers.message.id })).message.game.winner, "Pessoa 2");
    assert.equal((await game(us1, { op: "get", id: "nao-existe" })).error, "Esse jogo não existe mais.");
    // Regras direto no lib/potato.php: pedra anda e come só para a frente; dama anda e come de longe, para todos os lados.
    const board = (pieces) => { const squares = Array(64).fill(""); for (const [index, piece] of Object.entries(pieces)) squares[index] = piece; return squares; };
    const moves = (pieces, color, chain = null) => php(`dama_moves(${phpValue(board(pieces))}, '${color}', ${chain ?? "null"})`);
    assert.deepEqual(moves({ 27: "w", 36: "b" }, "w"), [[27, 18, null], [27, 20, null]], "branca não come para trás");
    assert.deepEqual(moves({ 36: "w", 27: "b" }, "w"), [[36, 18, 27]]);
    assert.deepEqual(moves({ 27: "b", 18: "w" }, "b"), [[27, 34, null], [27, 36, null]], "preta não come para trás");
    assert.deepEqual(moves({ 27: "b", 36: "w" }, "b"), [[27, 45, 36]]);
    assert.deepEqual(moves({ 8: "W", 17: "b" }, "w"), [[8, 26, 17], [8, 35, 17], [8, 44, 17], [8, 53, 17], [8, 62, 17]], "a dama come para trás");
    assert.equal(moves({ 56: "W" }, "w").length, 7);
    assert.deepEqual(moves({ 56: "W", 35: "b" }, "w"), [[56, 28, 35], [56, 21, 35], [56, 14, 35], [56, 7, 35]]);
    assert.deepEqual(moves({ 45: "w", 36: "b", 40: "w" }, "w", 40), []);

    // Memória: as cartas fechadas nunca chegam ao navegador; acertou, joga de novo; errou, passa a vez.
    const memory = await game(us1, { op: "new", type: "memoria" });
    assert.deepEqual(memory.message.game.cards, Array(16).fill(null));
    assert.equal(memory.message.game.faces, undefined);
    const faces = JSON.parse(sql(`SELECT media FROM {p}messages WHERE id = '${memory.message.id}'`)[0].media).game.faces;
    const flip = (socket, index) => game(socket, { op: "flip", id: memory.message.id, index });
    const pairOf = faces.findIndex((face, index) => index > 0 && face === faces[0]);
    const firstCard = await flip(us1, 0);
    assert.deepEqual([firstCard.message.game.cards.filter(Boolean), firstCard.message.game.turn], [[faces[0]], "Pessoa 1"]);
    assert.equal((await flip(us1, 0)).error, "Escolha outra carta.");
    const pairFound = await flip(us1, pairOf);
    assert.deepEqual([pairFound.message.game.scores["Pessoa 1"], pairFound.message.game.turn, pairFound.message.game.matched[0]], [1, "Pessoa 1", "Pessoa 1"]);
    const others = faces.map((face, index) => index).filter((index) => index !== 0 && index !== pairOf);
    const missA = others[0];
    const missB = others.find((index) => faces[index] !== faces[missA]);
    const missed = await flip(us1, missA).then(() => flip(us1, missB));
    assert.deepEqual([missed.message.game.missed, missed.message.game.turn], [[missA, missB], "Pessoa 2"]);
    assert.equal(missed.message.game.cards.filter(Boolean).length, 4, "o par errado fica à mostra até a próxima carta");
    assert.equal((await flip(us1, others[2])).error, "Não é a sua vez.");
    assert.equal((await flip(us2, missA)).message.game.cards.filter(Boolean).length, 3);

    // Stop: ninguém vê as respostas do outro antes do STOP; só pede STOP quem preencheu tudo; a rodada vale pontos.
    const stop = await game(us1, { op: "new", type: "stop" });
    const { letter: stopLetter, categories } = stop.message.game;
    assert.match(stopLetter, /^[A-Z]$/);
    assert.deepEqual(categories, ["Nome", "Animal", "Comida", "Lugar", "Objeto", "Coisa fofa"]);
    const fill = (socket, answers, extra = {}) => game(socket, { op: "fill", id: stop.message.id, answers, ...extra });
    const word = (suffix) => `${stopLetter}${suffix}`;
    const partial = await fill(us2, { Nome: word("ana"), Animal: "  " });
    assert.deepEqual([partial.message.game.filled, partial.message.game.fills], [{ "Pessoa 2": 1 }, undefined]);
    await fill(us2, { Nome: word("ana"), Animal: word("gato"), Comida: "xis", Lugar: word("rio"), Objeto: word("copo"), "Coisa fofa": word("beijo") });
    assert.equal((await fill(us1, { Nome: word("ana") }, { stop: true })).error, "Preencha tudo antes de pedir STOP!");
    const stopped = await fill(us1, { Nome: word("ana"), Animal: word("leão"), Comida: word("bolo"), Lugar: word("casa"), Objeto: word("lápis"), "Coisa fofa": word("abraço") }, { stop: true });
    const round = stopped.message.game;
    assert.equal(round.phase, "review");
    assert.equal(round.last.stoppedBy, "Pessoa 1");
    assert.equal(round.last.answers["Pessoa 2"].Comida, "xis");
    assert.deepEqual([round.last.points["Pessoa 1"].Nome, round.last.points["Pessoa 1"].Animal, round.last.points["Pessoa 2"].Comida], [5, 10, 0]);
    assert.deepEqual(round.totals, { "Pessoa 1": 55, "Pessoa 2": 45 });
    assert.equal((await fill(us2, { Nome: "x" })).error, "Essa rodada já acabou.");
    const second = await game(us2, { op: "next", id: stop.message.id });
    assert.deepEqual([second.message.game.round, second.message.game.phase, second.message.game.filled], [2, "playing", {}]);
    assert.notEqual(second.message.game.letter, stopLetter);
    assert.equal((await game(us1, { op: "end", id: stop.message.id })).message.game.winner, "Pessoa 1");
    // Placar: as partidas de tabuleiro que acabaram (a memória ainda não acabou), por jogo.
    assert.deepEqual((await game(us2, { op: "score" })).score, { velha: { wins: { "Pessoa 1": 1 }, ties: 0 }, dama: { wins: { "Pessoa 2": 1 }, ties: 0 }, stop: { wins: { "Pessoa 1": 1 }, ties: 0 } });
    // Responder a uma carta cita o nome do jogo; o jogo não conta como mensagem no perfil; o histórico vem escondido.
    assert.equal((await withAck(us2, "message", { text: "Eu!", clientId: "cliente-jogo", replyTo: likely.message.id })).message.replyTo.text, "Quem é mais provável?");
    const reopenedGames = await connect(secondLogin.body.token);
    // As partidas que ainda estão rolando vêm com o histórico (mesmo antigas); as que acabaram, não.
    const openIds = reopenedGames.history.games.map((message) => message.id);
    assert.ok(openIds.includes(memory.message.id), "a memória ainda está rolando");
    assert.ok(!openIds.includes(checkers.message.id), "a dama já acabou");
    assert.ok(reopenedGames.history.games.every((message) => !message.game.winner));
    const likelyAgain = reopenedGames.history.items.find((message) => message.id === likely.message.id);
    assert.deepEqual([likelyAgain.game.votes, likelyAgain.game.players], [{}, ["Pessoa 1"]]);
    reopenedGames.disconnect();
    const before = (await withAck(us1, "stats", null)).messages;
    await game(us1, { op: "new", type: "isso" });
    assert.equal((await withAck(us1, "stats", null)).messages, before);
    us1.disconnect();
    us2.disconnect();
  }

  // Chamadas (estilo Discord): tocam mesmo com a outra pessoa offline, o primeiro aparelho que atende entra (a oferta vai
  // só para ele) e a conversa guarda como a chamada ficou.
  {
    const caller = await connect(firstLogin.body.token);
    const opened = await withAck(caller, "call", { op: "start", media: "audio", state: { mic: true } });
    assert.deepEqual([opened.ok, opened.online], [true, false]);
    assert.deepEqual([opened.call.caller, opened.call.callee, opened.call.media, opened.call.answered, opened.call.from], ["Pessoa 1", "Pessoa 2", "audio", false, caller.id]);
    assert.equal(opened.call.ringUntil - opened.call.startedAt, 60000);
    assert.equal((await withAck(caller, "call", { op: "start", media: "video" })).error, "Você já está ligando de outro aparelho.");

    // Quem abre o chat depois vê a chamada tocando (e a mensagem dela na conversa).
    const phone = await connect(secondLogin.body.token);
    const laptop = await connect(secondLogin.body.token);
    assert.deepEqual(phone.history.calls.map((item) => [item.id, item.room]), [[opened.call.id, phone.history.room]]);
    const logged = phone.history.items.find((item) => item.call?.id === opened.call.id);
    assert.deepEqual([logged.source, logged.sender, logged.call.status, logged.call.result], ["call", "Pessoa 1", "ringing", null]);
    assert.equal((await withAck(caller, "call", { op: "accept", id: opened.call.id })).error, "Essa chamada não é para você.");
    assert.equal((await withAck(phone, "call", { op: "start", media: "audio" })).error, "Pessoa 1 já está te ligando.");

    // O primeiro aparelho que atende entra; o outro para de tocar.
    const accepted = next(caller, "call-accepted");
    const handled = next(laptop, "call-handled");
    const live = until(caller, "message:update", (item) => item.call?.status === "live");
    assert.equal((await withAck(phone, "call", { op: "accept", id: opened.call.id, state: { mic: false } })).ok, true);
    const answer = await accepted;
    assert.deepEqual([answer.from, answer.state.mic], [phone.id, false]);
    assert.equal((await handled).id, opened.call.id);
    await live;
    assert.equal((await withAck(laptop, "call", { op: "accept", id: opened.call.id })).error, "Você já atendeu em outro aparelho.");
    assert.equal((await withAck(caller, "call", { op: "start", media: "audio" })).error, "Já tem uma chamada acontecendo.");
    const offer = next(phone, "webrtc-offer");
    const notLaptop = silent(laptop, "webrtc-offer", 1500);
    caller.emit("webrtc-offer", { id: opened.call.id, to: phone.id, description: { type: "offer", sdp: "x" }, media: "audio" });
    assert.deepEqual([(await offer).from, (await offer).id], [caller.id, opened.call.id]);
    await notLaptop;
    const restart = next(phone, "webrtc-restart");
    const noOtherDevice = silent(laptop, "webrtc-restart", 1500);
    caller.emit("webrtc-restart", { id: opened.call.id, to: phone.id, kind: "request" });
    assert.deepEqual([(await restart).from, opened.call.id], [caller.id, opened.call.id]);
    await noOtherDevice;
    // O timeout normal de presença não encerra a chamada durante uma troca de rede.
    sql(`UPDATE {p}clients SET ping = ${Date.now() - 70000} WHERE conn = '${caller.id}'`);
    php("(function () { sweep(); return true; })()");
    assert.equal((await withAck(phone, "call", { op: "get", id: opened.call.id })).call.id, opened.call.id);

    // Desligar: todos os aparelhos ficam sabendo, e a mensagem mostra que foi atendida (e quanto durou).
    const ended = next(laptop, "call-ended");
    const finished = until(phone, "message:update", (item) => item.call?.status === "ended");
    caller.emit("call-ended", { id: opened.call.id, to: phone.id });
    const end = await ended;
    assert.deepEqual([end.id, end.reason, end.result, end.name], [opened.call.id, "hangup", "answered", "Pessoa 1"]);
    const log = (await finished).call;
    assert.equal(log.result, "answered");
    assert.ok(log.endedAt >= log.answeredAt && log.answeredAt >= log.startedAt);
    assert.equal((await withAck(phone, "call", { op: "get", id: opened.call.id })).call, null);

    // Recusar: quem ligou fica sabendo, e a mensagem diz que foi recusada.
    const rang = next(phone, "call-ring");
    const video = (await withAck(caller, "call", { op: "start", media: "video", state: { mic: true, cam: true } })).call;
    const ring = await rang;
    assert.deepEqual([ring.id, ring.caller, ring.media, ring.state.cam], [video.id, "Pessoa 1", "video", true]);
    const refused = next(caller, "call-ended");
    assert.equal((await withAck(phone, "call", { op: "decline", id: video.id })).ok, true);
    const no = await refused;
    assert.deepEqual([no.reason, no.result, no.name], ["declined", "declined", "Pessoa 2"]);

    // Quem ligou saiu (fechou a aba): a chamada acaba, perdida.
    const third = (await withAck(caller, "call", { op: "start", media: "audio" })).call;
    const lost = until(phone, "call-ended", (item) => item.id === third.id);
    caller.disconnect();
    const gone = await lost;
    assert.deepEqual([gone.id, gone.reason, gone.result], [third.id, "dropped", "missed"]);

    // Ninguém entrou: a chamada continua aberta esperando (sem limite, como no Discord) até quem ligou desligar.
    const waiting = await connect(firstLogin.body.token);
    const fourth = (await withAck(waiting, "call", { op: "start", media: "audio" })).call;
    php(`(function () { $call = find_call('${fourth.id}'); $call['startedAt'] -= 3 * 3600000; save_call($call); return true; })()`);
    await fetch(`${baseUrl}/api.php?action=health`);
    assert.equal((await withAck(phone, "call", { op: "get", id: fourth.id })).call.id, fourth.id);
    const hungUp = until(phone, "call-ended", (item) => item.id === fourth.id);
    waiting.emit("call-ended", { id: fourth.id });
    const gaveUp = await hungUp;
    assert.deepEqual([gaveUp.reason, gaveUp.result], ["hangup", "missed"]);

    // A conversa guardou as quatro (a citação de uma resposta diz como ela ficou); chamada não conta no perfil.
    const calls = sql("SELECT media FROM {p}messages WHERE source = 'call' ORDER BY n").map((row) => JSON.parse(row.media).call);
    assert.deepEqual(calls.map((item) => [item.media, item.status, item.result]), [["audio", "ended", "answered"], ["video", "ended", "declined"], ["audio", "ended", "missed"], ["audio", "ended", "missed"]]);
    assert.equal(php("call_label(['media' => 'audio', 'result' => 'missed'])"), "Chamada perdida");
    assert.equal(php("call_label(['media' => 'video', 'result' => 'answered'])"), "Chamada de vídeo");
    assert.equal(sql("SELECT COUNT(*) AS total FROM {p}settings WHERE name LIKE 'call:%'")[0].total, 0);
    // Cartões (chamada, música, jogo) não se apagam, nem por quem mandou.
    const cards = sql("SELECT id FROM {p}messages WHERE sender = 'Pessoa 1' AND source IN ('call', 'music', 'game')").map((row) => row.id);
    assert.ok(cards.length >= 3);
    for (const id of cards) waiting.emit("delete", { id });
    await withAck(waiting, "stats", null);
    assert.equal(sql("SELECT COUNT(*) AS total FROM {p}messages WHERE source IN ('call', 'music', 'game') AND deleted = 1")[0].total, 0);
    waiting.disconnect();
    phone.disconnect();
    laptop.disconnect();
  }

  // Contatos (como as DMs do Discord): quem já usa convida por um link que vale uma vez; cada par tem a sua conversa, e
  // ninguém vê nem mexe na conversa dos outros.
  {
    const one = await connect(firstLogin.body.token);
    const couple = one.history.room;
    assert.deepEqual(one.history.rooms.map((room) => [room.id, room.peer, room.couple]), [[couple, "Pessoa 2", true]]);
    assert.equal(one.history.couple, true);

    // O convite: quem abre o link cria a conta (sem o convite, não dá) e os dois viram contatos.
    const invite = await withAck(one, "invite", { op: "create" });
    assert.match(invite.code, /^[a-z2-9]{10}$/);
    assert.deepEqual(await (await fetch(`${baseUrl}/api.php?action=welcome&convite=${invite.code}`)).json(), { open: 0, invite: { from: "Pessoa 1" } });
    assert.deepEqual(await (await fetch(`${baseUrl}/api.php?action=welcome&convite=naoexiste22`)).json(), { open: 0, invite: false });
    const contact = until(one, "rooms", () => true);
    assert.deepEqual((await login("Pessoa 3", "senha-3")).status, 403);
    assert.deepEqual((await api("login", { name: "Pessoa 3", password: "senha-3", invite: invite.code })).body, { confirm: true, name: "Pessoa 3" });
    const joined = await api("login", { name: "Pessoa 3", password: "senha-3", confirm: "senha-3", invite: `${baseUrl}/#convite=${invite.code}` });
    assert.deepEqual([joined.status, joined.body.created, typeof joined.body.room], [200, true, "string"]);
    const fresh = joined.body.room;
    assert.equal((await contact).room, fresh);
    assert.equal((await api("login", { name: "Pessoa 4", password: "senha-4", confirm: "senha-4", invite: invite.code })).body.error, "Esse convite não vale mais (já foi usado ou passou de 7 dias). Peça outro.");

    // A Pessoa 3 só vê a conversa com quem convidou (e só essa pessoa na presença); o Nosso cantinho não é dela.
    const three = await connect(joined.body.token);
    assert.deepEqual([three.history.room, three.history.peer, three.history.couple, three.history.items], [fresh, "Pessoa 1", false, []]);
    assert.deepEqual(three.history.rooms.map((room) => room.peer), ["Pessoa 1"]);
    const seenBy3 = (await api("connect", { token: joined.body.token, conn: "presenca-pessoa-3", client: "web" })).body.presence.map((person) => person.name);
    assert.deepEqual(seenBy3.sort(), ["Pessoa 1", "Pessoa 3"]);
    await api("disconnect", { token: joined.body.token, conn: "presenca-pessoa-3" });
    assert.equal((await withAck(three, "us", { op: "load", day: "2026-10-22" })).error, "O Nosso cantinho é só do casal.");

    // Mensagem na conversa nova: só as duas pessoas dela recebem; a Pessoa 2 nem fica sabendo.
    const two = await connect(secondLogin.body.token);
    const outside = silent(two, "message", 2500);
    const arrived = next(three, "message");
    one.auth.room = fresh;
    const hello = await withAck(one, "message", { text: "Oi, Pessoa 3!", clientId: "contato-1" });
    assert.equal(hello.message.room, fresh);
    assert.equal((await arrived).text, "Oi, Pessoa 3!");
    await outside;
    const listed = await withAck(three, "rooms", null);
    assert.deepEqual([listed.rooms[0].unread, listed.rooms[0].last.text, listed.rooms[0].last.sender], [1, "Oi, Pessoa 3!", "Pessoa 1"]);
    // Cada conversa tem a sua pesquisa e o seu histórico.
    assert.deepEqual((await withAck(one, "search", { query: "Pessoa 3" })).items.map((item) => item.id), [hello.message.id]);
    const back = await withAck(one, "room", { id: couple });
    assert.deepEqual([back.ok, back.room, back.peer], [true, couple, "Pessoa 2"]);
    assert.ok(back.items.length > 0 && back.items.every((item) => item.room === couple));
    assert.equal((await withAck(three, "room", { id: couple })).error, "Essa conversa não existe.");

    // Quem não é da conversa não reage, não apaga e não marca como lida.
    const foreign = back.items[back.items.length - 1];
    three.emit("react", { id: foreign.id, emoji: "🔥" });
    three.emit("seen", { id: foreign.id });
    await withAck(three, "stats", null);
    assert.ok(!JSON.parse(sql(`SELECT reactions FROM {p}messages WHERE id = '${foreign.id}'`)[0].reactions)["🔥"]);
    assert.equal(sql(`SELECT COUNT(*) AS total FROM {p}reads WHERE name = 'Pessoa 3' AND room = '${couple}'`)[0].total, 0);

    // Quem já tem conta aceita o convite (pelo link colado) e ganha a conversa.
    const code = (await withAck(three, "invite", { op: "create" })).code;
    assert.equal((await withAck(three, "invite", { op: "accept", code })).error, "Esse convite é seu: mande para quem você quer adicionar.");
    const accepted = await withAck(two, "invite", { op: "accept", code: `https://exemplo.com/#convite=${code}` });
    assert.deepEqual([accepted.ok, accepted.peer], [true, "Pessoa 3"]);
    assert.deepEqual((await withAck(two, "rooms", null)).rooms.map((room) => room.peer).sort(), ["Pessoa 1", "Pessoa 3"]);

    // Cada um numa chamada por vez: quem já está numa não recebe outra.
    const busy = await withAck(one, "call", { op: "start", media: "audio" });
    assert.equal(busy.call.room, fresh);
    two.auth.room = accepted.room;
    assert.equal((await withAck(two, "call", { op: "start", media: "audio" })).error, "Pessoa 3 está em outra chamada agora.");
    one.emit("call-ended", { id: busy.call.id });
    await until(three, "call-ended", (item) => item.id === busy.call.id);
    one.disconnect();
    two.disconnect();
    three.disconnect();
  }

  // Muitas tentativas de senha: bloqueia.
  let blocked = 0;
  for (let i = 0; i < 14; i += 1) if ((await login("Pessoa 1", "errada")).status === 429) blocked += 1;
  assert.ok(blocked >= 1);

  console.log("Integração PHP + MySQL aprovada: atualização do banco antigo, página, contas com senha própria, sala de duas pessoas, GIFs, fotos e arquivos (envio, entrega protegida, faixas de bytes, limpeza), foto de perfil (também em GIF), perfil da outra pessoa, tema, papel de parede, bot de música, mensagens de voz (áudio do navegador em MP4 e WebM, duração, forma de onda e transcrição), pesquisa na conversa, trechos antigos e hora da leitura, nosso cantinho (o dia de cada um com fotos, hábitos, resposta aos lembretes, agenda com repetições, sonhos e metas, cartinhas com fotos, áudios e letra), joguinhos (cartas, velha, dama, memória e stop), extensão, confirmação, deduplicação, respostas, reações, leitura, apagar, digitando (e gravando áudio), chamadas, long polling, sessões da versão Node, paginação, senha esquecida e persistência.");
} finally {
  servers.forEach((server) => server.kill());
  transcriberServer.close();
  try {
    const tables = sql(`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE '${prefix}%'`);
    if (tables.length) sql(`DROP TABLE ${tables.map((table) => `\`${table.name}\``).join(", ")}`);
  } catch {}
  await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
}
