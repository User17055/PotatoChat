import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const messagesFile = process.env.MESSAGES_FILE
  ? path.resolve(root, process.env.MESSAGES_FILE)
  : path.join(root, "data", "messages.json");
const stateFile = messagesFile.replace(/\.json$/i, "") + ".state.json";
const usersFile = messagesFile.replace(/\.json$/i, "") + ".users.json";
const secretFile = path.join(path.dirname(messagesFile), ".token-secret");
const port = Number(process.env.PORT || 3000);
const chatPassword = process.env.CHAT_PASSWORD || "batata123";
const tokenSecret = process.env.TOKEN_SECRET || (await loadSecret());

const DAY = 24 * 60 * 60 * 1000;
const SESSION_DAYS = 365;
const MAX_USERS = 2;

const MAX_STORED = 500;
const PAGE_SIZE = 60;
const REACTIONS = ["❤️", "😂", "😮", "😢", "👍", "🔥"];

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, credentials: false },
  maxHttpBufferSize: 1e6
});

if (process.env.TRUST_PROXY) app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use((_, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), display-capture=(self)");
  // Só o próprio site e a extensão do Chrome podem incorporar o chat.
  res.setHeader("Content-Security-Policy", "frame-ancestors 'self' chrome-extension:");
  next();
});
const gsapFile = path.join(root, "node_modules", "gsap", "dist", "gsap.min.js");
app.get("/vendor/gsap.min.js", (_, res) => res.sendFile(gsapFile, { maxAge: "7d" }));
app.use(express.static(path.join(root, "public"), { extensions: ["html"] }));

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Sem TOKEN_SECRET, gera a chave uma vez e guarda em data/ — reiniciar o servidor não desloga ninguém.
async function loadSecret() {
  try {
    const saved = (await fs.readFile(secretFile, "utf8")).trim();
    if (saved.length >= 32) return saved;
  } catch {}
  const secret = crypto.randomBytes(32).toString("hex");
  await fs.mkdir(path.dirname(secretFile), { recursive: true });
  await fs.writeFile(secretFile, secret);
  return secret;
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", tokenSecret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verify(token) {
  try {
    const [body, signature] = String(token || "").split(".");
    const expected = crypto.createHmac("sha256", tokenSecret).update(body).digest("base64url");
    if (!safeEqual(signature, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return payload.expiresAt > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

// ---------- Armazenamento ----------

let messages = [];
let state = { reads: {}, lastSeen: {} };

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") console.error(`Falha ao ler ${path.basename(file)}:`, error);
    return fallback;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  const content = JSON.stringify(value, null, 2);
  try {
    await fs.writeFile(temp, content);
    await fs.rename(temp, file);
  } catch {
    // No Windows o rename pode falhar se outro programa estiver com o arquivo aberto.
    await fs.writeFile(file, content);
    await fs.rm(temp, { force: true });
  }
}

let writeQueue = Promise.resolve();
function persist() {
  writeQueue = writeQueue
    .then(() => Promise.all([writeJson(messagesFile, messages), writeJson(stateFile, state)]))
    .catch((error) => console.error("Falha ao salvar conversa:", error));
  return writeQueue;
}

function normalizeMessage(message) {
  return {
    id: message.id,
    clientId: message.clientId || null,
    sender: message.sender,
    text: message.deleted ? "" : message.text,
    createdAt: message.createdAt,
    replyTo: message.replyTo || null,
    reactions: message.reactions || {},
    deleted: Boolean(message.deleted),
    source: message.source || "web"
  };
}

const loaded = await readJson(messagesFile, []);
messages = Array.isArray(loaded) ? loaded.slice(-MAX_STORED).map(normalizeMessage) : [];
state = { reads: {}, lastSeen: {}, ...(await readJson(stateFile, {})) };

// Só duas pessoas: definidas em CHAT_USERS ("Nome1,Nome2") ou as duas primeiras que entrarem (ficam em data/users.json).
const fixedUsers = String(process.env.CHAT_USERS || "").split(",").map((name) => name.trim()).filter(Boolean).slice(0, MAX_USERS);
let users = fixedUsers.length
  ? fixedUsers
  : (await readJson(usersFile, [])).filter((name) => typeof name === "string").slice(0, MAX_USERS);

const sameName = (a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }) === 0;
const knownUser = (name) => users.find((user) => sameName(user, name));

function issueToken(name) {
  return sign({ name, expiresAt: Date.now() + SESSION_DAYS * DAY, nonce: crypto.randomUUID() });
}

function findMessage(id) {
  return messages.find((message) => message.id === id);
}

function page(beforeId) {
  const stop = beforeId ? messages.findIndex((message) => message.id === beforeId) : messages.length;
  if (stop < 0) return { items: [], hasMore: false };
  const start = Math.max(0, stop - PAGE_SIZE);
  return { items: messages.slice(start, stop), hasMore: start > 0 };
}

// ---------- Limites simples contra abuso ----------

function limiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((time) => now - time < windowMs);
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) hits.clear();
    return recent.length <= max;
  };
}
const loginLimit = limiter(12, 5 * 60 * 1000);

