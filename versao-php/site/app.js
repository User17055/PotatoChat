import { sound } from "./sound.js";
import { fx, effectFor, motion } from "./fx.js";
import { io, apiUrl } from "./realtime.js";

const $ = (selector) => document.querySelector(selector);
const loginView = $("#login-view");
const chatView = $("#chat-view");
const loginForm = $("#login-form");
const loginError = $("#login-error");
const messagesEl = $("#messages");
const messageForm = $("#message-form");
const messageInput = $("#message-input");
const roomTitle = $("#room-title");
const peerStatus = $("#peer-status");
const peerAvatar = $("#peer-avatar");
const peopleEl = $("#people");
const typingEl = $("#typing");
const typingText = $("#typing-text");
const loadMore = $("#load-more");
const jump = $("#jump");
const jumpCount = $("#jump-count");
const replyBar = $("#reply-bar");
const netBanner = $("#net-banner");
const netText = $("#net-text");
const callPanel = $("#call-panel");
const callStatus = $("#call-status");
const callTimer = $("#call-timer");
const incoming = $("#incoming");

const SESSION_KEY = "potato.session";
const NAME_KEY = "potato.name";
const NOTIFY_KEY = "potato.notify";
const REACTIONS = ["❤️", "😂", "😮", "😢", "👍", "🔥"];
const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] };

// Quando o site roda dentro do painel lateral da extensão, conversa com ela via postMessage.
const parentOrigin = window.parent !== window ? (location.ancestorOrigins?.[0] || "") : "";
const inExtension = parentOrigin.startsWith("chrome-extension://");

let socket = null;
let me = "";
let list = [];
const byId = new Map();
const pending = new Map();
let reads = {};
let presenceList = [];
let peerName = "";
let peerWasOnline = null;
let peerTyping = false;
let replyTo = null;
let hasMore = false;
let loadingOlder = false;
let unseenBelow = 0;
let unreadTitle = 0;
let typingActive = false;
let typingTimer;
let peerTypingTimer;
let chatShown = false;
// Chave da busca de GIFs (vem com o histórico; vazia = GIFs ainda não ativados no config.php).
let gifKey = "";

let call = null;
let peerConnection = null;
let pendingCandidates = [];

// ---------- utilidades ----------

const store = {
  get(area, key) { try { return JSON.parse(window[area].getItem(key)); } catch { return null; } },
  set(area, key, value) { try { window[area].setItem(key, JSON.stringify(value)); } catch {} },
  remove(area, key) { try { window[area].removeItem(key); } catch {} }
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Ícone do sprite definido no index.html (<symbol id="i-...">).
function icon(name, className = "icon") {
  const node = document.createElementNS(SVG_NS, "svg");
  node.setAttribute("class", className);
  node.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#i-${name}`);
  node.append(use);
  return node;
}

function potatoArt() {
  const node = document.createElementNS(SVG_NS, "svg");
  node.setAttribute("viewBox", "0 0 142 100");
  node.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", "#potato");
  node.append(use);
  return node;
}

const time = (iso) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const dayKey = (iso) => new Date(iso).toDateString();

function dayLabel(iso) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (date.toDateString() === today.toDateString()) return "Hoje";
  if (date.toDateString() === yesterday.toDateString()) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" }).format(date);
}

function lastSeenLabel(iso) {
  if (!iso) return "Offline";
  const label = dayLabel(iso).toLowerCase();
  return `Visto por último ${label === "hoje" || label === "ontem" ? label : `em ${label}`} às ${time(iso)}`;
}

function hue(name) {
  return [...String(name)].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 7);
}

// Fotos de perfil (nome → endereço da imagem), atualizadas pela presença.
const avatars = new Map();

function setAvatar(name, path) {
  if (path) avatars.set(name, new URL(path, document.baseURI).href);
  else avatars.delete(name);
}

function paintAvatar(node, name) {
  const photo = name ? avatars.get(name) : "";
  node.textContent = photo ? "" : name ? name.trim()[0].toUpperCase() : "?";
  node.style.setProperty("--hue", name ? hue(name) : 40);
  node.style.backgroundImage = photo ? `url("${photo}")` : "";
  node.classList.toggle("has-photo", Boolean(photo));
}

// Avatares fora da lista de pessoas (abas, barra lateral, perfil e chamada).
function repaintAvatars() {
  for (const node of [$("#tab-avatar"), $("#side-avatar"), $("#profile-face")]) paintAvatar(node, me);
  $("#side-name").textContent = me || "Você";
  if (!call) return;
  paintAvatar($("#me-face"), me);
  paintAvatar($("#call-avatar-face"), call.name || peerName);
  paintAvatar($("#incoming-face"), call.name);
}

function uid() {
  return crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isJumbo(text) {
  if (!/^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️|\s)+$/u.test(text)) return false;
  const compact = text.replace(/\s/g, "");
  const count = window.Intl?.Segmenter ? [...new Intl.Segmenter("pt", { granularity: "grapheme" }).segment(compact)].length : [...compact].length;
  return count <= 3;
}

// Texto curto da mensagem (citação da resposta, notificação): GIF não tem texto.
const previewText = (message) => (message.gif ? "GIF" : message.text);

function richText(text) {
  const fragment = document.createDocumentFragment();
  const pattern = /\bhttps?:\/\/[^\s<]+[^\s<.,;:!?'")\]]/gi;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    fragment.append(text.slice(last, match.index));
    const link = el("a", "", match[0]);
    link.href = match[0];
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    fragment.append(link);
    last = match.index + match[0].length;
  }
  fragment.append(text.slice(last));
  return fragment;
}

const TOAST_ICON = { ok: "check-circle", error: "x-circle", live: "radio", info: "info" };

function toast(text, kind = "info") {
  const node = el("div", `toast ${kind}`);
  node.append(icon(TOAST_ICON[kind] || "info"), el("span", "", text));
  $("#toasts").append(node);
  fx.toast(node);
}

// Janela de confirmação própria (no lugar do confirm() do navegador).
function confirmDialog({ title, text, confirm }) {
  const modal = $("#confirm");
  $("#confirm-title").textContent = title;
  $("#confirm-text").textContent = text;
  $("#confirm-ok").textContent = confirm;
  modal.classList.remove("hidden");
  fx.incoming(modal.querySelector(".modal-card"));
  $("#confirm-ok").focus();
  return new Promise((resolve) => {
    const close = (answer) => {
      modal.classList.add("hidden");
      modal.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey, true);
      resolve(answer);
    };
    const onClick = (event) => {
      if (event.target.closest("#confirm-ok")) close(true);
      else if (event.target.closest("#confirm-cancel") || event.target === modal) close(false);
    };
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close(false);
    };
    modal.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey, true);
  });
}

function tellParent(message) {
  if (inExtension) window.parent.postMessage({ source: "potato-site", ...message }, parentOrigin);
}

// ---------- sessão ----------

const rememberedName = store.get("localStorage", NAME_KEY) || "";
$("#name").value = rememberedName;
if (rememberedName) $(".login-panel .eyebrow").textContent = `Oi de novo, ${rememberedName}`;

const passwordInputs = [$("#password"), $("#password-again")];

$("#peek").addEventListener("click", () => {
  const show = $("#password").type === "password";
  passwordInputs.forEach((input) => { input.type = show ? "text" : "password"; });
  $("#peek").classList.toggle("shown", show);
  $("#peek").setAttribute("aria-label", show ? "Esconder senha" : "Mostrar senha");
  $("#password").focus();
});

for (const input of passwordInputs) {
  for (const type of ["keydown", "keyup"]) {
    input.addEventListener(type, (event) => {
      $("#caps").classList.toggle("hidden", !event.getModifierState?.("CapsLock"));
    });
  }
  input.addEventListener("blur", () => $("#caps").classList.add("hidden"));
}

// Primeiro acesso: as duas primeiras pessoas escolhem nome e senha, que ficam valendo para sempre.
const loginHint = $("#login-hint");
let openSeats = 0;
let creating = false;

function paintHint() {
  const text = creating
    ? `Primeiro acesso de ${creating}: repita a senha para criar sua conta. Depois disso, nome e senha não mudam mais.`
    : openSeats >= 2 ? "Primeiro acesso: escolha seu nome e uma senha. Eles ficam guardados e valem para sempre."
    : openSeats === 1 ? "Primeira vez aqui? Escolha seu nome e uma senha para criar sua conta."
    : "";
  loginHint.textContent = text;
  loginHint.classList.toggle("hidden", !text);
}

function setCreating(name) {
  creating = name;
  $("#again-wrap").classList.toggle("hidden", !name);
  $("#password-again").required = Boolean(name);
  $("#password-again").value = "";
  loginForm.querySelector(".primary .label").textContent = name ? "Criar minha conta" : "Entrar no nosso chat";
  paintHint();
}

$("#name").addEventListener("input", () => { if (creating) setCreating(""); });

async function loadWelcome() {
  try {
    const response = await fetch(apiUrl("welcome"), { cache: "no-store" });
    if (response.ok) openSeats = (await response.json()).open || 0;
  } catch {}
  paintHint();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const submit = loginForm.querySelector(".primary");
  submit.disabled = true;
  submit.classList.add("loading");
  try {
    const body = { name: $("#name").value, password: $("#password").value };
    if (creating) body.confirm = $("#password-again").value;
    const response = await fetch(apiUrl("login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Não foi possível entrar.");
    if (result.confirm) {
      setCreating(result.name);
      $("#password-again").focus();
      return;
    }
    store.set("localStorage", NAME_KEY, result.name);
    passwordInputs.forEach((input) => { input.value = ""; });
    startSession(result, { animate: true });
    if (result.created) setTimeout(() => toast("Conta criada! Escolha sua foto e o tema no seu perfil.", "ok"), 900);
  } catch (error) {
    if (creating) $("#password-again").value = "";
    loginError.textContent = error.message === "Failed to fetch" ? "Servidor fora do ar. Tente de novo." : error.message;
    fx.shake($(".login-panel"));
    sound.play("error");
  } finally {
    submit.disabled = false;
    submit.classList.remove("loading");
  }
});

