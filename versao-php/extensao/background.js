// Serviço de fundo: mantém uma conexão própria com o chat (HTTP com long polling, servidor PHP)
// para enviar mensagens (menu de contexto, barra de endereço) e avisar quando chegar algo novo.

const DEFAULT_URL = "http://localhost:8000";
const MENU = {
  selection: "potato-selection",
  link: "potato-link",
  image: "potato-image",
  page: "potato-page"
};

let me = "";
let linkKey = "";
let linkAbort = null;
const panels = new Map(); // porta do painel → id da janela

const settings = () => chrome.storage.sync.get({ siteUrl: DEFAULT_URL, notify: true });
// A sessão fica em storage.local: continua logado mesmo depois de fechar o Chrome.
const getSession = async () => (await chrome.storage.local.get("session")).session || null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(siteUrl, action, body, signal) {
  const response = await fetch(`${siteUrl}/api.php?action=${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    const error = new Error(result?.error || `Erro ${response.status} no servidor.`);
    error.status = response.status;
    throw error;
  }
  return result;
}

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

// Liga (ou religa) a conexão com o chat quando muda o endereço do site ou a sessão.
async function ensureConnection() {
  const [{ siteUrl }, session] = await Promise.all([settings(), getSession()]);
  const key = session ? `${siteUrl}|${session.name}` : "";
  if (key === linkKey && (linkAbort || !key)) return;
  linkAbort?.abort();
  linkAbort = null;
  linkKey = key;
  if (!session) return;
  me = session.name;
  const controller = new AbortController();
  linkAbort = controller;
  listen(siteUrl, key, controller.signal);
}

// Laço de consultas. O id da conexão e o cursor ficam em storage.session: se o Chrome
// suspender o serviço de fundo, ele volta de onde parou.
async function listen(siteUrl, key, signal) {
  const saved = (await chrome.storage.session.get("link")).link;
  let link = saved?.key === key ? saved : { key, conn: crypto.randomUUID(), cursor: null };
  let failures = 0;
  while (!signal.aborted) {
    try {
      const session = await getSession();
      if (!session) return;
      const base = { token: session.token, conn: link.conn, client: "extension" };
      let wait = 20;
      if (link.cursor === null) {
        const start = await call(siteUrl, "connect", base, signal);
        if (start.roomFull) return;
        if (start.session?.token) await chrome.storage.local.set({ session: start.session });
        link.cursor = start.cursor;
        wait = start.wait;
        await chrome.storage.session.set({ link });
        flushOutbox();
      } else {
        const data = await call(siteUrl, "poll", { ...base, cursor: link.cursor, only: ["message"] }, signal);
        link.cursor = data.cursor;
        wait = data.wait;
        for (const event of data.events) if (event.type === "message") await onMessage(event.data);
      }
      failures = 0;
      // Salvar o cursor também mantém o serviço de fundo acordado entre as consultas.
      await chrome.storage.session.set({ link });
      if (!wait) await sleep(5000);
    } catch (error) {
      if (signal.aborted) return;
      if (error.status === 401) {
        await chrome.storage.local.remove("session");
        await setBadge("!", "#ff7064");
        return;
      }
      if (error.status === 410) {
        link = { key, conn: crypto.randomUUID(), cursor: null };
        continue;
      }
      failures += 1;
      await sleep(Math.min(15000, 1000 * 2 ** failures));
    }
  }
}

async function siteTabIsActive(siteUrl) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const window = tab ? await chrome.windows.get(tab.windowId) : null;
    return Boolean(window?.focused && tab.url && tab.url.startsWith(siteUrl));
  } catch {
    return false;
  }
}

// Foto ou arquivo sem legenda: o aviso diz o que chegou.
function fileLabel(file) {
  return { image: "📷 Foto", video: "🎥 Vídeo", audio: "🎵 Áudio" }[file.kind] || `📎 ${file.name}`;
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
    message: message.deleted ? "Mensagem apagada" : message.gif ? "GIF" : message.music ? `🎵 ${message.music.title}` : message.file && !message.text ? fileLabel(message.file) : message.text.slice(0, 200),
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
  if (!(await getSession())) return setBadge("…");
  await ensureConnection();
  await flushOutbox();
}

let flushing = false;
async function flushOutbox() {
  if (flushing) return;
  flushing = true;
  try {
    const [{ siteUrl }, session, { link }] = await Promise.all([settings(), getSession(), chrome.storage.session.get("link")]);
    if (!session) return;
    const conn = link?.conn || crypto.randomUUID();
    const { outbox = [] } = await chrome.storage.session.get("outbox");
    for (const item of outbox) {
      const body = { token: session.token, conn, client: "extension", ops: [{ event: "message", data: item }] };
      const result = await call(siteUrl, "ops", body).then(({ results }) => results?.[0]).catch(() => null);
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
  ensureConnection();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepalive") ensureConnection().then(flushOutbox);
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
    chrome.tabs.create({ url: `${siteUrl}/` });
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.siteUrl) chrome.storage.local.remove("session");
  if (changes.session || (area === "sync" && changes.siteUrl)) ensureConnection().then(flushOutbox);
});

// O painel lateral avisa quando está aberto: nada de notificação nem contador enquanto isso.
chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith("sidepanel")) return;
  panels.set(port, Number(port.name.split(":")[1]));
  clearUnread();
  ensureConnection();
  port.onDisconnect.addListener(() => panels.delete(port));
});

ensureConnection();
