import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 3197;
const baseUrl = `http://localhost:${port}`;
const testFile = "data/integration-test-messages.json";
const testFilePath = path.join(root, testFile);
const stateFilePath = testFilePath.replace(/\.json$/, ".state.json");
const usersFilePath = testFilePath.replace(/\.json$/, ".users.json");
const server = spawn(process.execPath, ["server/index.js"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    CHAT_PASSWORD: "senha-de-teste",
    TOKEN_SECRET: "segredo-de-integracao-com-mais-de-32-caracteres",
    MESSAGES_FILE: testFile
  },
  stdio: ["ignore", "pipe", "inherit"]
});

function waitForServer() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Servidor não iniciou a tempo.")), 20000);
    server.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("Potato Chat disponível")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.once("exit", (code) => reject(new Error(`Servidor encerrou com código ${code}.`)));
  });
}

async function login(name, password = "senha-de-teste") {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, password })
  });
  return { response, body: await response.json() };
}

function connect(token, client = "web") {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, { auth: { token, client }, transports: ["websocket"], reconnection: false });
    socket.once("history", (history) => { socket.history = history; resolve(socket); });
    socket.once("connect_error", reject);
  });
}

const next = (socket, event) => new Promise((resolve) => socket.once(event, resolve));
const silent = (socket, event, ms = 300) => new Promise((resolve, reject) => {
  const fail = () => reject(new Error(`Evento inesperado: ${event}`));
  socket.once(event, fail);
  setTimeout(() => { socket.off(event, fail); resolve(); }, ms);
});

try {
  await fs.rm(testFilePath, { force: true });
  await fs.rm(stateFilePath, { force: true });
  await fs.rm(usersFilePath, { force: true });
  await waitForServer();

  const home = await fetch(baseUrl);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Potato Chat/);
  assert.equal((await fetch(`${baseUrl}/vendor/gsap.min.js`)).status, 200);

  const denied = await login("Pessoa 1", "senha-errada");
  assert.equal(denied.response.status, 401);

  const firstLogin = await login("Pessoa 1");
  const secondLogin = await login("Pessoa 2");
  const thirdLogin = await login("Intrusa");
  assert.equal(firstLogin.response.status, 200);
  assert.equal(secondLogin.response.status, 200);

  const first = await connect(firstLogin.body.token);
  const second = await connect(secondLogin.body.token);
  assert.deepEqual(first.history.items, []);
  assert.equal(first.history.hasMore, false);

  // Mesma pessoa pode ter site + extensão abertos; uma terceira pessoa não entra.
  // Só duas pessoas: a terceira nem consegue entrar, e a mesma pessoa entra com outra caixa de letra.
  assert.equal(thirdLogin.response.status, 403);
  const sameAgain = await login("pessoa 1");
  assert.equal(sameAgain.body.name, "Pessoa 1");
  assert.deepEqual(JSON.parse(await fs.readFile(usersFilePath, "utf8")), ["Pessoa 1", "Pessoa 2"]);
  const firstExtension = await connect(firstLogin.body.token, "extension");

  // Envio com confirmação + entrega em tempo real.
  const received = next(second, "message");
  const ack = await first.emitWithAck("message", { text: "Mensagem de integração", clientId: "cliente-1" });
  assert.equal(ack.ok, true);
  const message = await received;
  assert.equal(message.sender, "Pessoa 1");
  assert.equal(message.text, "Mensagem de integração");
  assert.equal(message.clientId, "cliente-1");

  // Reenvio após queda não duplica.
  const retry = await first.emitWithAck("message", { text: "Mensagem de integração", clientId: "cliente-1" });
  assert.equal(retry.message.id, message.id);

  // Resposta, reação, leitura e apagar.
  const reply = await second.emitWithAck("message", { text: "Respondendo", clientId: "cliente-2", replyTo: message.id });
  assert.equal(reply.message.replyTo.id, message.id);

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

  // Mensagem enviada pela extensão chega para os dois lados.
  const fromExtension = next(second, "message");
  await firstExtension.emitWithAck("message", { text: "Via extensão", clientId: "cliente-3" });
  assert.equal((await fromExtension).source, "extension");

  // Sinalização de chamada vai só para a outra pessoa, nunca para as próprias conexões.
  const offer = next(second, "webrtc-offer");
  const noSelfOffer = Promise.all([silent(firstExtension, "webrtc-offer")]);
  first.emit("webrtc-offer", { media: "audio", description: { type: "offer", sdp: "x" } });
  assert.equal((await offer).name, "Pessoa 1");
  await noSelfOffer;

  first.disconnect();
  second.disconnect();
  firstExtension.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 200));
  const stored = JSON.parse(await fs.readFile(testFilePath, "utf8"));
  assert.equal(stored.length, 3);
  assert.equal(stored[0].reactions["❤️"][0], "Pessoa 2");
  assert.equal(stored[1].deleted, true);
  assert.equal(stored[1].text, "");
  const state = JSON.parse(await fs.readFile(stateFilePath, "utf8"));
  assert.ok(state.lastSeen["Pessoa 2"]);
  console.log("Integração aprovada: login, sala de duas pessoas, extensão, confirmação, deduplicação, respostas, reações, leitura, apagar, chamadas e persistência.");
} finally {
  server.kill();
  await fs.rm(testFilePath, { force: true });
  await fs.rm(stateFilePath, { force: true });
  await fs.rm(usersFilePath, { force: true });
}