function startSession({ token, name }, { animate }) {
  me = name;
  store.set("localStorage", SESSION_KEY, { token, name });
  tellParent({ type: "potato:session", token, name });
  connect(token, animate);
}

function logout() {
  socket?.disconnect();
  store.remove("localStorage", SESSION_KEY);
  store.remove("sessionStorage", SESSION_KEY);
  tellParent({ type: "potato:logout" });
  location.reload();
}

document.querySelectorAll("[data-logout]").forEach((button) => button.addEventListener("click", () => {
  if (call) teardown(true);
  logout();
}));

function showChat(animate) {
  chatShown = true;
  const swap = () => {
    loginView.classList.add("hidden");
    chatView.classList.remove("hidden");
    scrollToLatest();
    if (matchMedia("(pointer: fine)").matches) messageInput.focus();
  };
  if (animate) fx.enterChat(swap);
  else swap();
}

// ---------- tempo real ----------

function connect(token, animate) {
  socket?.disconnect();
  socket = io({ auth: { token, client: "web" }, reconnectionDelayMax: 8000 });

  socket.on("connect", () => {
    if (!chatShown) showChat(animate);
    else if (!netBanner.classList.contains("hidden")) toast("Conectado de novo", "ok");
    fx.hide(netBanner, { y: -10 });
    socket.emit("visibility", !document.hidden);
    for (const message of pending.values()) deliver(message);
  });

  socket.on("disconnect", (reason) => {
    if (reason === "io client disconnect") return;
    netText.textContent = "Sem conexão. Reconectando…";
    fx.show(netBanner, { y: -10 });
    setPeerTyping(false);
  });

  socket.io.on("reconnect_attempt", (attempt) => { netText.textContent = `Reconectando… (tentativa ${attempt})`; });

  socket.on("connect_error", (error) => {
    if (/Sessão inválida/.test(error.message)) {
      store.remove("localStorage", SESSION_KEY);
  store.remove("sessionStorage", SESSION_KEY);
      tellParent({ type: "potato:logout" });
      if (chatShown) return location.reload();
      loginError.textContent = "Sua sessão expirou. Entre novamente.";
      return;
    }
    if (!chatShown) loginError.textContent = "Não foi possível conectar ao servidor.";
    else {
      netText.textContent = "Sem conexão com o servidor. Tentando de novo…";
      fx.show(netBanner, { y: -10 });
    }
  });

  socket.on("session", ({ token, name }) => {
    if (!token) return;
    store.set("localStorage", SESSION_KEY, { token, name });
    tellParent({ type: "potato:session", token, name });
  });

  socket.on("room-full", () => {
    toast("Nosso chat já está com as duas pessoas.", "error");
    sound.play("error");
    setTimeout(logout, 2200);
  });

  socket.on("history", (payload) => {
    list = payload.items;
    byId.clear();
    list.forEach((message) => byId.set(message.id, message));
    for (const clientId of pending.keys()) if (list.some((message) => message.clientId === clientId)) pending.delete(clientId);
    reads = payload.reads || {};
    hasMore = payload.hasMore;
    gifKey = payload.gifKey || "";
    syncTheme(payload.theme);
    renderAll();
    scrollToLatest();
    markSeen();
  });

  socket.on("message", (message) => receive(message, true));
  socket.on("message:update", updateMessage);
  socket.on("seen", ({ name, id, at }) => { reads[name] = { id, at }; refreshStatuses(); });
  socket.on("presence", updatePresence);
  socket.on("typing", ({ active }) => setPeerTyping(active));
  // Tema trocado em outra aba ou aparelho da mesma pessoa.
  socket.on("theme", ({ theme }) => {
    themeSaved = true;
    applyTheme(theme);
  });

  socket.on("webrtc-offer", receiveOffer);
  socket.on("webrtc-answer", receiveAnswer);
  socket.on("webrtc-ice", receiveIce);
  socket.on("call-state", receiveCallState);
  socket.on("call-declined", ({ name }) => {
    if (call?.role !== "caller" || call.connected) return;
    toast(`${name} recusou a chamada.`);
    sound.play("hangup");
    teardown(false);
  });
  socket.on("call-ended", () => {
    if (!call) return;
    if (call.role === "callee" && !call.accepted) toast(`Chamada perdida de ${call.name}.`);
    else toast("Chamada encerrada.");
    sound.play("hangup");
    teardown(false);
  });
  socket.on("call-handled", () => {
    if (call?.role === "callee" && !call.accepted) teardown(false);
  });
  socket.on("peer-left", ({ id }) => {
    if (call && (call.peerId === id || !call.peerId)) {
      toast("A outra pessoa saiu da chamada.");
      sound.play("hangup");
      teardown(false);
    }
  });
}

// ---------- mensagens ----------

function receive(message, live) {
  if (byId.has(message.id)) return;
  list.push(message);
  byId.set(message.id, message);
  const local = message.clientId && pending.get(message.clientId);
  const mine = message.sender === me;
  messagesEl.querySelector(".empty")?.remove();

  if (local) {
    pending.delete(message.clientId);
    const node = messagesEl.querySelector(`[data-client-id="${message.clientId}"]`);
    if (node) {
      fill(node, message);
      fx.sent(node);
    } else appendNode(message, true);
  } else {
    appendNode(message, live);
  }
  refreshStatuses();
  if (!live) return;

  if (!mine) {
    setPeerTyping(false);
    sound.play("receive");
    notify(message);
    if (tab !== "chat") bumpUnread();
  } else if (!local) {
    sound.play("tap");
  }

  if (mine || nearBottom()) scrollToLatest(true);
  else {
    unseenBelow += 1;
    jumpCount.textContent = unseenBelow;
    jumpCount.classList.remove("hidden");
    fx.show(jump, { scale: 0.6 });
    fx.pop(jumpCount);
  }
  markSeen();

  const effect = !message.deleted && effectFor(message.text);
  if (effect) setTimeout(() => { effect.run(); sound.play("sparkle"); }, 180);
}

function updateMessage(message) {
  const previous = byId.get(message.id);
  if (!previous) return;
  const index = list.indexOf(previous);
  list[index] = message;
  byId.set(message.id, message);
  const node = messagesEl.querySelector(`[data-id="${message.id}"]`);
  if (!node) return;
  const before = Object.fromEntries(Object.entries(previous.reactions || {}).map(([emoji, names]) => [emoji, names.length]));
  if (message.deleted && !previous.deleted) return fx.remove(node, () => fill(node, message));
  fill(node, message);
  node.querySelectorAll(".chip").forEach((chip) => {
    if ((message.reactions[chip.dataset.emoji]?.length || 0) > (before[chip.dataset.emoji] || 0)) fx.pop(chip);
  });
}

function needsDay(previous, message) {
  return !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt);
}

function isGrouped(previous, message) {
  return Boolean(previous) && previous.sender === message.sender && !needsDay(previous, message)
    && new Date(message.createdAt) - new Date(previous.createdAt) < 5 * 60 * 1000;
}

function lastRendered() {
  const nodes = messagesEl.querySelectorAll(".message");
  return nodes[nodes.length - 1]?.msg || null;
}

function buildNode(message, previous) {
  const article = el("article", "message");
  article.classList.toggle("grouped", isGrouped(previous, message));
  fill(article, message);
  return article;
}

function appendNode(message, animate) {
  const previous = lastRendered();
  if (needsDay(previous, message)) messagesEl.append(el("div", "day", dayLabel(message.createdAt)));
  const node = buildNode(message, previous);
  messagesEl.append(node);
  if (animate) fx.message(node, message.sender === me);
  return node;
}

function renderAll() {
  messagesEl.querySelectorAll(".message, .day, .empty").forEach((node) => node.remove());
  const fragment = document.createDocumentFragment();
  let previous = null;
  for (const message of [...list, ...pending.values()]) {
    if (needsDay(previous, message)) fragment.append(el("div", "day", dayLabel(message.createdAt)));
    fragment.append(buildNode(message, previous));
    previous = message;
  }
  messagesEl.append(fragment);
  if (!list.length && !pending.size) {
    const empty = el("div", "empty");
    empty.append(potatoArt(), el("span", "", "Nosso chat começa aqui. Manda um oi!"));
    messagesEl.append(empty);
  }
  loadMore.classList.toggle("hidden", !hasMore);
  refreshStatuses();
}

