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
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1100, height: 850 }, isMobile: mobile, hasTouch: mobile, permissions: ["microphone", "camera"],
      ...(mobile && process.env.POTATO_TEST_SCREEN ? { userAgent: "Mozilla/5.0 Android PotatoChatAndroid/3.0" } : {}) });
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
    if (mobile && process.env.POTATO_TEST_SCREEN) await context.addInitScript(() => {
      window.__potatoScreenCapture = true;
      window.__potatoScreenAudio = true;
      window.__nativeMessages = [];
      let pc, timer, source, tone;
      window.PotatoAndroid = { postMessage(raw) {
        const message = JSON.parse(raw);
        window.__nativeMessages.push(message);
        if (message.type === "screen-stop") { pc?.close(); clearInterval(timer); source?.getTracks().forEach((t) => t.stop()); tone?.close(); }
        if (message.type !== "screen-start") return;
        (async () => {
          // Simula apenas o produtor nativo; as duas conexões WebRTC e a UI são reais.
          pc = new RTCPeerConnection({ iceServers: [] });
          const canvas = document.createElement("canvas"); canvas.width = 1080; canvas.height = 2400;
          const draw = () => { const ctx = canvas.getContext("2d"); ctx.fillStyle = "#235c8e"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = "white"; ctx.font = "80px sans-serif"; ctx.fillText("Tela Android", 50, 150); ctx.fillText(String(Date.now()), 50, 300); };
          draw(); source = canvas.captureStream(15); timer = setInterval(draw, 66);
          window.__rotateScreen = () => { canvas.width = 1920; canvas.height = 1080; draw(); };
          tone = new AudioContext({ sampleRate: 48000 });
          const destination = tone.createMediaStreamDestination(), oscillator = tone.createOscillator();
          oscillator.frequency.value = 440; oscillator.connect(destination); oscillator.start(); await tone.resume();
          await pc.setRemoteDescription({ type: "offer", sdp: message.sdp });
          for (const transceiver of pc.getTransceivers()) {
            transceiver.direction = "sendonly";
            await transceiver.sender.replaceTrack(transceiver.receiver.track.kind === "video" ? source.getVideoTracks()[0] : destination.stream.getAudioTracks()[0]);
          }
          await pc.setLocalDescription(await pc.createAnswer());
          await new Promise((resolve) => {
            if (pc.iceGatheringState === "complete") return resolve();
            pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") resolve(); });
          });
          for (const sender of pc.getSenders()) if (sender.track?.kind === "video") {
            const params = sender.getParameters(); params.encodings[0].maxBitrate = 16000000;
            params.degradationPreference = "maintain-resolution"; await sender.setParameters(params);
          }
          window.dispatchEvent(new CustomEvent("potato-screen", { detail: { id: message.id, event: "answer", value: pc.localDescription.sdp, audio: true } }));
        })().catch((error) => window.dispatchEvent(new CustomEvent("potato-screen", { detail: { id: message.id, event: "error", value: error.message } })));
      } };
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
    await page.waitForFunction(() => {
      const panel = document.querySelector("#call-panel");
      return getComputedStyle(panel).display !== "none" && panel.querySelector(".call-info.live")
        && document.querySelector("#remote-audio").srcObject?.getAudioTracks()[0]?.readyState === "live"
        && document.querySelector("#remote-video").videoWidth > 0;
    }, undefined, { timeout: 30000 });
  };
  const getCall = (id) => php(`find_call('${id}')`);
  const expire = (id) => php(`transaction(function () { $call = find_call('${id}'); $call['waitingUntil'] = now_ms() - 1; save_call($call); sweep(); return true; })`);
  await a.locator("#video-call").click();
  await b.waitForSelector("#incoming:not(.hidden)", { timeout: 15000 });
  await b.locator("#accept-call").click({ force: true });
  await Promise.all([connected(a), connected(b)]);
  if (process.env.POTATO_TEST_SCREEN) {
    await b.locator("#toggle-live").click();
    assert.equal(await b.locator("#share-audio").isDisabled(), false);
    await b.locator('#share-options [data-quality="1080p"]').click();
    await b.locator("#share-go").click();
    await a.waitForFunction(() => { const v = document.querySelector("#stream-video"); return v.videoWidth >= 720 && v.videoHeight > v.videoWidth; }, undefined, { timeout: 30000 });
    assert.equal(await b.locator("#my-stream").isHidden(), true);
    assert.equal(await b.locator("#my-stream video").evaluate((v) => v.srcObject), null);
    const dimensions = await a.locator("#stream-video").evaluate((v) => [v.videoWidth, v.videoHeight]);
    assert.ok(await a.locator("#stream-tile").evaluate((v) => v.getBoundingClientRect().height) > 600);
    const signal = await a.locator("#stream-video").evaluate(async (video) => {
      const context = new AudioContext(), analyser = context.createAnalyser();
      const source = context.createMediaStreamSource(new MediaStream(video.srcObject.getAudioTracks())); source.connect(analyser);
      await context.resume();
      return new Promise((resolve) => {
        const values = new Float32Array(analyser.fftSize), start = performance.now();
        const sample = () => { analyser.getFloatTimeDomainData(values); const peak = Math.max(...values.map(Math.abs)); if (peak > .01 || performance.now() - start > 10000) { source.disconnect(); context.close(); resolve(peak); } else setTimeout(sample, 100); }; sample();
      });
    });
    assert.ok(signal > .01, `O áudio interno precisa chegar ao PC com sinal: ${signal}`);
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    await a.screenshot({ path: path.join(root, "dist/screen-portrait-pc.png") });
    await b.waitForFunction(() => document.querySelector("#remote-pip video")?.videoWidth > 0);
    await b.evaluate(() => window.potatoCall("pip", true));
    assert.ok(await b.locator("#call-panel").evaluate((v) => getComputedStyle(v).visibility === "hidden"));
    assert.equal(await b.locator("#remote-pip video").evaluate((v) => getComputedStyle(v).visibility), "visible");
    assert.ok(await b.locator("#remote-pip video").evaluate((v) => v.dataset.track === document.querySelector("#remote-video").dataset.track));
    await b.screenshot({ path: path.join(root, "dist/screen-remote-pip.png") });
    await b.evaluate(() => window.potatoCall("pip", false));
    await b.evaluate(() => window.__rotateScreen());
    await a.waitForFunction(() => { const v = document.querySelector("#stream-video"); return v.videoWidth > v.videoHeight; }, undefined, { timeout: 30000 });
    await b.locator("#toggle-live").click();
    await a.waitForSelector("#stream-tile", { state: "hidden" });
    assert.equal(await b.evaluate(() => window.__nativeMessages.filter((m) => m.type === "screen-start").at(-1).audio), true);
    console.log(`Tela Android ${dimensions.join("x")}, áudio audível no PC, rotação, prévia própria oculta e PiP só com vídeo remoto: OK.`);
  }
  const id = await a.evaluate(() => JSON.parse(localStorage.getItem("potato.callResume")).id);
  assert.equal(await a.evaluate(() => JSON.parse(localStorage.getItem("potato.callResume")).active), true);
  const firstGeneration = getCall(id).generation;
  assert.equal(getCall(id).waitingUntil, null);
  await b.locator("#call-minimize").click();
  await b.waitForSelector("#call-dock:not(.hidden)");
  assert.ok(await b.locator("#call-panel").isHidden());
  await b.locator(".conversation [data-menu]").click();
  await b.locator("#side-profile").click();
  await b.waitForSelector('#chat-view[data-tab="profile"]');
  assert.ok(await b.locator("#call-dock").isVisible());
  const timerBefore = await b.locator("#call-dock-timer").textContent();
  await b.waitForFunction((before) => { const value = document.querySelector("#call-dock-timer").textContent; return value && value !== before; }, timerBefore);
  await b.locator("#call-dock-mic").click();
  await b.waitForFunction(() => document.querySelector("#toggle-mic").getAttribute("aria-pressed") === "false");
  await a.waitForSelector("#tile-peer.muted");
  await b.locator("#profile-view [data-menu]").click();
  await b.locator('.sidebar [data-us-open="hoje"]').click();
  await b.waitForSelector('#chat-view[data-tab="us"]');
  assert.ok(await b.locator("#call-dock").isVisible());
  assert.ok(await b.locator("#us-view").evaluate((node) => node.getBoundingClientRect().top >= 68), "a faixa reserva espaço, sem cobrir a página");
  await fs.mkdir(path.join(root, "dist"), { recursive: true });
  await b.screenshot({ path: path.join(root, "dist/call-dock-us-mobile.png") });
  await b.locator("#call-dock-open").click();
  await b.waitForSelector('#chat-view[data-tab="chat"] #call-panel');
  assert.ok(await b.locator("#call-dock").isHidden());
  assert.equal(await b.locator("#toggle-mic").getAttribute("aria-pressed"), "false", "voltar à chamada preserva o mudo");
  await b.locator("#toggle-mic").click();
  await a.locator("#toggle-cam").click();
  await b.locator("#toggle-cam").click();
  await b.waitForSelector("#call-panel.voice-only");
  assert.ok((await b.locator("#call-panel").boundingBox()).height < 300, "voz no celular deve ocupar menos de 300px");
  assert.ok(await b.locator("#call-panel").evaluate((node) => node.querySelector(".call-head").getBoundingClientRect().bottom <= node.querySelector("#tile-peer").getBoundingClientRect().top), "avatares não podem cobrir o cabeçalho ou impedir Recolher");
  await b.screenshot({ path: path.join(root, "dist/call-voice-mobile.png") });
  await b.setViewportSize({ width: 320, height: 740 });
  assert.ok(await b.locator(".call-buttons").evaluate((node) => node.scrollWidth <= node.clientWidth), "controles cabem em uma tela de 320px");
  await b.locator("#call-minimize").click();
  await b.screenshot({ path: path.join(root, "dist/call-dock-chat-small.png") });
  await b.locator("#call-dock-open").click();
  await b.setViewportSize({ width: 390, height: 844 });
  await a.locator("#toggle-cam").click();
  await b.locator("#toggle-cam").click();
  await Promise.all([connected(a), connected(b)]);
  assert.equal(getCall(id).generation, firstGeneration, "navegar e recolher não reinicia a conexão");
  assert.equal(getCall(id).waitingUntil, null);
  console.log("Faixa global no perfil/cantinho/chat, voltar à call, mudo sincronizado, voz compacta e controles em 320px: OK.");
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
  await a.waitForSelector("#available-call:not(.hidden)");
  assert.ok(await a.locator("#call-panel").isHidden());
  await until(() => getCall(id).callerConn === null);
  assert.equal(await a.evaluate(() => localStorage.getItem("potato.callResume")), null);
  await a.reload();
  await a.waitForSelector("#join-available-call:enabled");
  assert.ok(await a.locator("#call-panel").isHidden(), "sair da conta não pode autorizar retomada automática");
  assert.equal(getCall(id).callerConn, null);
  await a.locator("#join-available-call").click();
  await a.waitForSelector("#call-panel .call-info.live");
  await a.locator("#toggle-cam.is-off").click();
  await Promise.all([connected(a), connected(b)]);
  assert.equal(await a.evaluate(() => JSON.parse(localStorage.getItem("potato.callResume")).id), id);
  console.log("Sair da conta e relogar mantém a pessoa fora da chamada; só Voltar faz a reentrada.");

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
  await a.waitForSelector("#call-waiting:not(.hidden)");
  assert.ok(await a.locator("#call-timer").isHidden());
  assert.match(await a.locator("#call-waiting-timer").textContent(), /^0[45]:[0-5]\d$/);
  assert.ok(await a.locator("#call-waiting .call-wait-progress").isVisible());
  await a.screenshot({ path: path.join(root, "dist/call-absence-waiting-desktop.png") });
  await b.screenshot({ path: path.join(root, "dist/call-absence-available-mobile.png") });
  await a.setViewportSize({ width: 390, height: 844 });
  await a.screenshot({ path: path.join(root, "dist/call-absence-waiting-mobile.png") });
  await a.setViewportSize({ width: 1100, height: 850 });
  await new Promise((resolve) => setTimeout(resolve, 1800));
  assert.equal(getCall(id).calleeConn, null, "sair não deve reentrar imediatamente na mesma página");
  assert.equal(getCall(id).waitingUntil, deadline, "polling e consultas não renovam o prazo de espera");
  await b.reload();
  await b.waitForSelector("#join-available-call:enabled");
  assert.ok(await b.locator("#call-panel").isHidden());
  assert.equal(getCall(id).calleeConn, null, "sair e recarregar não pode reentrar");
  assert.equal(getCall(id).waitingUntil, deadline);
  await b.evaluate((id) => localStorage.setItem("potato.callResume", JSON.stringify({ id, account: "Beto", mic: false, cam: true })), id);
  await b.reload();
  await b.waitForSelector("#join-available-call:enabled");
  assert.ok(await b.locator("#call-panel").isHidden(), "registro antigo sem chamada ativa não autoriza retomada");
  assert.equal(getCall(id).calleeConn, null);
  await b.evaluate(() => document.querySelector("[data-logout]").click());
  await b.waitForSelector("#login-view:not(.hidden)");
  await b.locator("#name").fill("Beto");
  await b.locator("#password").fill("teste-call-1234");
  await b.locator("#login-form .primary").click();
  await b.waitForSelector("#join-available-call:enabled");
  assert.ok(await b.locator("#call-panel").isHidden(), "Sair da chamada e relogar deve continuar fora");
  assert.equal(getCall(id).calleeConn, null);
  await b.locator("#join-available-call").click();
  await b.waitForSelector("#call-panel .call-info.live");
  await b.locator("#toggle-cam.is-off").click();
  await Promise.all([connected(a), connected(b)]);
  assert.equal(getCall(id).waitingUntil, null);
  assert.ok(await a.locator("#call-waiting").isHidden());
  console.log("Saída voluntária, reload, registro antigo e relogin não entram sozinhos; Voltar cancela a ausência e o contador.");

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
  await b.locator("#end-call").click();
  await until(() => getCall(id) === null);
  await Promise.all([a.waitForSelector("#available-call", { state: "hidden" }), b.waitForSelector("#available-call", { state: "hidden" })]);
  await a.reload();
  await a.waitForSelector("#emoji-panel", { state: "attached" });
  assert.ok(await a.locator("#call-panel").isHidden());
  assert.ok(await a.locator("#available-call").isHidden(), "sala vazia não reaparece ao recarregar");
  assert.equal(php(`query("SELECT COUNT(*) FROM " . t('messages') . " WHERE source = 'call'")->fetchColumn()`), 1);
  console.log("A última pessoa saiu: sala removida imediatamente e nenhuma reentrada automática em sala vazia.");

  await a.locator("#video-call").click();
  await b.waitForSelector("#incoming:not(.hidden)");
  await b.locator("#accept-call").click({ force: true });
  await Promise.all([connected(a), connected(b)]);
  const waitingId = await a.evaluate(() => JSON.parse(localStorage.getItem("potato.callResume")).id);
  assert.notEqual(waitingId, id);
  await a.locator("#end-call").click();
  await until(() => getCall(waitingId).callerConn === null);
  expire(waitingId);
  await Promise.all([a.waitForSelector("#available-call", { state: "hidden" }), b.waitForSelector("#call-panel", { state: "hidden" })]);
  assert.equal(getCall(waitingId), null, "uma pessoa esperando ainda respeita o prazo de cinco minutos");
  await a.locator("#audio-call").click();
  await b.waitForSelector("#incoming:not(.hidden)");
  const newId = await a.evaluate(() => JSON.parse(localStorage.getItem("potato.callResume")).id);
  assert.notEqual(newId, id);
  assert.equal(getCall(newId).calleeConn, null, "uma chamada nova exige atendimento, sem entrada automática");
  expire(newId);
  await b.waitForSelector("#incoming", { state: "hidden" });
  assert.deepEqual(errors, []);
  console.log("Reentrada manual, encerramento de sala vazia e expiração com uma pessoa esperando aprovados.");
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
