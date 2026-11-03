import assert from "node:assert/strict";
import { test } from "node:test";
import crypto from "node:crypto";
import { createRtcRecovery } from "../public/rtc-recovery.js";
import { createRtcConfigLoader } from "../public/rtc-config.js";
import { rtcConfig } from "../server/rtc-config.js";

class Peer extends EventTarget {
  connectionState = "connected";
  iceConnectionState = "connected";
  signalingState = "stable";
  remoteDescription = { type: "answer", sdp: "initial" };
  offers = 0;
  setConfiguration(config) { this.config = config; }
  async createOffer(options) { assert.equal(options.iceRestart, true); return { type: "offer", sdp: `restart-${++this.offers}` }; }
  async createAnswer() { return { type: "answer", sdp: "recovered" }; }
  async setLocalDescription(description) { this.localDescription = description; this.signalingState = description.type === "offer" ? "have-local-offer" : "stable"; }
  async setRemoteDescription(description) { this.remoteDescription = description; this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable"; }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const options = (peer, extra = {}) => ({ peer, caller: true, send() {}, loadConfig: async () => ({ config: { iceServers: [] } }), status() {}, failed() { assert.fail("A chamada não deve acabar durante a recuperação"); }, ...extra });

test("credenciais TURN são temporárias, assinadas e não expõem o segredo", () => {
  const result = rtcConfig("Pessoa", { TURN_URLS: "turn:turn.example:3478?transport=udp,turns:turn.example:5349?transport=tcp", TURN_SECRET: "segredo-teste", TURN_TTL: "600", TURN_ONLY: "true" }, 1700000000000);
  const turn = result.iceServers.at(-1);
  assert.equal(result.expiresAt, 1700000600000);
  assert.equal(result.iceTransportPolicy, "relay");
  assert.equal(turn.credential, crypto.createHmac("sha1", "segredo-teste").update(turn.username).digest("base64"));
  assert.ok(!JSON.stringify(result).includes("segredo-teste"));
  assert.equal(rtcConfig("Pessoa", {}).turnConfigured, false);
  assert.equal(rtcConfig("Pessoa", { TURN_URLS: "https://example.com", TURN_SECRET: "x" }).iceTransportPolicy, "all");
});

test("troca de rede renova ICE, mantém o peer e reenvia oferta perdida sem criar outra", async () => {
  const peer = new Peer(), sent = [];
  let flushed = 0;
  const recovery = createRtcRecovery(options(peer, { send: (message) => sent.push(message), remoteReady: async () => { flushed++; } }));
  try {
    await recovery.request();
    assert.equal(peer.offers, 1);
    await recovery.request();
    assert.equal(peer.offers, 1);
    assert.equal(sent[0], sent[1]);
    await recovery.receive({ kind: "answer", serial: 999, description: { type: "answer", sdp: "wrong" } });
    assert.equal(peer.signalingState, "have-local-offer");
    await recovery.receive({ kind: "answer", serial: sent[0].serial, description: { type: "answer", sdp: "recovered" } });
    assert.equal(peer.signalingState, "stable");
    assert.equal(flushed, 1);
    await recovery.request();
    assert.equal(peer.offers, 2);
  } finally { recovery.close(); }
});

test("quem atende pede restart a quem ligou e responde ofertas duplicadas sem colisão", async () => {
  const peer = new Peer(), sent = [];
  const recovery = createRtcRecovery(options(peer, { caller: false, send: (message) => sent.push(message) }));
  try {
    await recovery.request();
    assert.equal(sent[0].kind, "request");
    assert.equal(peer.offers, 0);
    const offer = { kind: "offer", serial: 1, description: { type: "offer", sdp: "restart" } };
    await recovery.receive(offer);
    await recovery.receive(offer);
    assert.equal(sent[1], sent[2]);
    assert.equal(peer.signalingState, "stable");
  } finally { recovery.close(); }
});

test("uma falha inicia recuperação e só encerra após esgotar o prazo", async () => {
  const peer = new Peer(); peer.connectionState = peer.iceConnectionState = "failed";
  let ended = 0;
  const recovery = createRtcRecovery(options(peer, { graceMs: 40, retryMs: 10, failed: () => ended++ }));
  peer.dispatchEvent(new Event("connectionstatechange"));
  await tick();
  assert.equal(ended, 0);
  assert.equal(peer.offers, 1);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(ended, 1);
  recovery.close();
});

test("falha temporária da API preserva o TURN anteriormente recebido", async () => {
  const original = globalThis.fetch;
  let failing = false;
  globalThis.fetch = async () => {
    if (failing) throw new Error("offline");
    return { ok: true, json: async () => ({ iceServers: [{ urls: "turn:example:3478", username: "a", credential: "b" }], turnConfigured: true }) };
  };
  try {
    const load = createRtcConfigLoader("http://localhost/rtc", () => "token");
    const first = await load(); failing = true;
    assert.deepEqual(await load(), first);
  } finally { globalThis.fetch = original; }
});

test("ponte Android encerra as faixas quando o sistema para a projeção e ignora respostas antigas", async () => {
  const originals = Object.fromEntries(["window", "RTCPeerConnection", "MediaStream"].map((key) => [key, globalThis[key]]));
  const messages = [];
  globalThis.window = Object.assign(new EventTarget(), { __potatoScreenCapture: true, PotatoAndroid: { postMessage: (raw) => messages.push(JSON.parse(raw)) } });
  class Track extends EventTarget { constructor(kind = "video") { super(); this.kind = kind; } stop() { this.stopped = true; } }
  class NativePeer extends EventTarget {
    iceGatheringState = "complete";
    kinds = [];
    addTransceiver(kind) { this.kinds.push(kind); }
    async createOffer() { return { type: "offer", sdp: "local-only" }; }
    async setLocalDescription(description) { this.localDescription = description; }
    async setRemoteDescription() {
      for (const kind of this.kinds) {
        if (kind === "audio" && this.noAudio) continue;
        if (kind === "audio") await tick(); // Vídeo chega primeiro: a stream não pode ser entregue antes do áudio.
        this.ontrack({ track: new Track(kind) });
      }
    }
    close() { this.closed = true; }
  }
  globalThis.RTCPeerConnection = NativePeer;
  globalThis.MediaStream = class { tracks = []; addTrack(track) { this.tracks.push(track); } getTracks() { return this.tracks; } };
  const bridge = await import("../public/native-screen.js");
  const native = (id, event, value = "") => window.dispatchEvent(new CustomEvent("potato-screen", { detail: { id, event, value } }));
  try {
    const first = bridge.startNativeScreen({ height: 720, frameRate: 30 });
    await tick();
    const request = messages.find((item) => item.type === "screen-start");
    native(request.id, "answer", "answer");
    const stream = await first;
    let ended = 0;
    stream.getTracks()[0].addEventListener("ended", () => ended++);
    native(request.id, "stopped");
    assert.equal(ended, 1);
    assert.equal(stream.getTracks()[0].stopped, true);
    const second = bridge.startNativeScreen({ height: 1080, frameRate: 30 });
    await tick();
    const current = messages.filter((item) => item.type === "screen-start").at(-1);
    native(request.id, "stopped"); // A sessão anterior não pode parar a nova.
    native(current.id, "answer", "answer");
    assert.equal((await second).getTracks()[0].stopped, undefined);
    bridge.stopNativeScreen();
    window.__potatoScreenAudio = true;
    const withAudio = bridge.startNativeScreen({ height: 1080, frameRate: 30 }, true);
    await tick();
    const audioRequest = messages.filter((item) => item.type === "screen-start").at(-1);
    assert.equal(audioRequest.audio, true);
    window.dispatchEvent(new CustomEvent("potato-screen", { detail: { id: audioRequest.id, event: "answer", value: "answer", audio: true } }));
    assert.deepEqual((await withAudio).getTracks().map((track) => track.kind), ["video", "audio"]);
    bridge.stopNativeScreen();
    const videoOnly = bridge.startNativeScreen({ height: 720, frameRate: 30 }, false);
    await tick();
    const silentRequest = messages.filter((item) => item.type === "screen-start").at(-1);
    assert.equal(silentRequest.audio, false);
    native(silentRequest.id, "answer", "answer");
    assert.deepEqual((await videoOnly).getTracks().map((track) => track.kind), ["video"]);
    bridge.stopNativeScreen();
    const canceled = bridge.startNativeScreen({ height: 720, frameRate: 30 });
    await tick();
    bridge.stopNativeScreen();
    await assert.rejects(canceled, { name: "AbortError" });
  } finally {
    bridge.stopNativeScreen();
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