function fill(article, message) {
  const mine = message.sender === me;
  article.msg = message;
  article.className = article.className.replace(/\b(mine|deleted|pending)\b/g, "").trim();
  article.classList.add("message");
  article.classList.toggle("mine", mine);
  article.classList.toggle("deleted", message.deleted);
  article.classList.toggle("pending", !message.id);
  if (message.id) article.dataset.id = message.id;
  if (message.clientId) article.dataset.clientId = message.clientId;
  article.replaceChildren();

  const row = el("div", "bubble-row");
  const bubble = el("div", "bubble");
  if (!message.deleted && isJumbo(message.text)) bubble.classList.add("jumbo");

  if (message.replyTo && !message.deleted) {
    const quote = el("button", "reply-quote");
    quote.type = "button";
    quote.dataset.target = message.replyTo.id;
    quote.append(el("strong", "", message.replyTo.sender === me ? "Você" : message.replyTo.sender), el("span", "", message.replyTo.text || "Mensagem apagada"));
    bubble.append(quote);
  }

  if (message.gif && !message.deleted) {
    bubble.classList.add("gif");
    bubble.append(gifImage(message.gif));
  } else {
    const text = el("div", "text");
    if (message.deleted) text.textContent = "Mensagem apagada";
    else text.append(richText(message.text));
    bubble.append(text);
  }

  const foot = el("span", "foot");
  if (message.source === "extension") foot.append(el("span", "via", "via extensão"));
  const stamp = el("time", "", time(message.createdAt));
  stamp.dateTime = message.createdAt;
  foot.append(stamp);
  if (mine) foot.append(el("span", "status"));
  bubble.append(foot);
  row.append(bubble);

  if (message.id && !message.deleted) {
    const tools = el("div", "tools");
    for (const emoji of REACTIONS) {
      const button = el("button", "tool-emoji", emoji);
      button.type = "button";
      button.dataset.react = emoji;
      button.setAttribute("aria-label", `Reagir com ${emoji}`);
      tools.append(button);
    }
    const reply = el("button", "tool");
    reply.type = "button";
    reply.dataset.action = "reply";
    reply.title = "Responder";
    reply.append(icon("reply"));
    tools.append(reply);
    if (message.text && !message.gif) {
      const copy = el("button", "tool");
      copy.type = "button";
      copy.dataset.action = "copy";
      copy.title = "Copiar texto";
      copy.append(icon("copy"));
      tools.append(copy);
    }
    if (mine) {
      const remove = el("button", "tool danger-tool");
      remove.type = "button";
      remove.dataset.action = "delete";
      remove.title = "Apagar para todos";
      remove.append(icon("trash"));
      tools.append(remove);
    }
    // Ordem de entrada da animação dos botões (styles.css).
    [...tools.children].forEach((button, index) => button.style.setProperty("--i", index));
    row.append(tools);
  }
  article.append(row);

  const entries = Object.entries(message.reactions || {});
  if (entries.length) {
    const reactions = el("div", "reactions");
    for (const [emoji, names] of entries) {
      const chip = el("button", `chip${names.includes(me) ? " mine" : ""}`);
      chip.type = "button";
      chip.dataset.emoji = emoji;
      chip.title = names.map((name) => (name === me ? "Você" : name)).join(", ");
      chip.append(emoji, names.length > 1 ? el("span", "", String(names.length)) : "");
      reactions.append(chip);
    }
    article.append(reactions);
  }
  if (mine) paintStatus(article);
}

function peerReadIndex() {
  let best = -1;
  for (const [name, read] of Object.entries(reads)) {
    if (name === me) continue;
    best = Math.max(best, list.findIndex((message) => message.id === read.id));
  }
  return best;
}

function paintStatus(article, readIndex = peerReadIndex()) {
  const holder = article.querySelector(".status");
  const message = article.msg;
  if (!holder || !message) return;
  let state = "sent";
  if (!message.id) state = message.status === "failed" ? "failed" : "pending";
  else if (list.indexOf(message) <= readIndex) state = "read";
  if (holder.dataset.state === state) return;
  const wasSent = holder.dataset.state === "sent";
  holder.dataset.state = state;
  holder.title = { pending: "Enviando…", failed: "Não enviada — toque para tentar de novo", sent: "Entregue", read: "Lida" }[state];
  holder.replaceChildren(icon({ pending: "clock", failed: "alert", sent: "check", read: "check-check" }[state]));
  if (state === "read" && wasSent) fx.pop(holder);
}

function refreshStatuses() {
  const readIndex = peerReadIndex();
  messagesEl.querySelectorAll(".message.mine").forEach((article) => paintStatus(article, readIndex));
}

// Mensagem de texto, ou de GIF (gif = { url, width, height, title }, sem texto).
function send(text, gif = null) {
  const clean = gif ? "" : text.trim();
  if ((!clean && !gif) || !me) return;
  const message = {
    id: null,
    clientId: uid(),
    sender: me,
    text: clean.slice(0, 2000),
    gif,
    createdAt: new Date().toISOString(),
    replyTo: replyTo ? { id: replyTo.id, sender: replyTo.sender, text: previewText(replyTo).slice(0, 160) } : null,
    reactions: {},
    deleted: false,
    status: "pending"
  };
  pending.set(message.clientId, message);
  messagesEl.querySelector(".empty")?.remove();
  appendNode(message, true);
  scrollToLatest(true);
  sound.play("send");
  clearReply();
  stopTyping();
  deliver(message);
}

function deliver(message) {
  if (!socket?.connected) return;
  const node = () => messagesEl.querySelector(`[data-client-id="${message.clientId}"]`);
  message.status = "pending";
  if (node()) paintStatus(node());
  socket.timeout(10000).emit("message", { text: message.text, gif: message.gif, clientId: message.clientId, replyTo: message.replyTo?.id }, (error, result) => {
    if (!pending.has(message.clientId)) return;
    if (!error && result?.ok) return receive(result.message, true);
    message.status = "failed";
    if (node()) paintStatus(node());
    if (result?.error) toast(result.error, "error");
    sound.play("error");
  });
}

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!messageInput.value.trim()) return;
  send(messageInput.value);
  fx.sendButton(messageForm.querySelector(".send"));
  messageInput.value = "";
  messageInput.style.height = "auto";
  messageInput.style.overflowY = "hidden";
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    messageForm.requestSubmit();
  }
  if (event.key === "Escape" && !$("#reply-bar").classList.contains("hidden")) {
    event.stopPropagation();
    clearReply();
  }
});

// No painel da extensão, Esc esconde o chat na hora.
document.addEventListener("keydown", (event) => {
  if (inExtension && event.key === "Escape" && !call) tellParent({ type: "potato:hide" });
});

messageInput.addEventListener("input", () => {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 140)}px`;
  messageInput.style.overflowY = messageInput.scrollHeight > 140 ? "auto" : "hidden";
  if (!messageInput.value.trim()) return stopTyping();
  if (!typingActive) {
    typingActive = true;
    socket?.emit("typing", true);
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, 1800);
});

function stopTyping() {
  clearTimeout(typingTimer);
  if (!typingActive) return;
  typingActive = false;
  socket?.emit("typing", false);
}

document.querySelectorAll("[data-emoji]").forEach((button) => button.addEventListener("click", () => {
  send(button.dataset.emoji);
  const box = button.getBoundingClientRect();
  fx.burst(box.left + box.width / 2, box.top, [button.dataset.emoji], 8);
  fx.press(button);
}));

// ---------- GIFs (busca do GIPHY) ----------

const gifPanel = $("#gif-panel");
const gifButton = $("#gif-button");
const gifSearch = $("#gif-search");
const gifResults = $("#gif-results");
const gifGrid = $("#gif-grid");
const gifNote = $("#gif-note");
const GIF_PAGE = 24;
const GIF_MAX_WIDTH = 280;
const GIF_MAX_HEIGHT = 220;
// Lista aberta: busca atual, quantos já vieram, se acabou, e qual pedido é o mais novo (respostas atrasadas são ignoradas).
const gifs = { query: "", offset: 0, done: false, loading: false, request: 0, columns: [] };
let gifTimer;

// GIF da mensagem: o tamanho fica reservado antes de carregar, para a conversa não pular.
function gifImage(gif) {
  const image = el("img", "gif-media");
  const scale = Math.min(1, GIF_MAX_WIDTH / gif.width, GIF_MAX_HEIGHT / gif.height);
  image.src = gif.url;
  image.alt = gif.title || "GIF";
  image.decoding = "async";
  image.draggable = false;
  image.style.width = `${Math.round(gif.width * scale)}px`;
  image.style.aspectRatio = `${gif.width} / ${gif.height}`;
  return image;
}

// Do resultado do GIPHY: a versão de 200 px de altura vai na mensagem (leve), a de 200 px de largura vai na grade.
function gifFrom(item) {
  const sent = item.images?.fixed_height;
  const thumb = item.images?.fixed_width || sent;
  if (!sent?.url || !thumb?.url) return null;
  return {
    gif: { url: sent.webp || sent.url, width: Number(sent.width), height: Number(sent.height), title: item.title || "" },
    thumb: { url: thumb.webp || thumb.url, width: Number(thumb.width), height: Number(thumb.height) }
  };
}

const gifColumnCount = () => (gifGrid.clientWidth >= 330 ? 3 : 2);

function showGifNote(text) {
  gifNote.textContent = text;
  gifNote.classList.toggle("hidden", !text);
}

function resetGifGrid() {
  gifs.columns = Array.from({ length: gifColumnCount() }, () => Object.assign(el("div", "gif-col"), { fill: 0 }));
  gifGrid.replaceChildren(...gifs.columns);
  gifResults.scrollTop = 0;
}

function addGif(found) {
  if (!found.gif.width || !found.gif.height || !found.thumb.width || !found.thumb.height) return;
  const button = el("button", "gif-item");
  button.type = "button";
  button.gif = found.gif;
  button.title = found.gif.title || "GIF";
  button.setAttribute("aria-label", found.gif.title ? `Enviar GIF: ${found.gif.title}` : "Enviar GIF");
  const image = el("img");
  image.src = found.thumb.url;
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  image.width = found.thumb.width;
  image.height = found.thumb.height;
  button.append(image);
  // Sempre na coluna mais curta: a grade fica equilibrada, estilo mural.
  const column = gifs.columns.reduce((low, next) => (next.fill < low.fill ? next : low));
  column.fill += found.thumb.height / found.thumb.width;
  column.append(button);
}

// fresh = começa de novo (abriu o painel ou mudou a busca); senão, carrega a próxima página.
async function loadGifs(fresh) {
  if (fresh) {
    gifs.request += 1;
    gifs.offset = 0;
    gifs.done = false;
    resetGifGrid();
  } else if (gifs.done || gifs.loading) return;
  if (!gifKey) {
    gifs.done = true;
    return showGifNote("Os GIFs ainda não foram ativados: falta colocar a chave do GIPHY no config.php (veja o LEIA-ME).");
  }
  const { request, query } = gifs;
  gifs.loading = true;
  if (!gifs.offset) showGifNote("Carregando GIFs…");
  try {
    const params = new URLSearchParams({ api_key: gifKey, limit: String(GIF_PAGE), offset: String(gifs.offset), rating: "pg-13" });
    if (query) {
      params.set("q", query);
      params.set("lang", "pt");
    }
    const response = await fetch(`https://api.giphy.com/v1/gifs/${query ? "search" : "trending"}?${params}`);
    if (request !== gifs.request) return;
    if (!response.ok) {
      throw new Error(response.status === 429 ? "Muitas buscas de GIF nesta hora. Tente de novo daqui a pouco."
        : response.status === 401 || response.status === 403 ? "O GIPHY não aceitou a chave do config.php. Confira se ela foi copiada inteira."
        : "Não deu para carregar os GIFs agora.");
    }
    const { data = [], pagination = {} } = await response.json();
    if (request !== gifs.request) return;
    data.map(gifFrom).filter(Boolean).forEach(addGif);
    gifs.offset += data.length;
    // O GIPHY não pagina além de 4999 (busca) ou 499 (em alta).
    gifs.done = !data.length || gifs.offset >= (pagination.total_count ?? Infinity) || gifs.offset + GIF_PAGE > (query ? 4999 : 499);
    showGifNote(gifs.offset ? "" : query ? `Nenhum GIF encontrado para “${query}”.` : "Nenhum GIF por aqui agora.");
  } catch (error) {
    if (request !== gifs.request) return;
    gifs.done = true;
    showGifNote(error.message === "Failed to fetch" ? "Sem conexão com o GIPHY agora." : error.message);
  } finally {
    if (request === gifs.request) gifs.loading = false;
  }
}