// ---------- HTTPS ----------

app.get("/api/health", (_, res) => res.json({ ok: true, people: people().length }));

app.post("/api/login", async (req, res) => {
  if (!loginLimit(req.ip)) return res.status(429).json({ error: "Muitas tentativas. Espere alguns minutos." });
  const name = String(req.body?.name || "").trim().replace(/\s+/g, " ").slice(0, 24);
  const password = String(req.body?.password || "");
  if (name.length < 2) return res.status(400).json({ error: "Digite um nome com pelo menos 2 caracteres." });
  if (!safeEqual(password, chatPassword)) return res.status(401).json({ error: "Senha incorreta." });
  let account = knownUser(name);
  if (!account) {
    if (users.length >= MAX_USERS) return res.status(403).json({ error: `Nosso chat é só de ${users.join(" e ")}.` });
    users = [...users, name];
    account = name;
    if (!fixedUsers.length) await writeJson(usersFile, users);
  }
  res.json({ token: issueToken(account), name: account });
});

// ---------- Tempo real ----------

io.use((socket, next) => {
  const session = verify(socket.handshake.auth?.token);
  const account = session && knownUser(session.name);
  if (!account) return next(new Error("Sessão inválida. Entre novamente."));
  socket.data.name = account;
  socket.data.expiresAt = session.expiresAt;
  socket.data.client = socket.handshake.auth?.client === "extension" ? "extension" : "web";
  socket.data.visible = socket.data.client === "web";
  socket.data.allowMessage = limiter(25, 10 * 1000);
  next();
});

function sockets() {
  return [...io.sockets.sockets.values()];
}

// Uma "pessoa" pode ter várias conexões (site, celular, extensão).
function people() {
  return [...new Set(sockets().map((socket) => socket.data.name))];
}

// "Online" = com o chat aberto (site ou painel). O serviço de fundo da extensão não conta.
function webPeople() {
  return [...new Set(sockets().filter((socket) => socket.data.client === "web").map((socket) => socket.data.name))];
}

function presence() {
  const online = new Set(webPeople());
  return users.map((name) => ({
    name,
    online: online.has(name),
    active: sockets().some((socket) => socket.data.name === name && socket.data.visible),
    lastSeen: state.lastSeen[name] || null
  }));
}

function emitPresence() {
  io.emit("presence", presence());
}

// Envia apenas para as conexões de chat (não para o serviço de fundo da extensão) da outra pessoa.
function toPeer(socket, event, payload) {
  for (const target of sockets()) {
    if (target.data.name === socket.data.name || target.data.client !== "web") continue;
    if (payload?.to && target.id !== payload.to) continue;
    target.emit(event, payload);
  }
}

function toMyOtherTabs(socket, event, payload) {
  for (const target of sockets()) {
    if (target.id !== socket.id && target.data.name === socket.data.name && target.data.client === "web") target.emit(event, payload);
  }
}

