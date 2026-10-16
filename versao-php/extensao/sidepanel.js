const frame = document.querySelector("#chat");
const error = document.querySelector("#error");
const statusDot = document.querySelector("#status");
let siteOrigin = "";

// Fecha o painel na hora (atalho, Esc ou botão de esconder).
function hide() {
  frame.src = "about:blank";
  window.close();
}

// Mantém o serviço de fundo sabendo em qual janela o painel está aberto (reconecta se ele reiniciar).
function keepPort(windowId) {
  const port = chrome.runtime.connect({ name: `sidepanel:${windowId}` });
  port.onMessage.addListener((message) => { if (message?.type === "hide") hide(); });
  port.onDisconnect.addListener(() => setTimeout(() => keepPort(windowId), 500));
}
chrome.windows.getCurrent().then((win) => keepPort(win.id));

document.querySelector("#hide").addEventListener("click", hide);
document.addEventListener("keydown", (event) => { if (event.key === "Escape") hide(); });

chrome.storage.sync.get({ siteUrl: "http://localhost:8000" }, ({ siteUrl }) => {
  try {
    const url = new URL(siteUrl);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    siteOrigin = url.origin;
    const page = `${url.origin}${url.pathname.replace(/\/+$/, "")}/`;
    frame.src = page;
    document.querySelector("#open-tab").href = page;
  } catch {
    frame.hidden = true;
    error.hidden = false;
  }
});

function post(message) {
  frame.contentWindow?.postMessage(message, siteOrigin);
}

// Ponte com o site: compartilha a sessão para não pedir a senha a cada abertura do painel.
window.addEventListener("message", async (event) => {
  if (event.source !== frame.contentWindow || event.origin !== siteOrigin) return;
  const data = event.data || {};
  if (data.source !== "potato-site") return;

  if (data.type === "potato:ready") {
    const { session } = await chrome.storage.local.get("session");
    if (session) post({ type: "potato:session", ...session });
  }
  if (data.type === "potato:session" && data.token) {
    await chrome.storage.local.set({ session: { token: data.token, name: data.name } });
  }
  if (data.type === "potato:hide") hide();
  if (data.type === "potato:logout") {
    await chrome.storage.local.remove("session");
  }
});

async function paintStatus() {
  const { session } = await chrome.storage.local.get("session");
  statusDot.classList.toggle("on", Boolean(session));
  statusDot.title = session ? `Conectado como ${session.name}` : "Não conectado";
}
chrome.storage.onChanged.addListener((changes) => { if (changes.session) paintStatus(); });
paintStatus();

frame.addEventListener("error", () => { error.hidden = false; });
for (const id of ["#settings", "#error-settings"]) {
  document.querySelector(id).addEventListener("click", () => chrome.runtime.openOptionsPage());
}
