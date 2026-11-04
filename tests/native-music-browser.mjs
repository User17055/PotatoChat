// Ponte Android simulada; PHP/MySQL, fila, comandos e reprodução de áudio reais.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = path.join(root, "versao-php/site"), base = "http://127.0.0.1:8323";
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "potato-media-")), config = path.join(temp, "config.php");
const prefix = `mediaui${Date.now().toString(36)}_`;
const literal = (value) => typeof value === "string" ? `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`
  : typeof value === "boolean" ? value ? "true" : "false" : typeof value === "number" ? String(value)
  : `[${Object.entries(value).map(([key, item]) => `${literal(key)}=>${literal(item)}`).join(",")}]`;
const db = { host: "127.0.0.1", port: Number(process.env.POTATO_TEST_DB_PORT || 3399), name: process.env.POTATO_TEST_DB_NAME || "potato_teste",
  user: process.env.POTATO_TEST_DB_USER || "potato", pass: process.env.POTATO_TEST_DB_PASS || "senha-teste", prefix };
await fs.writeFile(config, `<?php return ${literal({ db, token_secret: "segredo-media-teste", poll_wait: 0, music_lookup: false })};`);
const env = { ...process.env, POTATO_CONFIG: config }, phpArgs = ["-d", "extension=pdo_mysql"];
const php = (expression) => JSON.parse(execFileSync("php", [...phpArgs, "-r", `require ${literal(path.join(site, "lib/potato.php"))}; echo json_encode(${expression});`], { env }).toString());
const server = spawn("php", [...phpArgs, "-S", "127.0.0.1:8323", "-t", site], { env, stdio: "ignore" });
const until = async (check) => { const end = Date.now() + 15000; while (!await check()) { if (Date.now() > end) throw new Error("Timeout no teste de mídia"); await new Promise((r) => setTimeout(r, 100)); } };
const wave = Buffer.alloc(44 + 8000 * 2 * 30);
wave.write("RIFF"); wave.writeUInt32LE(wave.length - 8, 4); wave.write("WAVEfmt ", 8); wave.writeUInt32LE(16, 16);
wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22); wave.writeUInt32LE(8000, 24); wave.writeUInt32LE(16000, 28);
wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write("data", 36); wave.writeUInt32LE(wave.length - 44, 40);
for (let n = 0; n < (wave.length - 44) / 2; n++) wave.writeInt16LE(Math.round(Math.sin(n * Math.PI * 440 / 4000) * 1200), 44 + n * 2);
let browser;
try {
  await until(async () => { try { return (await fetch(base + "/api.php?action=health")).ok; } catch { return false; } });
  const accounts = [];
  for (const name of ["Ana", "Beto"]) accounts.push(await (await fetch(base + "/api.php?action=login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, password: "teste-media", confirm: "teste-media" }) })).json());
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright-core");
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 Android PotatoChatAndroid/3.0" });
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/^https:\/\//, (route) => route.abort());
  await page.route(base + "/music-test.wav", (route) => route.fulfill({ contentType: "audio/wav", body: wave }));
  await page.addInitScript((account) => {
    localStorage.setItem("potato.session", JSON.stringify(account));
    window.__potatoNativeMusic = true; window.__nativeMessages = [];
    window.PotatoAndroid = { postMessage(raw) { window.__nativeMessages.push(JSON.parse(raw)); } };
  }, { name: accounts[0].name, token: accounts[0].token });
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector("#room-title").textContent !== "Aguardando alguém");
  const room = php("room_between('Ana','Beto')['id']");
  php(`transaction(fn() => music_act(['name'=>'Ana','room'=>['id'=>${literal(room)}]], ['op'=>'play'], ['uid'=>'media-one','source'=>'local','type'=>'track','id'=>'yt_Erd8iIS7X8Y','title'=>'Música de teste','artist'=>'Artista','duration'=>30,'url'=>${literal(base + "/music-test.wav")},'origin'=>['source'=>'youtube','type'=>'video','id'=>'Erd8iIS7X8Y']]))`);
  const state = () => page.evaluate(() => window.__nativeMessages.filter((m) => m.type === "music").at(-1));
  await page.waitForFunction(() => window.__nativeMessages.filter((m) => m.type === "music").at(-1)?.playing);
  assert.equal((await state()).title, "Música de teste");
  const act = (action, value, uid = "media-one") => page.evaluate(({ action, value, uid, room }) => window.potatoMusic(action, uid, room, value), { action, value, uid, room });
  await act("pause");
  await until(async () => { const s = await state(); return !s.playing && !s.buffering; });
  assert.equal(php(`music_state(${literal(room)})`).playing, false);
  await act("seek", 12);
  await until(() => php(`music_state(${literal(room)})`).position === 12);
  await act("mute"); await until(async () => (await state()).muted);
  assert.equal(await page.locator("#music-volume").inputValue(), "0");
  await act("mute"); await until(async () => !(await state()).muted);
  await act("play"); await until(async () => (await state()).playing);
  await act("stop", undefined, "old-track");
  assert.equal(php(`music_state(${literal(room)})`).playing, true);
  await act("stop"); await until(async () => (await state()).active === false);
  assert.equal(php(`music_state(${literal(room)})`).now, null);
  await act("play"); assert.equal(php(`music_state(${literal(room)})`).now, null);
  assert.deepEqual(errors, []);
  console.log("App Android: metadados, áudio real, pausa, retomada, posição, mudo local, parar e proteção contra aviso antigo aprovados.");
} finally {
  await browser?.close(); server.kill();
  try { php(`(function() { foreach(query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN) as $table) { if(strpos($table,'${prefix}')===0) query('DROP TABLE '.$table); } return true; })()`); } catch {}
  await fs.unlink(config).catch(() => {});
  await fs.rmdir(temp).catch(() => {});
}
