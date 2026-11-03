// Teste opcional com TURN real: TURN_URLS + TURN_SECRET (ou usuário/senha) no .env.
// PLAYWRIGHT_MODULE pode apontar para playwright-core/index.mjs instalado fora do projeto.
import "dotenv/config";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import http from "node:http";
import { rtcConfig } from "../server/rtc-config.js";

const settings = rtcConfig("potato-relay-test");
assert.ok(settings.turnConfigured, "Configure TURN_URLS e TURN_SECRET antes do teste.");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright-core");
const recovery = await fs.readFile(new URL("../public/rtc-recovery.js", import.meta.url));
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/recovery.js" ? "text/javascript" : "text/html");
  res.end(req.url === "/recovery.js" ? recovery : "<!doctype html><title>Teste TURN</title>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  for (const url of settings.iceServers.at(-1).urls) {
    const result = await page.evaluate(async ({ url, turn }) => {
      const { createRtcRecovery } = await import("/recovery.js");
      const config = { iceTransportPolicy: "relay", iceServers: [{ ...turn, urls: url }] };
      const a = new RTCPeerConnection(config), b = new RTCPeerConnection(config);
      const errors = [];
      a.onicecandidateerror = b.onicecandidateerror = (e) => errors.push(`${e.errorCode}: ${e.errorText}`);
      const canvas = document.createElement("canvas");
      canvas.width = 320; canvas.height = 180;
      const ctx = canvas.getContext("2d");
      const draw = setInterval(() => { ctx.fillStyle = `hsl(${Date.now() % 360},80%,50%)`; ctx.fillRect(0, 0, 320, 180); }, 80);
      const stream = canvas.captureStream(12);
      stream.getTracks().forEach((track) => a.addTrack(track, stream));
      const video = document.createElement("video"); video.muted = true; video.autoplay = true;
      b.ontrack = ({ track }) => { video.srcObject = new MediaStream([track]); video.play(); };
      const channel = a.createDataChannel("probe");
      b.ondatachannel = ({ channel }) => { channel.onmessage = ({ data }) => channel.send(data); };
      const until = async (check, ms = 25000) => {
        const end = Date.now() + ms;
        while (!await check()) { if (Date.now() > end) throw new Error(`Timeout: ${a.connectionState}/${b.connectionState}; ${errors.join('; ')}`); await new Promise((r) => setTimeout(r, 100)); }
      };
      let ra, rb;
      try {
        await a.setLocalDescription(await a.createOffer());
        await until(() => a.localDescription.sdp.includes("typ relay"));
        await b.setRemoteDescription(a.localDescription);
        await b.setLocalDescription(await b.createAnswer());
        await until(() => b.localDescription.sdp.includes("typ relay"));
        await a.setRemoteDescription(b.localDescription);
        await until(() => channel.readyState === "open" && video.videoWidth > 0);
        const before = a.localDescription.sdp.match(/a=ice-ufrag:(.*)/)?.[1];
        let failure = "";
        const options = { loadConfig: async () => ({ config }), status: () => {}, failed: () => { failure = "Reconexão falhou"; } };
        ra = createRtcRecovery({ ...options, peer: a, caller: true, send: (m) => setTimeout(() => rb.receive(m), 0) });
        rb = createRtcRecovery({ ...options, peer: b, caller: false, send: (m) => setTimeout(() => ra.receive(m), 0) });
        a.onicecandidate = ({ candidate }) => { if (candidate) b.addIceCandidate(candidate).catch(() => {}); };
        b.onicecandidate = ({ candidate }) => { if (candidate) a.addIceCandidate(candidate).catch(() => {}); };
        await ra.request();
        await until(() => a.signalingState === "stable" && a.connectionState === "connected" && before !== a.localDescription.sdp.match(/a=ice-ufrag:(.*)/)?.[1]);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Dados não passaram pelo relay após restart")), 8000);
          channel.onmessage = ({ data }) => { if (data === "potato") { clearTimeout(timer); resolve(); } };
          channel.send("potato");
        });
        const stats = await a.getStats();
        const transport = [...stats.values()].find((s) => s.type === "transport" && s.selectedCandidatePairId);
        const pair = stats.get(transport.selectedCandidatePairId);
        const local = stats.get(pair.localCandidateId), remote = stats.get(pair.remoteCandidateId);
        const incoming = [...(await b.getStats()).values()].find((s) => s.type === "inbound-rtp" && s.kind === "video");
        return { local: local.candidateType, remote: remote.candidateType, protocol: local.relayProtocol, frames: incoming?.framesDecoded || 0, restarted: before !== a.localDescription.sdp.match(/a=ice-ufrag:(.*)/)?.[1], failure };
      } finally {
        ra?.close(); rb?.close(); a.close(); b.close(); clearInterval(draw); stream.getTracks().forEach((t) => t.stop());
      }
    }, { url, turn: rtcConfig(`potato-relay-test-${url}`).iceServers.at(-1) });
    assert.equal(result.local, "relay"); assert.equal(result.remote, "relay");
    assert.ok(result.frames > 0); assert.ok(result.restarted); assert.equal(result.failure, "");
    console.log(`TURN ${url.startsWith("turns:") ? "TLS" : url.includes("tcp") ? "TCP" : "UDP"}: vídeo (${result.frames} frames), dados e ICE restart aprovados; relay ${result.protocol}.`);
  }
} finally { await browser.close(); server.close(); }