function onGifKey(event) {
  if (event.key !== "Escape") return;
  event.stopPropagation();
  closeGifs();
  messageInput.focus();
}

function openGifs() {
  fx.show(gifPanel, { y: 10, scale: 0.98 });
  gifButton.setAttribute("aria-expanded", "true");
  document.addEventListener("keydown", onGifKey, true);
  // Abre onde parou. Sem resultados (primeira vez ou erro) ou com outra largura, monta de novo.
  if (!gifGrid.querySelector(".gif-item") || gifs.columns.length !== gifColumnCount()) loadGifs(true);
  if (matchMedia("(pointer: fine)").matches) gifSearch.focus({ preventScroll: true });
}

function closeGifs() {
  if (gifPanel.classList.contains("hidden")) return;
  gifPanel.classList.add("hidden");
  gifButton.setAttribute("aria-expanded", "false");
  document.removeEventListener("keydown", onGifKey, true);
}

gifButton.addEventListener("click", () => {
  if (gifPanel.classList.contains("hidden")) openGifs();
  else closeGifs();
  fx.press(gifButton);
});

gifSearch.addEventListener("input", () => {
  clearTimeout(gifTimer);
  gifTimer = setTimeout(searchGifs, 400);
});

// Enter busca na hora (e não envia o formulário da mensagem).
gifSearch.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  clearTimeout(gifTimer);
  searchGifs();
});

function searchGifs() {
  const query = gifSearch.value.trim();
  if (query === gifs.query) return;
  gifs.query = query;
  loadGifs(true);
}

gifResults.addEventListener("scroll", () => {
  if (gifResults.scrollHeight - gifResults.scrollTop - gifResults.clientHeight < 300) loadGifs(false);
}, { passive: true });

gifGrid.addEventListener("click", (event) => {
  const item = event.target.closest(".gif-item");
  if (!item) return;
  send("", item.gif);
  closeGifs();
  if (matchMedia("(pointer: fine)").matches) messageInput.focus();
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("#gif-panel, #gif-button")) closeGifs();
});

// Ações sobre as mensagens (delegação de eventos).
messagesEl.addEventListener("click", (event) => {
  const article = event.target.closest(".message");
  const message = article?.msg;

  if (event.target.closest("#load-more")) return loadOlder();
  if (!message) return;

  const status = event.target.closest(".status");
  if (status?.dataset.state === "failed") return deliver(message);

  const quote = event.target.closest(".reply-quote");
  if (quote) return focusMessage(quote.dataset.target);

  const reactButton = event.target.closest("[data-react], .chip");
  if (reactButton && message.id) {
    const emoji = reactButton.dataset.react || reactButton.dataset.emoji;
    socket?.emit("react", { id: message.id, emoji });
    sound.play("react");
    if (!message.reactions?.[emoji]?.includes(me)) fx.burst(event.clientX, event.clientY, [emoji], 7);
    closeTools();
    return;
  }

  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "reply") {
    closeTools();
    return startReply(message);
  }
  if (action === "copy") {
    closeTools();
    navigator.clipboard?.writeText(message.text)
      .then(() => toast("Texto copiado", "ok"))
      .catch(() => toast("Não foi possível copiar.", "error"));
    return;
  }
  if (action === "delete") {
    closeTools();
    confirmDialog({ title: "Apagar mensagem?", text: "Ela some para os dois. Não dá para desfazer.", confirm: "Apagar" })
      .then((ok) => { if (ok) socket?.emit("delete", { id: message.id }); });
  }
});

// A barra de ações abre com o botão direito (PC) ou segurando a mensagem (celular).
// No toque, arrastar a mensagem para a direita responde a ela, como no WhatsApp.
const LONG_PRESS_MS = 450;
const SWIPE_MAX = 90;
const SWIPE_REPLY = 60;
// Toque em andamento numa mensagem: mode "hold" (pode virar menu) ou "swipe" (arrastando para responder).
let press = null;
let pressReleasedAt = 0;

function closeTools() {
  messagesEl.querySelectorAll(".show-tools").forEach((node) => node.classList.remove("show-tools"));
}

// Devolve a mensagem que pode receber ações, ou null (links mantêm o menu do navegador).
function actionableMessage(target) {
  if (!target.closest(".bubble") || target.closest("a")) return null;
  const article = target.closest(".message");
  return article?.msg?.id && !article.msg.deleted ? article : null;
}

function openTools(article) {
  if (article.classList.contains("show-tools")) return;
  closeTools();
  article.classList.add("show-tools");
}

messagesEl.addEventListener("contextmenu", (event) => {
  const article = actionableMessage(event.target);
  if (!article) return;
  // Com texto selecionado na mensagem, deixa o menu do navegador (para copiar só um trecho).
  const selection = window.getSelection();
  if (selection?.toString().trim() && article.contains(selection.anchorNode)) return;
  event.preventDefault();
  openTools(article);
});

messagesEl.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" || !event.isPrimary) return;
  const article = actionableMessage(event.target);
  if (!article) return;
  const bubble = article.querySelector(".bubble");
  press = { article, bubble, x: event.clientX, y: event.clientY, mode: "hold", opened: false, ready: false };
  fx.hold(bubble);
  press.timer = setTimeout(() => {
    if (press?.mode !== "hold") return;
    press.opened = true;
    openTools(article);
    fx.release(bubble, true);
    navigator.vibrate?.(12);
  }, LONG_PRESS_MS);
});

messagesEl.addEventListener("pointermove", (event) => {
  if (!press || press.opened) return;
  const dx = event.clientX - press.x;
  const dy = event.clientY - press.y;
  if (press.mode === "hold") {
    if (Math.hypot(dx, dy) < 10) return;
    clearTimeout(press.timer);
    fx.release(press.bubble, false);
    // Movimento para a direita vira o gesto de responder; qualquer outro é rolagem.
    if (dx <= 0 || Math.abs(dx) < Math.abs(dy) * 1.5) {
      press = null;
      return;
    }
    press.mode = "swipe";
    press.targets = [...press.article.querySelectorAll(".bubble-row, .reactions")];
    press.hint = el("span", "swipe-reply");
    press.hint.append(icon("reply"));
    press.article.prepend(press.hint);
  }
  // Resistência: o balão anda menos que o dedo e para em SWIPE_MAX.
  const offset = Math.min(SWIPE_MAX, Math.max(0, dx - 10) * 0.7);
  const ready = offset >= SWIPE_REPLY;
  fx.swipe(press.targets, press.hint, offset, Math.min(1, offset / SWIPE_REPLY));
  if (ready && !press.ready) navigator.vibrate?.(8);
  press.hint.classList.toggle("ready", ready);
  press.ready = ready;
});

function endPress(event) {
  if (!press) return;
  clearTimeout(press.timer);
  if (press.mode === "swipe") {
    fx.swipeBack(press.targets, press.hint);
    if (press.ready && event.type === "pointerup") {
      startReply(press.article.msg);
      sound.play("tap");
    }
  } else if (!press.opened) {
    fx.release(press.bubble, false);
  } else {
    pressReleasedAt = Date.now();
  }
  press = null;
}

messagesEl.addEventListener("pointerup", endPress);
messagesEl.addEventListener("pointercancel", endPress);

// Tocar/clicar fora fecha a barra; o clique que vem ao soltar o dedo depois de segurar é ignorado.
document.addEventListener("click", (event) => {
  if (Date.now() - pressReleasedAt < 400) return;
  if (!event.target.closest(".tools")) closeTools();
}, true);

messagesEl.addEventListener("scroll", closeTools, { passive: true });

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !messagesEl.querySelector(".show-tools")) return;
  event.stopPropagation();
  closeTools();
}, true);

messagesEl.addEventListener("dblclick", (event) => {
  const article = event.target.closest(".message");
  const message = article?.msg;
  if (!message?.id || message.deleted || !event.target.closest(".bubble")) return;
  window.getSelection()?.removeAllRanges();
  closeTools();
  if (!message.reactions?.["❤️"]?.includes(me)) socket?.emit("react", { id: message.id, emoji: "❤️" });
  fx.burst(event.clientX, event.clientY, ["❤️", "💖", "💕"], 14);
  sound.play("react");
});

function startReply(message) {
  replyTo = message;
  $("#reply-name").textContent = message.sender === me ? "Respondendo a você" : `Respondendo a ${message.sender}`;
  $("#reply-text").textContent = previewText(message);
  fx.show(replyBar, { y: 16 });
  messageInput.focus();
}

function clearReply() {
  replyTo = null;
  fx.hide(replyBar, { y: 16 });
}

$("#reply-cancel").addEventListener("click", clearReply);

function focusMessage(id) {
  const node = messagesEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (!node) return toast("Essa mensagem é antiga demais para mostrar aqui.");
  node.scrollIntoView({ behavior: "smooth", block: "center" });
  node.classList.remove("flash");
  void node.offsetWidth;
  node.classList.add("flash");
}

