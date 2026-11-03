// A captura fica no serviço Android. Esta conexão WebRTC é local ao aparelho e entrega
// uma MediaStreamTrack real à chamada existente, sem imagens em base64 nem servidor intermediário.
export const nativeScreenAvailable = () => Boolean(window.__potatoScreenCapture && window.PotatoAndroid);
let session = null;
const send = (message) => window.PotatoAndroid?.postMessage(JSON.stringify(message));

export function stopNativeScreen() {
  const active = session;
  if (!active) return;
  session = null;
  clearTimeout(active.timer);
  active.peer.close();
  active.stream.getTracks().forEach((track) => track.stop());
  active.reject(new DOMException("Captura encerrada.", "AbortError"));
  send({ type: "screen-stop", id: active.id });
}

export async function startNativeScreen(quality) {
  stopNativeScreen();
  const peer = new RTCPeerConnection({ iceServers: [] });
  const active = { id: crypto.randomUUID(), peer, stream: new MediaStream() };
  session = active;
  const result = new Promise((resolve, reject) => { active.resolve = resolve; active.reject = reject; });
  // Anexar o handler imediatamente: erros antes do await não viram rejeições não tratadas.
  result.catch(() => {});
  active.timer = setTimeout(() => finish(active, "A captura demorou para iniciar. Tente novamente."), 90000);
  peer.ontrack = ({ track }) => {
    if (session !== active) return;
    active.stream.addTrack(track);
    clearTimeout(active.timer);
    active.resolve(active.stream);
  };
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === "failed") finish(active, "A captura da tela foi interrompida.");
  };
  try {
    peer.addTransceiver("video", { direction: "recvonly" });
    await peer.setLocalDescription(await peer.createOffer());
    await new Promise((resolve) => {
      if (peer.iceGatheringState === "complete") return resolve();
      const done = () => { clearTimeout(timer); peer.removeEventListener("icegatheringstatechange", changed); resolve(); };
      const changed = () => { if (peer.iceGatheringState === "complete") done(); };
      const timer = setTimeout(done, 3000);
      peer.addEventListener("icegatheringstatechange", changed);
    });
    if (session !== active) throw new DOMException("Captura cancelada.", "AbortError");
    send({ type: "screen-start", id: active.id, sdp: peer.localDescription.sdp, height: quality.height, fps: quality.frameRate });
    return await result;
  } catch (error) {
    if (session === active) stopNativeScreen();
    throw error;
  }
}

function finish(active, message) {
  if (session !== active) return;
  const tracks = active.stream.getTracks();
  active.reject(new Error(message || "Captura encerrada."));
  stopNativeScreen();
  // MediaStreamTrack.stop() não emite ended; a UI também precisa saber que o Android parou a projeção.
  tracks.forEach((track) => track.dispatchEvent(new Event("ended")));
}

window.addEventListener("potato-screen", async ({ detail }) => {
  const active = session;
  if (!active || detail?.id !== active.id) return;
  if (detail.event === "answer") {
    try { await active.peer.setRemoteDescription({ type: "answer", sdp: detail.value }); }
    catch { finish(active, "Não foi possível conectar a captura à chamada."); }
  } else if (detail.event === "error" || detail.event === "stopped") finish(active, detail.value);
});
