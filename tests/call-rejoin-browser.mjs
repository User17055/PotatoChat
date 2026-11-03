// WebRTC real com mídia sintética e PHP/MySQL de teste: recarga, saída, reentrada e prazo de cinco minutos.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = path.join(root, "versao-php/site");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "potato-call-ui-"));
const configFile = path.join(temp, "config.php");
const prefix = `callui${Date.now().toString(36)}_`;
const base = "http://127.0.0.1:8322";
const phpValue = (value) => typeof value === "string" ? `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`
  : typeof value === "boolean" ? value ? "true" : "false"
  : typeof value === "number" ? String(value)
  : `[${Object.entries(value).map(([key, item]) => `${phpValue(key)} => ${phpValue(item)}`).join(",")}]`;
const db = { host: process.env.POTATO_TEST_DB_HOST || "127.0.0.1", port: Number(process.env.POTATO_TEST_DB_PORT || 3399),
  name: process.env.POTATO_TEST_DB_NAME || "potato_teste", user: process.env.POTATO_TEST_DB_USER || "potato", pass: process.env.POTATO_TEST_DB_PASS || "senha-teste", prefix };
await fs.writeFile(configFile, `<?php return ${phpValue({ db, token_secret: "segredo-call-ui-somente-teste", poll_wait: 0, music_lookup: false })};`);
const env = { ...process.env, POTATO_CONFIG: configFile };
const phpArgs = ["-d", "extension=pdo_mysql"];
const php = (expression) => JSON.parse(execFileSync("php", [...phpArgs, "-r", `require ${phpValue(path.join(site, "lib/potato.php"))}; echo json_encode(${expression}, JSON_UNESCAPED_UNICODE);`], { env }).toString());
const server = spawn("php", [...phpArgs, "-S", "127.0.0.1:8322", "-t", site], { env, stdio: ["ignore", "ignore", "pipe"] });
let serverErrors = "";
server.stderr.on("data", (chunk) => { serverErrors = (serverErrors + chunk).slice(-3000); });
const until = async (check, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (!await check()) { if (Date.now() > deadline) throw new Error("Timeout na condição do teste"); await new Promise((r) => setTimeout(r, 100)); }
};
const api = async (action, body) => {
  const response = await fetch(`${base}/api.php?action=${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
};
let browser;
try {
  await until(async () => { try { return (await fetch(`${base}/api.php?action=health`)).ok; } catch { return false; } });
  const ana = await api("login", { name: "Ana", password: "teste-call-1234", confirm: "teste-call-1234" });
  const beto = await api("login", { name: "Beto", password: "teste-call-1234", confirm: "teste-call-1234" });
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright-core");
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  const errors = [];
  const open = async (account, mobile = false) => {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1100, height: 850 }, isMobile: mobile, hasTouch: mobile, permissions: ["microphone", "camera"] });
    await context.route(/^https:\/\//, (route) => route.abort());
    await context.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = constraints.audio ? await original({ audio: constraints.audio }) : new MediaStream();
        if (constraints.video) {
          const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 180;
          const ctx = canvas.getContext("2d");
          const draw = () => { ctx.fillStyle = `hsl(${Date.now() % 360},70%,45%)`; ctx.fillRect(0, 0, 320, 180); };
          draw();
          const track = canvas.captureStream(12).getVideoTracks()[0];
          const timer = setInterval(draw, 80), stop = track.stop.bind(track);
          track.stop = () => { clearInterval(timer); stop(); };
          stream.addTrack(track);
        }
        return stream;
      };
    });
    await context.addInitScript((account) => {
      if (localStorage.getItem("call.test.seeded")) return;
      localStorage.setItem("call.test.seeded", "yes");
      localStorage.setItem("potato.session", JSON.stringify(account));
    }, { name: account.name, token: account.token });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(() => document.querySelector("#room-title").textContent !== "Aguardando alguém");
    return page;
  };
  const a = await open(ana), b = await open(beto, true);
  const connected = async (page) => {
    await page.waitForSelector("#call-panel:not(.hidden) .call-info.live", { timeout: 30000 });
    assert.equal(await page.locator("#remote-audio").evaluate((node) => node.srcObject?.getAudioTracks()[0]?.readyState), "live");
    await page.waitForFunction(() => document.querySelector("#remote-video").videoWidth > 0, undefined, { timeout: 15000 });
  };
  const getCall = (id) => php(`find_call('${id}')`);
  const expire = (id) => php(`transaction(function () { $call = find_call('${id}'); $call['waitingUntil'] = now_ms() - 1; save_call($call); sweep(); return true; })`);
  await a.locator("#video-call").click();
  await b.waitForSelector("#incoming:not(.hidden)", { timeout: 15000 });
  await b.locator("#accept-call").click({ force: true });
  await Promise.all([connected(a), connected(b)]);
  const id = await a.evaluate(() => JSON.parse(localStorage.getItem("potato.callResume")).id);
  const firstGeneration = getCall(id).generation;
  assert.equal(getCall(id).waitingUntil, null);
  const ownerConn = getCall(id).callerConn;
  const extraTab = await open(ana);
  await extraTab.waitForSelector("#available-call:not(.hidden)");
  assert.ok(await extraTab.locator("#call-panel").isHidden());
  assert.equal(getCall(id).callerConn, ownerConn, "outra aba não pode tomar uma chamada ativa automaticamente");
  await extraTab.context().close();

  await a.reload();
  await Promise.all([connected(a), connected(b)]);
  assert.equal(await a.evaluate(() => JSON.parse(localStorage.getItem("potato.callResume")).id), id);
  assert.ok(getCall(id).generation > firstGeneration);
  console.log("Quem ligou recarregou: login e reentrada automáticos, mesmo ID e áudio conectado.");

  await a.evaluate(() => document.querySelector("[data-logout]").click());
  await a.waitForSelector("#login-view:not(.hidden)");
  await a.waitForSelector("#emoji-panel", { state: "attached" });
  await a.locator("#name").fill("Ana");
  await a.locator("#password").fill("teste-call-1234");
  await a.locator("#login-form .primary").click();
  await Promise.all([connected(a), connected(b)]);
  assert.equal(await a.evaluate(() => JSON.parse(localStorage.getItem("potato.callResume")).id), id);
  console.log("Sair da conta e entrar novamente também retoma a mesma chamada automaticamente.");

  await b.locator("#toggle-mic").click();
  assert.equal(await b.locator("#toggle-mic").getAttribute("aria-pressed"), "false");
  // A oferta pode chegar pelo polling antes da resposta HTTP de resume.
  await b.route("**/api.php?action=ops", async (route) => {
    const body = route.request().postDataJSON();
    if (body.ops?.some((op) => op.event === "call" && op.data?.op === "resume")) {
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.fulfill({ response });
    } else await route.continue();
  });
  await b.reload();
  await Promise.all([connected(a), connected(b)]);
  assert.equal(await b.locator("#toggle-mic").getAttribute("aria-pressed"), "false");
  await b.unroute("**/api.php?action=ops");
  console.log("Quem atendeu recarregou: retomada preserva o mudo e aceita oferta antes da confirmação HTTP.");

  await b.locator("#end-call").click();
  await b.waitForSelector("#available-call:not(.hidden)");
  const banner = await b.locator("#available-call").boundingBox();
  assert.ok(banner.x >= 0 && banner.x + banner.width <= 390);
  await until(() => getCall(id).calleeConn === null);
  const deadline = getCall(id).waitingUntil;
  assert.ok(deadline > Date.now() + 295000 && deadline <= Date.now() + 301000);
  await until(() => a.locator("#call-status").textContent().then((text) => text.includes("Aguardando")));
  await new Promise((resolve) => setTimeout(resolve, 1800));
  assert.equal(getCall(id).calleeConn, null, "sair não deve reentrar imediatamente na mesma página");
  assert.equal(getCall(id).waitingUntil, deadline, "polling e consultas não renovam o prazo de espera");
  await b.reload();
  await Promise.all([connected(a), connected(b)]);
  assert.equal(getCall(id).waitingUntil, null);
  console.log("Sair preserva a sala por 5 minutos; relogar reentra e cancela o prazo.");

  // Um aviso de saída pode chegar depois de a mesma página já ter reentrado.
  await a.route("**/api.php?action=ops", async (route) => {
    const body = route.request().postDataJSON();
    if (body.ops?.some((op) => op.event === "call-leave")) await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await a.locator("#end-call").click();
  await a.waitForSelector("#join-available-call:enabled");
  await a.locator("#join-available-call").click();
  await Promise.all([connected(a), connected(b)]);
  assert.equal(getCall(id).waitingUntil, null);
  await a.unroute("**/api.php?action=ops");
  await a.locator("#end-call").click();
  await until(() => getCall(id).callerConn === null);
  const firstDeadline = getCall(id).waitingUntil;
  await b.locator("#end-call").click();
  await until(() => getCall(id).calleeConn === null);
  assert.equal(getCall(id).waitingUntil, firstDeadline);
  await b.locator("#join-available-call").click();
  await until(() => getCall(id).calleeConn !== null);
  expire(id);
  await Promise.all([a.waitForSelector("#available-call", { state: "hidden" }), b.waitForSelector("#call-panel", { state: "hidden" })]);
  assert.equal(getCall(id), null);
  await a.reload();
  await a.waitForSelector("#emoji-panel", { state: "attached" });
  assert.ok(await a.locator("#call-panel").isHidden());
  assert.equal(php(`query("SELECT COUNT(*) FROM " . t('messages') . " WHERE source = 'call'")->fetchColumn()`), 1);
  await a.locator("#audio-call").click();
  await b.waitForSelector("#incoming:not(.hidden)");
  const newId = await a.evaluate(() => JSON.parse(localStorage.getItem("potato.callResume")).id);
  assert.notEqual(newId, id);
  assert.equal(getCall(newId).calleeConn, null, "uma chamada nova exige atendimento, sem entrada automática");
  expire(newId);
  await b.waitForSelector("#incoming", { state: "hidden" });
  assert.deepEqual(errors, []);
  console.log("Reentrada manual, saída dos dois e expiração com uma pessoa esperando aprovadas; sala expirada não volta.");
} catch (error) {
  console.error("Teste de reentrada falhou:", error.message);
  if (browser) {
    for (const [index, context] of browser.contexts().entries()) {
      const page = context.pages()[0];
      if (page) { await fs.mkdir(path.join(root, "dist"), { recursive: true }); await page.screenshot({ path: path.join(root, `dist/call-rejoin-failure-${index}.png`) }).catch(() => {}); }
    }
  }
  throw error;
} finally {
  await browser?.close();
  server.kill();
  try { php(`(function () { foreach (query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN) as $table) { if (strpos($table, '${prefix}') === 0) query('DROP TABLE ' . $table); } return true; })()`); }
  catch { console.error("Não foi possível limpar as tabelas do teste", prefix); }
  await fs.unlink(configFile).catch(() => {});
  await fs.rmdir(temp).catch(() => {});
}