function loadOlder() {
  if (!hasMore || loadingOlder || !socket?.connected || !list.length) return;
  loadingOlder = true;
  loadMore.textContent = "Carregando…";
  socket.timeout(8000).emit("history:before", { before: list[0].id }, (error, result) => {
    loadingOlder = false;
    loadMore.textContent = "Carregar mensagens anteriores";
    if (error || !result) return;
    const previousHeight = messagesEl.scrollHeight;
    const fresh = result.items.filter((message) => !byId.has(message.id));
    fresh.forEach((message) => byId.set(message.id, message));
    list = [...fresh, ...list];
    hasMore = result.hasMore;
    renderAll();
    messagesEl.scrollTop += messagesEl.scrollHeight - previousHeight;
  });
}

// ---------- rolagem, leitura e avisos ----------

function nearBottom() {
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
}

function scrollToLatest(smooth = false) {
  requestAnimationFrame(() => messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: smooth && motion() ? "smooth" : "auto" }));
}

// Etiqueta de dia fixa no topo: mostra o dia do trecho que está na tela (como no WhatsApp).
const dayFloat = $("#day-float");
let dayFrame = 0;
function paintDayFloat() {
  dayFrame = 0;
  const top = messagesEl.scrollTop;
  const days = [...messagesEl.querySelectorAll(".day")];
  const index = days.findLastIndex((node) => node.offsetTop <= top + 12);
  const current = days[index];
  const next = days[index + 1];
  const show = Boolean(current) && current.offsetTop < top - 4 && !(next && next.offsetTop - top < 44);
  dayFloat.classList.toggle("hidden", !show);
  if (show) dayFloat.textContent = current.textContent;
}
messagesEl.addEventListener("scroll", () => { if (!dayFrame) dayFrame = requestAnimationFrame(paintDayFloat); }, { passive: true });

messagesEl.addEventListener("scroll", () => {
  if (nearBottom()) {
    unseenBelow = 0;
    jumpCount.classList.add("hidden");
    fx.hide(jump, { scale: 0.6 });
    markSeen();
  } else if (messagesEl.scrollHeight - messagesEl.clientHeight > 400 && jump.classList.contains("hidden")) {
    fx.show(jump, { scale: 0.6 });
  }
  if (messagesEl.scrollTop < 60) loadOlder();
}, { passive: true });

jump.addEventListener("click", () => scrollToLatest(true));

function markSeen() {
  // No perfil a conversa está escondida: nada foi lido ainda.
  if (!socket?.connected || document.hidden || tab !== "chat" || !nearBottom()) return;
  const last = list[list.length - 1];
  if (last && reads[me]?.id !== last.id) {
    reads[me] = { id: last.id, at: new Date().toISOString() };
    socket.emit("seen", { id: last.id });
  }
}

document.addEventListener("visibilitychange", () => {
  socket?.emit("visibility", !document.hidden);
  if (!document.hidden) {
    unreadTitle = 0;
    document.title = "Potato Chat";
    markSeen();
  }
});

function notificationsOn() {
  return !inExtension && "Notification" in window && Notification.permission === "granted" && store.get("localStorage", NOTIFY_KEY) !== false;
}

function notify(message) {
  if (!document.hidden) return;
  unreadTitle += 1;
  document.title = `(${unreadTitle}) Potato Chat`;
  if (!notificationsOn()) return;
  try {
    const notification = new Notification(message.sender, { body: message.deleted ? "" : previewText(message).slice(0, 160), icon: avatars.get(message.sender), tag: "potato-chat", renotify: true, silent: true });
    notification.onclick = () => { window.focus(); notification.close(); };
  } catch {}
}

function paintNotifyButton() {
  const label = $("#notify-state");
  const button = $("#toggle-notify");
  if (inExtension) {
    label.textContent = "Pela extensão";
    button.disabled = true;
  } else if (!("Notification" in window)) {
    label.textContent = "Não suportadas";
    button.disabled = true;
  } else if (Notification.permission === "denied") {
    label.textContent = "Bloqueadas no navegador";
  } else {
    label.textContent = notificationsOn() ? "Ativadas" : "Desativadas";
  }
  button.classList.toggle("is-off", !notificationsOn());
  button.setAttribute("aria-checked", String(notificationsOn()));
}

$("#toggle-notify").addEventListener("click", async () => {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") await Notification.requestPermission();
  else if (Notification.permission === "granted") store.set("localStorage", NOTIFY_KEY, !notificationsOn());
  else toast("Libere as notificações nas configurações do navegador.");
  paintNotifyButton();
  fx.press($("#toggle-notify"));
});

function paintSound() {
  const button = $("#toggle-sound-setting");
  button.classList.toggle("is-off", !sound.enabled);
  button.setAttribute("aria-checked", String(sound.enabled));
  document.querySelectorAll(".sound-state").forEach((label) => { label.textContent = sound.enabled ? "Ligados" : "Mudos"; });
}

$("#toggle-sound-setting").addEventListener("click", (event) => {
  sound.toggle();
  paintSound();
  fx.press(event.currentTarget);
});

// ---------- abas: conversa e perfil ----------

const profileView = $("#profile-view");
let tab = "chat";
// Mensagens que chegaram enquanto a pessoa olhava o perfil.
let unreadAway = 0;
// A conversa some com display: none e perde a rolagem; null = estava no fim.
let chatScroll = null;

function paintTabs() {
  document.querySelectorAll("[data-tab-target]").forEach((button) => {
    const active = button.dataset.tabTarget === tab;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function paintUnread() {
  document.querySelectorAll(".unread-badge").forEach((badge) => {
    badge.textContent = unreadAway > 99 ? "99+" : String(unreadAway);
    badge.classList.toggle("hidden", !unreadAway);
  });
}

function bumpUnread() {
  unreadAway += 1;
  paintUnread();
  document.querySelectorAll(".unread-badge").forEach((badge) => fx.pop(badge));
}

function showTab(name) {
  if (name === tab || !me) return;
  closeTools();
  closeGifs();
  if (tab === "chat") chatScroll = nearBottom() ? null : messagesEl.scrollTop;
  tab = name;
  chatView.dataset.tab = name;
  paintTabs();
  sound.play("tap");
  if (name === "profile") {
    openProfile();
    fx.view(profileView, 1);
    return;
  }
  unreadAway = 0;
  paintUnread();
  messagesEl.scrollTop = chatScroll ?? messagesEl.scrollHeight;
  markSeen();
  fx.view($(".conversation"), -1);
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-tab-target]");
  if (!target) return;
  showTab(target.dataset.tabTarget);
  if (target.classList.contains("tab")) fx.press(target);
});

// No perfil, Esc volta para a conversa.
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || tab !== "profile") return;
  event.stopPropagation();
  showTab("chat");
}, true);

// ---------- perfil (foto, números, tema, notificações, sons e sair) ----------

const PHOTO_SIZE = 320;
// Mesmo limite do servidor (AVATAR_GIF_MAX em lib/potato.php).
const GIF_PHOTO_MAX = 700000;
const longDate = (iso) => new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
const STAT_LABELS = { messages: ["mensagem", "mensagens"], reactions: ["reação", "reações"], days: ["dia de conversa", "dias de conversa"] };

function openProfile() {
  $("#profile-name").textContent = me;
  $("#photo-remove").classList.toggle("hidden", !avatars.has(me));
  repaintAvatars();
  loadStats();
}

// Dias de calendário desde a primeira mensagem, contando hoje.
function daysSince(iso) {
  const start = new Date(iso);
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today - start) / 864e5) + 1;
}

function loadStats() {
  if (!socket?.connected) return;
  socket.timeout(8000).emit("stats", null, (error, result) => {
    if (error || !result) return;
    const values = { messages: result.messages, reactions: result.reactions, days: result.since ? daysSince(result.since) : 0 };
    for (const [key, value] of Object.entries(values)) {
      const node = profileView.querySelector(`[data-stat="${key}"]`);
      fx.count(node, value);
      node.nextElementSibling.textContent = STAT_LABELS[key][value === 1 ? 0 : 1];
    }
    if (result.since) $("#profile-since").textContent = `No chat${peerName ? ` com ${peerName}` : ""} desde ${longDate(result.since)}`;
  });
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Não deu para abrir essa imagem. Tente uma foto JPG ou PNG.")); };
    image.src = url;
  });
}

function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Não deu para abrir esse GIF."));
    reader.readAsDataURL(file);
  });
}

// Recorta o centro num quadrado e reduz: a foto sobe leve (uns 30 KB) e já no formato do avatar.
// GIF vai inteiro, porque o recorte tiraria a animação (o avatar redondo já esconde as bordas).
async function squarePhoto(file) {
  if (!file.type.startsWith("image/")) throw new Error("Escolha um arquivo de imagem.");
  if (file.type === "image/gif") {
    if (file.size > GIF_PHOTO_MAX) throw new Error("Esse GIF é grande demais para foto (máximo de 700 KB).");
    return readDataUrl(file);
  }
  if (file.size > 25e6) throw new Error("Essa imagem é grande demais.");
  const image = await readImage(file);
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PHOTO_SIZE;
  const context = canvas.getContext("2d");
  context.fillStyle = "#24201a";
  context.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
  context.imageSmoothingQuality = "high";
  context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
  return canvas.toDataURL("image/jpeg", 0.86);
}

function savePhoto(image) {
  if (!socket?.connected) return toast("Sem conexão agora. Tente de novo em instantes.", "error");
  profileView.classList.add("busy");
  socket.timeout(20000).emit("avatar", { image }, (error, result) => {
    profileView.classList.remove("busy");
    if (error || !result?.ok) {
      toast(result?.error || "Não foi possível salvar a foto.", "error");
      sound.play("error");
      return;
    }
    presenceList = presenceList.map((user) => (user.name === me ? { ...user, avatar: result.avatar } : user));
    updatePresence(presenceList);
    $("#photo-remove").classList.toggle("hidden", !image);
    const face = $("#profile-face");
    fx.pop(face);
    if (image) {
      const box = face.getBoundingClientRect();
      fx.burst(box.left + box.width / 2, box.top + box.height / 2, ["✨", "💖", "⭐"], 14);
    }
    sound.play(image ? "sparkle" : "tap");
    toast(image ? "Foto atualizada" : "Foto removida", "ok");
  });
}

