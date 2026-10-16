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

await fs.writeFile(configFile, `<?php return ${phpValue({ token_secret: secret, db, poll_wait: 3 })};`);

function phpValue(value) {
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

// Banco da versão 1 (sem senhas nem fotos), com uma conta antiga: o site precisa atualizar sozinho.
rawSql(`CREATE TABLE {p}settings (name VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY, value TEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE {p}users (position INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL, created_at VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
  for (const column of ["pass_hash", "avatar", "avatar_type", "avatar_key"]) assert.ok(columns.includes(column), column);
  assert.equal(sql("SELECT value FROM {p}settings WHERE name = 'schema'")[0].value, "2");
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

  // Página anterior do histórico.
  const older = await withAck(first, "history:before", { before: message.id });
  assert.deepEqual(older, { items: [], hasMore: false });

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
  assert.equal((await withAck(first, "avatar", { image: `data:image/gif;base64,${png.toString("base64")}` })).error, "Formato de imagem não aceito.");
  assert.equal((await withAck(first, "avatar", { image: `data:image/jpeg;base64,${png.toString("base64")}` })).error, "Imagem inválida.");
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
  assert.equal(stored.length, 4);
  assert.equal(JSON.parse(stored[0].reactions)["❤️"][0], "Pessoa 2");
  assert.equal(stored[1].deleted, 1);
  assert.equal(stored[1].text, "");
  assert.equal(stored[2].source, "extension");
  assert.equal(stored[3].text, "Acordou?");
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
  assert.equal(before.items.length, 9);
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

  // Muitas tentativas de senha: bloqueia.
  let blocked = 0;
  for (let i = 0; i < 14; i += 1) if ((await login("Pessoa 1", "errada")).status === 429) blocked += 1;
  assert.ok(blocked >= 1);

  console.log("Integração PHP + MySQL aprovada: atualização do banco antigo, página, contas com senha própria, sala de duas pessoas, foto de perfil, extensão, confirmação, deduplicação, respostas, reações, leitura, apagar, digitando, chamadas, long polling, sessões da versão Node, paginação, senha esquecida e persistência.");
} finally {
  servers.forEach((server) => server.kill());
  try {
    const tables = sql(`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE '${prefix}%'`);
    if (tables.length) sql(`DROP TABLE ${tables.map((table) => `\`${table.name}\``).join(", ")}`);
  } catch {}
  await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
}
