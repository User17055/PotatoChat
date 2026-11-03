// Só quem ligou cria ofertas de ICE restart. Isso evita ofertas simultâneas ao trocar de Wi-Fi/4G.
export function createRtcRecovery({ peer, caller, send, loadConfig, status, failed, remoteReady = async () => {}, retryMs = 12000, graceMs = 120000 }) {
  let closed = false, busy = false, retry = null, deadline = null, refresh = null;
  let serial = 0, waiting = null;
  const connected = () => peer.connectionState === "connected" || peer.iceConnectionState === "connected" || peer.iceConnectionState === "completed";
  const live = () => !closed && peer.signalingState !== "closed";

  async function configure() {
    const settings = await loadConfig();
    if (!live()) return;
    peer.setConfiguration(settings.config);
    clearTimeout(refresh);
    if (settings.expiresAt) refresh = setTimeout(() => request(), Math.max(30000, (settings.expiresAt - Date.now()) * 0.75));
  }

  function arm() {
    if (!deadline) deadline = setTimeout(() => { if (live() && (!connected() || waiting)) { close(); failed(); } }, graceMs);
    clearTimeout(retry);
    retry = setTimeout(() => request(), retryMs);
  }

  async function request() {
    if (!live() || !peer.remoteDescription) return;
    status("Reconectando a chamada…");
    arm();
    if (busy) return;
    if (!caller) { send({ kind: "request" }); return; }
    busy = true;
    try {
      // Reenviar a mesma oferta se a sinalização perdeu a resposta.
      if (peer.signalingState === "have-local-offer" && waiting) { send(waiting); return; }
      if (peer.signalingState !== "stable") return;
      await configure();
      if (!live()) return;
      const description = await peer.createOffer({ iceRestart: true });
      if (!live()) return;
      await peer.setLocalDescription(description);
      if (!live()) return;
      waiting = { kind: "offer", serial: ++serial, description: peer.localDescription };
      send(waiting);
    } catch { /* O próximo ciclo tenta de novo, inclusive se o servidor está offline. */ }
    finally { busy = false; }
  }

  let lastAnswer = null;
  async function receive(message) {
    if (!live()) return;
    if (message.kind === "request") { if (caller) request(); return; }
    if (busy) return;
    busy = true;
    try {
      if (!caller && message.kind === "offer" && message.description?.type === "offer") {
        if (lastAnswer?.serial === message.serial) { send(lastAnswer); return; }
        arm();
        await configure();
        if (!live()) return;
        await peer.setRemoteDescription(message.description);
        await remoteReady();
        await peer.setLocalDescription(await peer.createAnswer());
        if (!live()) return;
        lastAnswer = { kind: "answer", serial: message.serial, description: peer.localDescription };
        send(lastAnswer);
        stateChanged();
      } else if (caller && message.kind === "answer" && message.serial === waiting?.serial && peer.signalingState === "have-local-offer") {
        await peer.setRemoteDescription(message.description);
        await remoteReady();
        waiting = null;
        stateChanged();
      }
    } catch { arm(); }
    finally { busy = false; }
  }

  function stateChanged() {
    if (!live()) return;
    if (connected() && !waiting && peer.signalingState === "stable") {
      clearTimeout(retry); retry = null;
      clearTimeout(deadline); deadline = null;
      status(null);
    } else if (peer.connectionState === "failed" || peer.iceConnectionState === "failed") request();
    else if (peer.connectionState === "disconnected" || peer.iceConnectionState === "disconnected") {
      status("Conexão instável · tentando reconectar…");
      if (!retry) retry = setTimeout(request, 2500);
    }
  }
  function close() {
    closed = true;
    [retry, deadline, refresh].forEach(clearTimeout);
    peer.removeEventListener("connectionstatechange", stateChanged);
    peer.removeEventListener("iceconnectionstatechange", stateChanged);
  }
  peer.addEventListener("connectionstatechange", stateChanged);
  peer.addEventListener("iceconnectionstatechange", stateChanged);
  return { request, receive, close, configure };
}