profileView.addEventListener("click", (event) => {
  if (event.target.closest("#profile-photo, #photo-pick")) $("#photo-input").click();
  else if (event.target.closest("#photo-remove")) savePhoto(null);
});

$("#photo-input").addEventListener("change", async () => {
  const [file] = $("#photo-input").files;
  $("#photo-input").value = "";
  if (!file) return;
  try {
    savePhoto(await squarePhoto(file));
  } catch (error) {
    toast(error.message, "error");
    sound.play("error");
  }
});

// ---------- tema ----------

const THEME_KEY = "potato.theme";
// Mesma lista do servidor (THEMES em lib/potato.php). bg e accent pintam a bolinha de cada tema.
const THEMES = [
  { id: "escuro", label: "Escuro", bg: "#12100d", accent: "#f5c04f" },
  { id: "preto", label: "Escuro total", bg: "#000000", accent: "#f5c04f" },
  { id: "rosa", label: "Rosa", bg: "#150c12", accent: "#ff7eb6" },
  { id: "roxo", label: "Roxo", bg: "#0f0d17", accent: "#b38dff" },
  { id: "azul", label: "Azul", bg: "#0a1017", accent: "#5cc8ff" },
  { id: "verde", label: "Verde", bg: "#0a120e", accent: "#5ee0a0" },
  { id: "claro", label: "Claro", bg: "#f6f1e9", accent: "#f2b33d" }
];
// false enquanto a escolha ainda não foi gravada no banco (sem conexão): ao reconectar, ela é enviada de novo.
let themeSaved = true;

const findTheme = (id) => THEMES.find((theme) => theme.id === id) || THEMES[0];

// Cores do tema para o painel da extensão pintar a barra de cima igual.
function themeColors() {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(["bg", "surface", "surface-2", "line", "ink", "muted", "accent"].map((name) => [name, style.getPropertyValue(`--${name}`).trim()]));
}

function applyTheme(id) {
  const theme = findTheme(id);
  document.documentElement.dataset.theme = theme.id;
  document.querySelector('meta[name="theme-color"]').content = theme.bg;
  store.set("localStorage", THEME_KEY, theme.id);
  $("#themes").querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.themeChoice === theme.id));
  });
  tellParent({ type: "potato:theme", colors: themeColors() });
}

// O tema fica na conta (no banco): vale em qualquer aparelho em que a pessoa entrar.
function saveTheme() {
  themeSaved = false;
  if (!socket?.connected) return;
  const theme = document.documentElement.dataset.theme;
  socket.timeout(10000).emit("theme", { theme }, (error, result) => {
    if (!error && result?.ok && document.documentElement.dataset.theme === theme) themeSaved = true;
  });
}

// Tema da conta, que chega com o histórico. Se a última escolha daqui não chegou ao banco, ela vale.
function syncTheme(theme) {
  if (!themeSaved) return saveTheme();
  if (theme) applyTheme(theme);
}

function renderThemes() {
  const holder = $("#themes");
  for (const theme of THEMES) {
    const button = el("button", "theme-choice");
    button.type = "button";
    button.dataset.themeChoice = theme.id;
    const swatch = el("span", "swatch");
    swatch.style.setProperty("--sw-bg", theme.bg);
    swatch.style.setProperty("--sw-accent", theme.accent);
    button.append(swatch, el("span", "", theme.label));
    holder.append(button);
  }
  holder.addEventListener("click", (event) => {
    const choice = event.target.closest("[data-theme-choice]");
    if (!choice || choice.getAttribute("aria-pressed") === "true") return;
    const box = choice.querySelector(".swatch").getBoundingClientRect();
    sound.play("whoosh");
    // saveTheme lê o tema já aplicado, então espera a troca acontecer.
    fx.reveal(() => applyTheme(choice.dataset.themeChoice), box.left + box.width / 2, box.top + box.height / 2).then(saveTheme, saveTheme);
  });
}

// ---------- presença e digitação ----------

function updatePresence(users) {
  presenceList = users;
  avatars.clear();
  users.forEach((user) => setAvatar(user.name, user.avatar));
  repaintAvatars();
  const others = users.filter((user) => user.name !== me);
  const peer = others.find((user) => user.online)
    || others.sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)))[0];
  peerName = peer?.name || "";

  if (peer && peerWasOnline !== null && peer.online !== peerWasOnline) {
    sound.play(peer.online ? "join" : "leave");
    toast(peer.online ? `${peer.name} está online` : `${peer.name} saiu do chat`, peer.online ? "ok" : "info");
    if (peer.online) fx.pop(peerAvatar);
  }
  peerWasOnline = peer ? peer.online : null;

  roomTitle.textContent = peer ? peer.name : "Aguardando alguém";
  paintAvatar(peerAvatar, peerName);
  peerAvatar.classList.toggle("online", Boolean(peer?.online));
  paintPeerStatus();

  // Botões de chamada apagadinhos enquanto a outra pessoa está offline.
  for (const button of document.querySelectorAll("#audio-call, #video-call, #share-screen")) {
    button.classList.toggle("unavailable", !peer?.online);
    button.title = peer?.online ? button.dataset.title : `${peer?.name || "A outra pessoa"} está offline`;
  }

  // A conversa com a outra pessoa (você fica embaixo, no seu perfil). Clicar volta para a conversa.
  const row = el("button", `person${peer?.online ? " online" : ""}`);
  row.type = "button";
  row.dataset.tabTarget = "chat";
  const avatar = el("div", "avatar");
  paintAvatar(avatar, peerName);
  avatar.classList.toggle("online", Boolean(peer?.online));
  const text = el("div");
  text.append(el("strong", "", peer ? peer.name : "Aguardando alguém"),
    el("small", "", !peer ? "Ainda sem a outra pessoa" : peer.online ? (peer.active ? "Ativo agora" : "Online") : lastSeenLabel(peer.lastSeen)));
  row.append(avatar, text, el("span", "tab-badge unread-badge hidden"));
  peopleEl.replaceChildren(row);
  paintTabs();
  paintUnread();
}

function peerOnline() {
  return presenceList.some((user) => user.name === peerName && user.online);
}

function paintPeerStatus() {
  const peer = presenceList.find((user) => user.name === peerName);
  peerStatus.classList.toggle("live", Boolean(peerTyping || peer?.online));
  if (peerTyping) peerStatus.textContent = "digitando…";
  else if (!peer) peerStatus.textContent = "Mande o link para a outra pessoa criar a conta dela";
  else if (peer.online) peerStatus.textContent = peer.active ? "online agora" : "online";
  else peerStatus.textContent = lastSeenLabel(peer.lastSeen);
}

function setPeerTyping(active) {
  clearTimeout(peerTypingTimer);
  if (active) peerTypingTimer = setTimeout(() => setPeerTyping(false), 5000);
  if (active === peerTyping) return;
  peerTyping = active;
  typingText.textContent = active ? `${peerName || "A outra pessoa"} está digitando` : "";
  fx.typing(typingEl, active);
  paintPeerStatus();
}

setInterval(() => { if (chatShown) { paintPeerStatus(); updatePresence(presenceList); } }, 60000);

// ---------- chamadas (estilo Discord: voz, câmera e transmissão de tela na mesma chamada) ----------

const mediaLabel = { audio: "Chamada de voz", video: "Chamada de vídeo", screen: "Transmissão de tela" };
// Canais fixos da chamada, sempre nesta ordem. Ligar câmera ou tela no meio da chamada só troca a faixa, sem religar nada.
const SLOTS = ["mic", "cam", "screen", "screenAudio"];
const SLOT_KIND = { mic: "audio", cam: "video", screen: "video", screenAudio: "audio" };
const QUALITY_KEY = "potato.quality";
const QUALITY = {
  "720p": { width: 1280, height: 720, frameRate: 30, bitrate: 2_500_000, hint: "detail" },
  "1080p": { width: 1920, height: 1080, frameRate: 30, bitrate: 4_500_000, hint: "detail" },
  "1080p60": { width: 1920, height: 1080, frameRate: 60, bitrate: 8_000_000, hint: "motion" }
};
const canStream = Boolean(navigator.mediaDevices?.getDisplayMedia);

const stage = $("#stage");
const streamTile = $("#stream-tile");
const streamVideo = $("#stream-video");
const tileMe = $("#tile-me");
const tilePeer = $("#tile-peer");
const remoteAudio = $("#remote-audio");
const qualityMenu = $("#quality-menu");
const callInfo = $(".call-info");
const SPEAKING_LEVEL = 0.025;

function setToggle(button, on, titleOn, titleOff) {
  button.classList.toggle("is-off", !on);
  button.title = on ? titleOn : titleOff;
  button.setAttribute("aria-pressed", String(on));
}

function mediaDeniedText() {
  return inExtension
    ? "O painel lateral não conseguiu usar câmera, microfone ou tela. Abra nosso chat numa aba (botão de abrir em aba, no topo do painel) para fazer chamadas."
    : "Permissão de câmera, microfone ou tela não concedida.";
}

function newCall(fields) {
  return {
    connected: false,
    accepted: false,
    slots: null,
    local: { mic: null, cam: null, screen: null, screenAudio: null },
    remote: {},
    remoteState: { mic: true, cam: false, screen: false },
    ...fields
  };
}

const micOn = () => Boolean(call?.local.mic?.enabled);
const currentQuality = () => call?.quality || store.get("localStorage", QUALITY_KEY) || "1080p";

function myState() {
  return { mic: micOn(), cam: Boolean(call?.local.cam), screen: Boolean(call?.local.screen) };
}

