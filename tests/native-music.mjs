import assert from "node:assert/strict";
import test from "node:test";
import { createNativeMusicBridge } from "../versao-php/site/native-music.js";

test("notificação acompanha a faixa e ignora comandos antigos ou de outra sala", () => {
  const sent = [], actions = [], listeners = new Map();
  globalThis.window = { __potatoNativeMusic: true, PotatoAndroid: { postMessage: (raw) => sent.push(JSON.parse(raw)) },
    addEventListener: (name, callback) => listeners.set(name, callback) };
  let state = { active: true, uid: "one", room: "room", title: "Música", position: 12, duration: 180, playing: true, muted: false };
  const bridge = createNativeMusicBridge({ state: () => state, open: () => actions.push("open"), control: (op, value) => actions.push([op, value]) });
  bridge.sync();
  assert.equal(sent[0].title, "Música");
  state.position = 13;
  bridge.sync();
  assert.equal(sent.length, 1, "progresso não recria a notificação a cada evento do áudio");
  state.playing = false;
  bridge.sync();
  assert.equal(sent.at(-1).playing, false);
  for (const action of ["play", "pause", "next", "previous", "mute", "stop", "open"]) {
    window.potatoMusic(action, "old", "room");
    window.potatoMusic(action, "one", "other-room");
  }
  assert.deepEqual(actions, []);
  for (const action of ["play", "pause", "next", "previous", "mute", "stop"]) window.potatoMusic(action, "one", "room");
  assert.deepEqual(actions.map(([op]) => op), ["play", "pause", "next", "previous", "mute", "stop"]);
  window.potatoMusic("seek", "one", "room", 999);
  assert.deepEqual(actions.at(-1), ["seek", 180]);
  window.potatoMusic("open", "one", "room");
  assert.equal(actions.at(-1), "open");
  const before = actions.length;
  state = { active: false };
  bridge.sync();
  window.potatoMusic("play", "one", "room");
  assert.equal(actions.length, before);
  assert.equal(sent.at(-1).active, false);
  listeners.get("potato-music-ready")();
  assert.equal(sent.at(-1).active, false);
  delete globalThis.window;
});
