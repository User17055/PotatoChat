import { io } from "./vendor/socket.io.esm.min.js";

// Serviço de fundo: mantém uma conexão própria com o chat para
// enviar mensagens (menu de contexto, barra de endereço) e avisar quando chegar algo novo.

const DEFAULT_URL = "http://localhost:3000";
const MENU = {
  selection: "potato-selection",
  link: "potato-link",
  image: "potato-image",
  page: "potato-page"
};

let socket = null;
let socketKey = "";
let me = "";
const panels = new Map(); // porta do painel → id da janela

const settings = () => chrome.storage.sync.get({ siteUrl: DEFAULT_URL, notify: true });
// A sessão fica em storage.local: continua logado mesmo depois de fechar o Chrome.
const getSession = async () => (await chrome.storage.local.get("session")).session || null;

async function setBadge(text, color = "#f5c04f") {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
}

async function bumpUnread() {
  const { unread = 0 } = await chrome.storage.session.get("unread");
  await chrome.storage.session.set({ unread: unread + 1 });
  await setBadge(String(Math.min(unread + 1, 99)));
}

async function clearUnread() {
  await chrome.storage.session.set({ unread: 0 });
  await setBadge("");
}

async function ensureSocket() {
  const [{ siteUrl }, session] = await Promise.all([settings(), getSession()]);
  const key = session ? `${siteUrl}|${session.name}` : "";
  if (socket && key === socketKey) return socket;
  socket?.disconnect();
  socket = null;
  socketKey = key;
  if (!session) return null;

  me = session.name;
  socket = io(siteUrl, {
    auth: { token: session.token, client: "extension" },
    transports: ["websocket"],
    reconnectionDelayMax: 15000
  });
  socket.on("connect", flushOutbox);
  socket.on("message", onMessage);
  socket.on("room-full", () => socket?.disconnect());
  socket.on("session", ({ token, name } = {}) => { if (token) chrome.storage.local.set({ session: { token, name } }); });
  socket.on("connect_error", async (error) => {
    if (/Sessão inválida/.test(error.message)) {
      await chrome.storage.local.remove("session");
      await setBadge("!", "#ff7064");
    }
  });
  return socket;
}

async function siteTabIsActive(siteUrl) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const window = tab ? await chrome.windows.get(tab.windowId) : null;
    return Boolean(window?.focused && tab.url && new URL(tab.url).origin === new URL(siteUrl).origin);
  } catch {
    return false;
  }
}

async function onMessage(message) {
  if (message.sender === me || panels.size) return;
  const { siteUrl, notify } = await settings();
  if (await siteTabIsActive(siteUrl)) return;
  await bumpUnread();
  if (!notify) return;
  chrome.notifications.create(`msg:${message.id}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: message.sender,
    message: message.deleted ? "Mensagem apagada" : message.text.slice(0, 200),
    contextMessage: "Potato Chat",
    priority: 1
  });
}

// ---------- fila de envio ----------

async function enqueue(text) {
  const clean = String(text || "").trim().slice(0, 2000);
  if (!clean) return;
  const { outbox = [] } = await chrome.storage.session.get("outbox");
  outbox.push({ clientId: crypto.randomUUID(), text: clean });
  await chrome.storage.session.set({ outbox });
  const connection = await ensureSocket();
  if (connection?.connected) await flushOutbox();
  else if (!(await getSession())) await setBadge("…");
}

let flushing = false;
async function flushOutbox() {
  if (flushing || !socket?.connected) return;
  flushing = true;
  try {
    const { outbox = [] } = await chrome.storage.session.get("outbox");
    for (const item of outbox) {
      const result = await socket.timeout(10000).emitWithAck("message", item).catch(() => null);
      if (!result?.ok) break;
      const { outbox: current = [] } = await chrome.storage.session.get("outbox");
      await chrome.storage.session.set({ outbox: current.filter((entry) => entry.clientId !== item.clientId) });
      if (!panels.size) {
        chrome.notifications.create(`sent:${item.clientId}`, {
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: "Enviado para o nosso chat ✓",
          message: item.text.slice(0, 160),
          priority: 0,
          silent: true
        });
      }
    }
    const { unread = 0 } = await chrome.storage.session.get("unread");
    if (!unread) await setBadge("");
  } finally {
    flushing = false;
  }
}

function textFrom(info, tab) {
  const title = tab?.title || "";
  const page = info.pageUrl || tab?.url || "";
  if (info.menuItemId === MENU.selection) return `“${info.selectionText.trim()}”\n— ${title}\n${page}`;
  if (info.menuItemId === MENU.link) return info.linkUrl;
  if (info.menuItemId === MENU.image) return /^https?:/.test(info.srcUrl || "") ? info.srcUrl : page;
  return `${title}\n${page}`;
}

// ---------- eventos do Chrome ----------

chrome.runtime.onInstalled.addListener(async () => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
  const { siteUrl } = await chrome.storage.sync.get("siteUrl");
  if (!siteUrl) await chrome.storage.sync.set({ siteUrl: DEFAULT_URL });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU.selection, title: "Enviar “%s” para o nosso chat", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MENU.link, title: "Enviar link para o nosso chat", contexts: ["link"] });
    chrome.contextMenus.create({ id: MENU.image, title: "Enviar imagem para o nosso chat", contexts: ["image"] });
    chrome.contextMenus.create({ id: MENU.page, title: "Enviar esta página para o nosso chat", contexts: ["page"] });
  });
  chrome.alarms.create("keepalive", { periodInMinutes: 1 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("keepalive", { periodInMinutes: 1 });
  ensureSocket();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepalive") ensureSocket().then(flushOutbox);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  // Abrir o painel precisa acontecer na hora do clique (gesto do usuário).
  if (tab?.windowId !== undefined) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  enqueue(textFrom(info, tab));
});

// Alt+Shift+O: abre o chat; se já estiver aberto nesta janela, esconde na hora.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "toggle-chat") return;
  const windowId = tab?.windowId ?? (await chrome.windows.getLastFocused()).id;
  const open = [...panels].filter(([, id]) => id === windowId);
  if (!open.length) {
    // Precisa ser chamado direto, sem await antes, para valer como gesto do usuário.
    chrome.sidePanel.open({ windowId }).catch(() => {});
    return;
  }
  open.forEach(([port]) => port.postMessage({ type: "hide" }));
  chrome.sidePanel.close?.({ windowId }).catch(() => {});
});

chrome.omnibox.setDefaultSuggestion({ description: "Enviar para o nosso chat: %s" });
chrome.omnibox.onInputEntered.addListener((text) => enqueue(text));

chrome.notifications.onClicked.addListener(async (id) => {
  chrome.notifications.clear(id);
  try {
    const window = await chrome.windows.getLastFocused();
    await chrome.sidePanel.open({ windowId: window.id });
  } catch {
    const { siteUrl } = await settings();
    chrome.tabs.create({ url: siteUrl });
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.siteUrl) chrome.storage.local.remove("session");
  if (changes.session || (area === "sync" && changes.siteUrl)) ensureSocket().then(flushOutbox);
});

// O painel lateral avisa quando está aberto: nada de notificação nem contador enquanto isso.
chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith("sidepanel")) return;
  panels.set(port, Number(port.name.split(":")[1]));
  clearUnread();
  ensureSocket();
  port.onDisconnect.addListener(() => panels.delete(port));
});

ensureSocket();
