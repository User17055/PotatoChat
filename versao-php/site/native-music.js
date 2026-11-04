// A notificação controla a mesma faixa e a mesma fila que estão abertas no chat.
export function createNativeMusicBridge({ state, control, open }) {
  let lastKey = "", lastSent = 0;
  const enabled = () => Boolean(window.__potatoNativeMusic && window.PotatoAndroid?.postMessage);
  function sync(force = false) {
    if (!enabled()) return;
    const current = state();
    const key = JSON.stringify({ ...current, position: undefined });
    if (!force && key === lastKey && Date.now() - lastSent < 4000) return;
    lastKey = key; lastSent = Date.now();
    window.PotatoAndroid.postMessage(JSON.stringify({ type: "music", ...current }));
  }
  window.potatoMusic = (action, uid, room, value) => {
    if (!enabled()) return;
    const current = state();
    if (!current.active || current.uid !== uid || current.room !== room) return;
    if (action === "open") open();
    else if (["play", "pause", "previous", "next", "mute", "stop"].includes(action)) control(action);
    else if (action === "seek" && Number.isFinite(value)) control(action, Math.max(0, Math.min(value, current.duration || 86400)));
    else return;
    sync(true);
  };
  window.addEventListener("potato-music-ready", () => sync(true));
  return { sync, enabled };
}