// Avisa a outra pessoa o que está ligado (microfone, câmera, transmissão).
function sendState() {
  if (call?.slots) socket?.emit("call-state", { to: call.peerId, ...myState() });
}

function receiveCallState(state) {
  if (!call) return;
  const before = call.remoteState;
  call.remoteState = { mic: Boolean(state.mic), cam: Boolean(state.cam), screen: Boolean(state.screen) };
  if (call.remoteState.screen && !before.screen) {
    toast(`${call.name} começou a transmitir a tela`, "live");
    sound.play("join");
  }
  if (!call.remoteState.screen && before.screen) sound.play("leave");
  paintStage();
}

function attach(slot) {
  const transceiver = call?.slots?.[slot];
  if (!transceiver) return Promise.resolve();
  return transceiver.sender.replaceTrack(call.local[slot] || null).catch(() => {});
}

function paintTile(tile, { video, muted, live }) {
  const element = tile.querySelector("video");
  const id = video?.id || "";
  if (element.dataset.track !== id) {
    element.srcObject = video ? new MediaStream([video]) : null;
    element.dataset.track = id;
  }
  tile.classList.toggle("has-video", Boolean(video));
  tile.classList.toggle("muted", muted);
  tile.classList.toggle("live", live);
}

function paintStage() {
  if (!call) return;
  const { local, remote, remoteState } = call;
  const peerLive = Boolean(remoteState.screen && remote.screen);
  const owner = peerLive ? "peer" : local.screen ? "me" : null;

  stage.classList.toggle("has-stream", Boolean(owner));
  streamTile.classList.toggle("hidden", !owner);
  if (owner) {
    const tracks = (owner === "peer" ? [remote.screen, remote.screenAudio] : [local.screen]).filter(Boolean);
    const ids = tracks.map((track) => track.id).join();
    if (streamVideo.dataset.tracks !== ids) {
      streamVideo.srcObject = new MediaStream(tracks);
      streamVideo.dataset.tracks = ids;
    }
    streamVideo.muted = owner === "me";
    $("#stream-owner").textContent = owner === "me" ? "Sua transmissão" : `Transmissão de ${call.name}`;
    $("#stream-volume-wrap").classList.toggle("hidden", owner === "me");
  } else if (streamVideo.srcObject) {
    streamVideo.srcObject = null;
    delete streamVideo.dataset.tracks;
  }

  paintTile(tileMe, { video: local.cam, muted: !micOn(), live: Boolean(local.screen) });
  paintTile(tilePeer, { video: remoteState.cam ? remote.cam : null, muted: !remoteState.mic, live: peerLive });

  setToggle($("#toggle-mic"), micOn(), "Silenciar microfone", "Ativar microfone");
  setToggle($("#toggle-cam"), Boolean(local.cam), "Desligar câmera", "Ligar câmera");
  setToggle($("#toggle-live"), Boolean(local.screen), "Parar transmissão", "Transmitir tela");
}

function openCallPanel(status) {
  const peer = call.name || peerName;
  callStatus.textContent = status;
  callInfo.classList.remove("live");
  callTimer.textContent = "";
  paintAvatar($("#me-face"), me);
  paintAvatar($("#call-avatar-face"), peer);
  $("#peer-tile-name").textContent = peer;
  tileMe.title = "Você";
  tilePeer.title = peer;
  tilePeer.classList.add("ringing");
  setToggle($("#toggle-chat"), true, "Esconder o chat", "Mostrar o chat");
  messageInput.placeholder = "Mensagem…";
  $("#toggle-live").classList.toggle("hidden", !canStream);
  // A chamada fica na aba da conversa.
  showTab("chat");
  chatView.classList.add("in-call");
  paintStage();
  fx.show(callPanel, { y: -20, scale: 0.97 });
  scrollToLatest();
}

function createPeer() {
  peerConnection = new RTCPeerConnection(rtcConfig);
  peerConnection.onicecandidate = ({ candidate }) => candidate && socket.emit("webrtc-ice", { candidate, to: call?.peerId });
  peerConnection.ontrack = ({ track, transceiver }) => {
    if (!call) return;
    const slot = SLOTS[peerConnection.getTransceivers().indexOf(transceiver)];
    if (!slot) return;
    call.remote[slot] = track;
    if (slot === "mic") remoteAudio.srcObject = new MediaStream([track]);
    paintStage();
  };
  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection?.connectionState;
    if (state === "connected") {
      onConnected();
      if (call) callStatus.textContent = `Em chamada com ${call.name}`;
    }
    if (state === "disconnected") callStatus.textContent = "Conexão instável…";
    if (state === "failed") {
      toast("A chamada caiu. Redes muito restritas podem precisar de um servidor TURN.", "error");
      sound.play("error");
      teardown(true);
    }
  };
  return peerConnection;
}

// Anel verde em volta de quem está falando.
function watchSpeaking() {
  const meters = new Map();
  const until = { me: 0, peer: 0 };
  const level = (track) => {
    if (!track) return 0;
    if (!meters.has(track.id)) meters.set(track.id, sound.meter(new MediaStream([track])));
    return meters.get(track.id)();
  };
  const tick = () => {
    if (!call) return;
    const now = performance.now();
    if (micOn() && level(call.local.mic) > SPEAKING_LEVEL) until.me = now + 300;
    if (call.remoteState.mic && level(call.remote.mic) > SPEAKING_LEVEL) until.peer = now + 300;
    tileMe.classList.toggle("speaking", now < until.me);
    tilePeer.classList.toggle("speaking", now < until.peer);
    call.frame = requestAnimationFrame(tick);
  };
  tick();
}

function onConnected() {
  if (!call || call.connected) return;
  call.connected = true;
  clearTimeout(call.timeout);
  sound.stopLoop();
  sound.play("connected");
  tilePeer.classList.remove("ringing");
  callInfo.classList.add("live");
  const started = Date.now();
  call.clock = setInterval(() => {
    const seconds = Math.floor((Date.now() - started) / 1000);
    callTimer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }, 1000);
  sendState();
  tuneScreen();
  watchSpeaking();
}

async function acquireMic(active) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (active !== call) return stream.getTracks().forEach((track) => track.stop());
    active.local.mic = stream.getAudioTracks()[0];
  } catch {
    if (active === call) toast(inExtension ? mediaDeniedText() : "Sem microfone: você está mudo na chamada.");
  }
}

async function toggleMic() {
  if (!call) return;
  if (!call.local.mic) {
    await acquireMic(call);
    await attach("mic");
  } else {
    call.local.mic.enabled = !call.local.mic.enabled;
  }
  sendState();
  paintStage();
  fx.press($("#toggle-mic"));
}

async function toggleCam() {
  const active = call;
  if (!active) return;
  if (active.local.cam) {
    active.local.cam.stop();
    active.local.cam = null;
  } else {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
      if (active !== call) return stream.getTracks().forEach((track) => track.stop());
      active.local.cam = stream.getVideoTracks()[0];
    } catch {
      toast(mediaDeniedText(), "error");
      return;
    }
  }
  await attach("cam");
  sendState();
  paintStage();
  fx.press($("#toggle-cam"));
}

// Qualidade da transmissão: taxa de bits e prioridade (nitidez para texto ou fluidez para jogos).
async function tuneScreen() {
  const sender = call?.slots?.screen?.sender;
  const quality = QUALITY[call?.quality];
  if (!sender || !quality || !call.local.screen) return;
  const params = sender.getParameters();
  if (!params.encodings?.length) return;
  params.encodings[0].maxBitrate = quality.bitrate;
  params.encodings[0].maxFramerate = quality.frameRate;
  try {
    await sender.setParameters({ ...params, degradationPreference: quality.hint === "motion" ? "maintain-framerate" : "maintain-resolution" });
  } catch {
    await sender.setParameters(params).catch(() => {});
  }
}

async function startLive(key = currentQuality()) {
  const active = call;
  if (!active || !canStream) return false;
  const quality = QUALITY[key] || QUALITY["1080p"];
  let display;
  try {
    display = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: quality.width }, height: { ideal: quality.height }, frameRate: { ideal: quality.frameRate, max: quality.frameRate } },
      audio: true,
      systemAudio: "include",
      surfaceSwitching: "include",
      selfBrowserSurface: "exclude"
    });
  } catch {
    toast(inExtension ? mediaDeniedText() : "Transmissão cancelada.");
    return false;
  }
  if (active !== call) {
    display.getTracks().forEach((track) => track.stop());
    return false;
  }
  stopLive(false);
  const [video] = display.getVideoTracks();
  video.contentHint = quality.hint;
  active.local.screen = video;
  active.local.screenAudio = display.getAudioTracks()[0] || null;
  active.quality = key;
  store.set("localStorage", QUALITY_KEY, key);
  video.addEventListener("ended", () => { if (call?.local.screen === video) stopLive(); });
  await Promise.all([attach("screen"), attach("screenAudio")]);
  await tuneScreen();
  sendState();
  paintStage();
  if (active.slots) sound.play("join");
  return true;
}

function stopLive(notify = true) {
  if (!call?.local.screen) return;
  call.local.screen.stop();
  call.local.screenAudio?.stop();
  call.local.screen = null;
  call.local.screenAudio = null;
  attach("screen");
  attach("screenAudio");
  if (!notify) return;
  sendState();
  paintStage();
  sound.play("leave");
}

