export const defaultRtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] };

export function createRtcConfigLoader(url, token) {
  let previous = null;
  return async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token() }), cache: "no-store", signal: controller.signal
      });
      if (!response.ok) throw new Error("Configuração de chamada indisponível");
      const data = await response.json();
      if (!Array.isArray(data.iceServers) || !data.iceServers.length) throw new Error("Servidores ICE ausentes");
      previous = { config: { iceServers: data.iceServers, iceTransportPolicy: data.iceTransportPolicy === "relay" ? "relay" : "all" }, expiresAt: Number(data.expiresAt) || 0, turnConfigured: Boolean(data.turnConfigured) };
      return previous;
    } catch {
      // Uma falha temporária da API não deve impedir uma chamada direta já possível na rede atual.
      return previous || { config: defaultRtcConfig, expiresAt: 0, turnConfigured: false };
    } finally { clearTimeout(timeout); }
  };
}
