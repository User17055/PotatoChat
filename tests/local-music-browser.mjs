// Reproduz áudio real pelo player compartilhado, sem embeds ou serviços externos.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const wave = Buffer.alloc(44 + 8000 * 2 * 30);
wave.write("RIFF"); wave.writeUInt32LE(wave.length - 8, 4); wave.write("WAVEfmt ", 8);
wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(8000, 24); wave.writeUInt32LE(16000, 28); wave.writeUInt16LE(2, 32);
wave.writeUInt16LE(16, 34); wave.write("data", 36); wave.writeUInt32LE(wave.length - 44, 40);
for (let n = 0; n < (wave.length - 44) / 2; n++) wave.writeInt16LE(Math.round(Math.sin(n * Math.PI * 440 / 4000) * 1200), 44 + n * 2);
const module = await readFile(new URL("../versao-php/site/music.js", import.meta.url));
const server = createServer((req, res) => {
  if (req.url === "/music.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(module); }
  else if (req.url.startsWith("/audio.wav")) {
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), wave.length - 1) : wave.length - 1;
    res.writeHead(range ? 206 : 200, { "Content-Type": "audio/wav", "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes", ...(range ? { "Content-Range": `bytes ${start}-${end}/${wave.length}` } : {}) });
    res.end(wave.subarray(start, end + 1));
  }
  else { res.writeHead(200, { "Content-Type": "text/html" }); res.end('<div id="player"></div>'); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright-core");
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined,
    args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    const { createPlayer } = await import("/music.js");
    window.ended = []; window.failures = [];
    window.player = createPlayer(document.querySelector("#player"), { onEnded: (uid) => ended.push(uid), onError: (uid, message) => failures.push({ uid, message }) });
    player.setVolume(30);
    await player.open({ source: "local", uid: "one", id: "first", url: "/audio.wav" }, () => 1, () => true);
  });
  await page.waitForFunction(() => player.ready && player.playing() && player.time() > 1).catch(async (error) => {
    console.error(await page.evaluate(() => ({ ready: player.ready, kind: player.kind, time: player.time(), failures,
      audio: [...document.querySelectorAll("audio")].map((audio) => ({ readyState: audio.readyState, error: audio.error?.message, paused: audio.paused, src: audio.currentSrc })) })));
    throw error;
  });
  assert.equal(await page.evaluate(() => player.duration()), 30);
  assert.equal(await page.locator("audio").evaluate((audio) => audio.volume), 0.3);
  await page.evaluate(() => player.pause());
  assert.equal(await page.evaluate(() => player.playing()), false);
  await page.evaluate(() => player.seek(2));
  await page.waitForFunction(() => Math.abs(player.time() - 2) < 0.1);
  await page.evaluate(() => { window.oldAudio = document.querySelector("audio"); player.open({ source: "local", uid: "two", id: "second", url: "/audio.wav?second" }, () => 0, () => false); });
  await page.waitForFunction(() => player.ready && player.uid === "two");
  assert.equal(await page.evaluate(() => oldAudio.paused && !oldAudio.hasAttribute("src")), true);
  await page.evaluate(() => { oldAudio.dispatchEvent(new Event("ended")); oldAudio.dispatchEvent(new Event("error")); player.seek(29.7); player.play(); });
  await page.waitForFunction(() => ended.includes("two"));
  assert.deepEqual(await page.evaluate(() => ended), ["two"]);
  assert.deepEqual(await page.evaluate(() => failures), []);
  await page.evaluate(() => player.destroy());
  assert.equal(await page.locator("audio").count(), 0);
  assert.deepEqual(errors, []);
  console.log("Áudio local real: reprodução, posição, volume, pausa, troca, fim da faixa e descarte aprovados.");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