async function startCall(media) {
  if (call) {
    if (media === "video" && !call.local.cam) return toggleCam();
    if (media === "screen" && !call.local.screen) return startLive();
    return toast("Você já está numa chamada.");
  }
  if (!peerOnline()) {
    sound.play("error");
    return toast(`${peerName || "A outra pessoa"} não está online agora.`);
  }
  const active = call = newCall({ media, role: "caller", name: peerName });
  // A tela é escolhida primeiro, enquanto o clique ainda vale para o navegador.
  if (media === "screen" && !(await startLive())) return teardown(false);
  if (active !== call) return;
  await acquireMic(active);
  if (media === "video") await toggleCam();
  if (active !== call) return;

  openCallPanel(`Chamando ${active.name}…`);
  try {
    const peer = createPeer();
    active.slots = Object.fromEntries(SLOTS.map((slot) => [slot, peer.addTransceiver(SLOT_KIND[slot], { direction: "sendrecv" })]));
    await Promise.all(SLOTS.map(attach));
    await peer.setLocalDescription(await peer.createOffer());
    socket.emit("webrtc-offer", { description: peer.localDescription, media, state: myState() });
  } catch {
    sound.play("error");
    toast("Não foi possível iniciar a chamada.", "error");
    return teardown(false);
  }
  sound.loop("ringback");
  active.timeout = setTimeout(() => {
    if (call === active && !active.connected) {
      toast("Sem resposta.");
      sound.play("hangup");
      teardown(true);
    }
  }, 45000);
}

function receiveOffer({ description, media, name, from, state }) {
  if (call) {
    socket.emit("call-declined", { to: from });
    return;
  }
  call = newCall({ media, role: "callee", peerId: from, offer: description, name });
  call.remoteState = state || { mic: true, cam: media === "video", screen: media === "screen" };
  paintAvatar($("#incoming-face"), name);
  $("#incoming-title").textContent = `${name} está ligando`;
  $("#incoming-kind").textContent = mediaLabel[media] || "Chamada";
  incoming.classList.remove("hidden");
  fx.incoming(incoming.querySelector(".incoming-card"));
  sound.loop("ring");
  if (document.hidden && notificationsOn()) {
    try { new Notification(`${name} está ligando`, { body: mediaLabel[media], tag: "potato-call", requireInteraction: true }); } catch {}
  }
  const active = call;
  call.timeout = setTimeout(() => {
    if (call === active && !active.accepted) {
      toast(`Chamada perdida de ${name}.`);
      socket.emit("call-declined", { to: from });
      teardown(false);
    }
  }, 45000);
}

async function acceptCall() {
  if (!call || call.role !== "callee") return;
  const active = call;
  active.accepted = true;
  clearTimeout(active.timeout);
  sound.stopLoop();
  incoming.classList.add("hidden");
  try {
    await acquireMic(active);
    if (active.media === "video") await toggleCam();
    if (active !== call) return;
    openCallPanel("Conectando…");
    const peer = createPeer();
    await peer.setRemoteDescription(active.offer);
    const transceivers = peer.getTransceivers();
    active.slots = Object.fromEntries(SLOTS.map((slot, index) => [slot, transceivers[index]]).filter(([, transceiver]) => transceiver));
    transceivers.forEach((transceiver) => { transceiver.direction = "sendrecv"; });
    await Promise.all(SLOTS.map(attach));
    await flushCandidates();
    await peer.setLocalDescription(await peer.createAnswer());
    socket.emit("webrtc-answer", { description: peer.localDescription, to: active.peerId, state: myState() });
  } catch {
    sound.play("error");
    toast(inExtension ? mediaDeniedText() : "Não foi possível entrar na chamada.", "error");
    teardown(true);
  }
}

function declineCall() {
  if (!call) return;
  socket.emit("call-declined", { to: call.peerId });
  sound.play("hangup");
  teardown(false);
}

async function receiveAnswer({ description, from, state }) {
  if (call?.role !== "caller" || !peerConnection) return;
  call.peerId = from;
  if (state) call.remoteState = state;
  sound.stopLoop();
  callStatus.textContent = "Conectando…";
  await peerConnection.setRemoteDescription(description);
  await flushCandidates();
  paintStage();
}

async function receiveIce({ candidate }) {
  if (!call) return;
  if (!peerConnection?.remoteDescription) pendingCandidates.push(candidate);
  else await peerConnection.addIceCandidate(candidate).catch(() => {});
}

async function flushCandidates() {
  for (const candidate of pendingCandidates.splice(0)) await peerConnection.addIceCandidate(candidate).catch(() => {});
}

function teardown(notifyPeer) {
  if (notifyPeer && call) socket?.emit("call-ended", { to: call.peerId });
  if (notifyPeer && call?.connected) sound.play("hangup");
  if (call) {
    clearTimeout(call.timeout);
    clearInterval(call.clock);
    cancelAnimationFrame(call.frame);
    Object.values(call.local).forEach((track) => track?.stop());
  }
  sound.stopLoop();
  peerConnection?.close();
  peerConnection = null;
  pendingCandidates = [];
  call = null;
  for (const media of [streamVideo, remoteAudio, ...stage.querySelectorAll("video")]) {
    media.srcObject = null;
    delete media.dataset.track;
    delete media.dataset.tracks;
  }
  incoming.classList.add("hidden");
  qualityMenu.classList.add("hidden");
  chatView.classList.remove("call-expanded", "in-call");
  callInfo.classList.remove("live");
  messageInput.placeholder = "Escreva uma mensagem…";
  [tileMe, tilePeer].forEach((tile) => tile.classList.remove("speaking", "has-video", "live", "muted", "ringing"));
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  fx.hide(callPanel, { y: -20, scale: 0.97 });
  requestAnimationFrame(() => scrollToLatest());
}

function paintQualityMenu() {
  qualityMenu.querySelectorAll("[data-quality]").forEach((option) => option.classList.toggle("selected", option.dataset.quality === currentQuality()));
}

function toggleFullscreen() {
  if (document.fullscreenElement) return document.exitFullscreen().catch(() => {});
  streamTile.requestFullscreen?.().catch(() => {});
}

$("#audio-call").addEventListener("click", () => startCall("audio"));
$("#video-call").addEventListener("click", () => startCall("video"));
$("#share-screen").addEventListener("click", () => startCall("screen"));
$("#share-screen").classList.toggle("hidden", !canStream);
$("#toggle-mic").addEventListener("click", toggleMic);
$("#toggle-cam").addEventListener("click", toggleCam);
$("#toggle-live").addEventListener("click", (event) => {
  event.stopPropagation();
  if (call?.local.screen) return stopLive();
  paintQualityMenu();
  qualityMenu.classList.toggle("hidden");
});
qualityMenu.addEventListener("click", (event) => {
  const option = event.target.closest("[data-quality]");
  if (!option) return;
  qualityMenu.classList.add("hidden");
  startLive(option.dataset.quality);
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".live-wrap")) qualityMenu.classList.add("hidden");
});
$("#toggle-chat").addEventListener("click", () => {
  const hidden = chatView.classList.toggle("call-expanded");
  setToggle($("#toggle-chat"), !hidden, "Esconder o chat", "Mostrar o chat");
  if (!hidden) scrollToLatest();
});
$("#stream-full").addEventListener("click", toggleFullscreen);
streamTile.addEventListener("dblclick", toggleFullscreen);
$("#stream-volume").addEventListener("input", (event) => { streamVideo.volume = Number(event.target.value); });
$("#end-call").addEventListener("click", () => teardown(true));
$("#accept-call").addEventListener("click", acceptCall);
$("#decline-call").addEventListener("click", declineCall);
window.addEventListener("beforeunload", () => { if (call) socket?.emit("call-ended", { to: call.peerId }); });

// ---------- ponte com a extensão ----------

window.addEventListener("message", (event) => {
  if (!inExtension || event.source !== window.parent || event.origin !== parentOrigin) return;
  const data = event.data || {};
  if (data.type === "potato:session" && data.token && !socket) {
    startSession({ token: data.token, name: data.name }, { animate: true });
  }
});

// ---------- batatinha plantada ----------

const PLANT_KEY = "potato.plant";
// Cada rega faz o broto crescer um pouco; com flor, o próximo toque colhe e ela volta a ser semente.
const PLANT_NOTES = ["Toque para regar a batatinha", "Ela gostou! Mais um pouquinho de água…", "Olha o broto crescendo 🌱", "Floriu! Toque para colher 🌼"];
let plantStage = Math.min(3, Math.max(0, Number(store.get("localStorage", PLANT_KEY)) || 0));

function paintPlants() {
  document.querySelectorAll(".planted").forEach((plant) => {
    plant.dataset.stage = plantStage;
    plant.title = plantStage === 3 ? "Colher a batatinha 🥔" : "Regar a batatinha 💧";
  });
  $("#plant-note").textContent = PLANT_NOTES[plantStage];
}

document.querySelectorAll("[data-plant]").forEach((slot) => slot.append($("#plant-template").content.cloneNode(true)));
paintPlants();

document.addEventListener("click", (event) => {
  const plant = event.target.closest(".planted");
  if (!plant) return;
  const box = plant.getBoundingClientRect();
  if (plantStage === 3) {
    plantStage = 0;
    fx.harvest(plant);
    fx.rain(["🥔", "🍟", "🌱"], 26);
    sound.play("sparkle");
    toast("Colheita! Uma batata fresquinha 🥔", "ok");
  } else {
    plantStage += 1;
    fx.water(plant);
    fx.burst(box.left + box.width / 2, box.top + box.height * 0.3, ["💧", "💧", "✨"], 9);
    sound.play("react");
  }
  store.set("localStorage", PLANT_KEY, plantStage);
  paintPlants();
});

// ---------- início ----------

document.querySelectorAll(".hero-potato, .potato-mini").forEach((potato) => potato.addEventListener("click", () => {
  fx.squish(potato.querySelector("svg") || potato);
  sound.play("whoosh");
}));

renderThemes();
applyTheme(store.get("localStorage", THEME_KEY));
paintSound();
paintNotifyButton();
paintTabs();
fx.ambient();
const saved = store.get("localStorage", SESSION_KEY) || store.get("sessionStorage", SESSION_KEY);
if (saved?.token) {
  showChat(false);
  startSession(saved, { animate: false });
} else {
  fx.intro();
  loadWelcome();
  tellParent({ type: "potato:ready" });
  // Cursor já no campo certo (no celular não, para o teclado não pular na cara).
  if (!matchMedia("(pointer: coarse)").matches) (rememberedName ? $("#password") : $("#name")).focus({ preventScroll: true });
}