io.on("connection", (socket) => {
  const { name } = socket.data;
  const others = people().filter((person) => person !== name);
  if (others.length > 1) {
    socket.emit("room-full");
    return socket.disconnect(true);
  }

  // Renova a sessão de quem usa sempre: ninguém precisa digitar a senha de novo.
  if (socket.data.expiresAt - Date.now() < (SESSION_DAYS - 30) * DAY) socket.emit("session", { token: issueToken(name), name });

  socket.emit("history", { ...page(), reads: state.reads, me: name });
  emitPresence();
  if (socket.data.client === "web") toPeer(socket, "peer-ready", { id: socket.id, name });

  socket.on("history:before", ({ before } = {}, acknowledge) => {
    if (typeof acknowledge === "function") acknowledge(page(String(before || "")));
  });

  socket.on("message", async (body, acknowledge) => {
    const reply = typeof acknowledge === "function" ? acknowledge : () => {};
    const text = String(body?.text || "").trim().slice(0, 2000);
    const clientId = String(body?.clientId || "").slice(0, 64) || null;
    if (!text) return reply({ ok: false, error: "Mensagem vazia." });
    if (!socket.data.allowMessage()) return reply({ ok: false, error: "Calma! Muitas mensagens em pouco tempo." });

    // Reenvio após queda de conexão: não duplica.
    const duplicate = clientId && messages.find((message) => message.clientId === clientId && message.sender === name);
    if (duplicate) return reply({ ok: true, message: duplicate });

    const original = body?.replyTo ? findMessage(String(body.replyTo)) : null;
    const message = normalizeMessage({
      id: crypto.randomUUID(),
      clientId,
      sender: name,
      text,
      createdAt: new Date().toISOString(),
      replyTo: original ? { id: original.id, sender: original.sender, text: original.deleted ? "" : original.text.slice(0, 160) } : null,
      source: socket.data.client
    });
    messages.push(message);
    if (messages.length > MAX_STORED) messages = messages.slice(-MAX_STORED);
    state.reads[name] = { id: message.id, at: message.createdAt };
    await persist();
    io.emit("message", message);
    reply({ ok: true, message });
  });

  socket.on("react", async ({ id, emoji } = {}) => {
    const message = findMessage(String(id));
    if (!message || message.deleted || !REACTIONS.includes(emoji)) return;
    const list = message.reactions[emoji] || [];
    message.reactions[emoji] = list.includes(name) ? list.filter((person) => person !== name) : [...list, name];
    if (!message.reactions[emoji].length) delete message.reactions[emoji];
    await persist();
    io.emit("message:update", message);
  });

  socket.on("delete", async ({ id } = {}) => {
    const message = findMessage(String(id));
    if (!message || message.sender !== name || message.deleted) return;
    Object.assign(message, { deleted: true, text: "", reactions: {} });
    await persist();
    io.emit("message:update", message);
  });

  socket.on("seen", async ({ id } = {}) => {
    const index = messages.findIndex((message) => message.id === id);
    const current = messages.findIndex((message) => message.id === state.reads[name]?.id);
    if (index < 0 || index <= current) return;
    state.reads[name] = { id, at: new Date().toISOString() };
    io.emit("seen", { name, ...state.reads[name] });
    await persist();
  });

  socket.on("visibility", (visible) => {
    socket.data.visible = Boolean(visible);
    emitPresence();
  });

  socket.on("typing", (active) => toPeer(socket, "typing", { name, active: Boolean(active) }));

  // Sinalização WebRTC: sempre para a outra pessoa, nunca para as próprias abas.
  socket.on("webrtc-offer", (payload) => toPeer(socket, "webrtc-offer", { ...payload, from: socket.id, name }));
  socket.on("webrtc-answer", (payload) => {
    toPeer(socket, "webrtc-answer", { ...payload, from: socket.id });
    toMyOtherTabs(socket, "call-handled");
  });
  socket.on("webrtc-ice", (payload) => toPeer(socket, "webrtc-ice", { ...payload, from: socket.id }));
  socket.on("call-state", (payload) => toPeer(socket, "call-state", { ...payload, from: socket.id }));
  socket.on("call-declined", () => {
    toPeer(socket, "call-declined", { name });
    toMyOtherTabs(socket, "call-handled");
  });
  socket.on("call-ended", () => toPeer(socket, "call-ended", { name }));

  socket.on("disconnect", () => {
    if (socket.data.client === "web") toPeer(socket, "peer-left", { id: socket.id, name });
    if (socket.data.client === "web" && !webPeople().includes(name)) {
      state.lastSeen[name] = new Date().toISOString();
      persist();
    }
    emitPresence();
  });
});

httpServer.listen(port, () => {
  console.log(`Potato Chat disponível em http://localhost:${port}`);
  if (process.env.CHAT_PASSWORD === undefined) console.warn("Usando senha de desenvolvimento: batata123");
});
