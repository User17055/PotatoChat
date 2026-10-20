import { sound } from "./sound.js";
import { fx, effectFor, motion } from "./fx.js";
import { io, apiUrl } from "./realtime.js";
import { createPlayer } from "./music.js";
import { createWatchPlayer } from "./watch.js";

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
// "" (nada), "text" (digitando) ou "audio" (gravando um áudio).
let peerTyping = "";
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
// Maior foto ou arquivo que o servidor aceita (também vem com o histórico; 0 = ainda não chegou).
let fileMax = 0;
// Transcrição das mensagens de voz ligada no config.php (também vem com o histórico).
let transcribeOn = false;

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
  // "Hoje" e "Ontem" pela hora do servidor: o relógio do celular pode estar errado.
  const today = new Date(Date.now() + musicClock);
  const yesterday = new Date(today - 864e5);
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

// Texto curto da mensagem (citação da resposta, notificação): GIF e arquivo sem legenda não têm texto.
const FILE_LABEL = { image: "Foto", video: "Vídeo", audio: "Áudio" };
const previewText = (message) => (message.gif ? "GIF"
  : message.music ? `Música: ${message.music.title}`
  : message.file?.voice ? `Mensagem de voz (${clockTime(message.file.voice.duration)})`
  : message.file && !message.text ? FILE_LABEL[message.file.kind] || message.file.name
  : message.text);

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

const TOAST_ICON = { ok: "check-circle", error: "x-circle", live: "radio", info: "info", music: "music" };

function toast(text, kind = "info", iconName = TOAST_ICON[kind] || "info") {
  const node = el("div", `toast ${kind}`);
  node.append(icon(iconName), el("span", "", text));
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
  store.remove("localStorage", WALL_KEY);
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
    fileMax = payload.fileMax || 0;
    transcribeOn = Boolean(payload.transcribe);
    syncTheme(payload.theme);
    applyWallpaper(payload.wallpaper);
    applyMusic(payload.music, true);
    applyWatch(payload.watch, true, false);
    renderAll();
    scrollToLatest();
    markSeen();
  });

  socket.on("message", (message) => receive(message, true));
  socket.on("message:update", updateMessage);
  socket.on("seen", ({ name, id, at }) => { reads[name] = { id, at }; refreshStatuses(); });
  socket.on("presence", updatePresence);
  socket.on("typing", ({ active, audio }) => setPeerTyping(active, audio));
  // Tema trocado em outra aba ou aparelho da mesma pessoa.
  // Papel de parede trocado em outra aba ou aparelho da mesma pessoa.
  socket.on("wallpaper", ({ wallpaper: next }) => applyWallpaper(next));
  // Bot de música: alguém deu um comando (aqui ou no outro aparelho).
  socket.on("music", ({ state, action }) => {
    applyMusic(state);
    musicNotice(action);
  });
  // Watch Party.
  socket.on("watch", ({ state, action }) => {
    applyWatch(state);
    watchNotice(action);
  });

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
    // A foto continua vindo da cópia local: trocar pelo endereço do servidor faria a imagem piscar.
    if (local.file?.preview && message.file) message.file.preview = local.file.preview;
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
  if (message.deleted && playback.key === voiceKey(previous)) stopVoice();
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

function dayNode(iso) {
  const node = el("div", "day", dayLabel(iso));
  node.dataset.key = dayKey(iso);
  return node;
}

function needsDay(previous, message) {
  return !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt);
}

// Mensagens seguidas da mesma pessoa ficam juntinhas. Os cartões de música (no meio da conversa) não entram:
// eles têm sempre o mesmo espaço em volta.
function isGrouped(previous, message) {
  return Boolean(previous) && !previous.music && !message.music && previous.sender === message.sender && !needsDay(previous, message)
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
  // Nunca dois separadores seguidos do mesmo dia.
  const lastDay = [...messagesEl.querySelectorAll(".day")].pop();
  if (needsDay(previous, message) && lastDay?.dataset.key !== dayKey(message.createdAt)) messagesEl.append(dayNode(message.createdAt));
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
    if (needsDay(previous, message)) fragment.append(dayNode(message.createdAt));
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

  if (message.music && !message.deleted) {
    article.classList.add("music-note");
    bubble.classList.add("music-card");
    bubble.append(musicCard(message));
  } else if (message.file?.voice && !message.deleted) {
    bubble.classList.add("attachment", "is-voice");
    bubble.append(voiceView(message));
  } else if (message.file && !message.deleted) {
    bubble.classList.add("attachment", `is-${message.file.kind}`);
    bubble.append(fileView(message.file));
    if (message.upload && !message.id) {
      const bar = el("span", "upload-bar");
      bar.style.setProperty("--p", message.upload.progress);
      bar.append(el("i"));
      bubble.append(bar);
    }
    if (message.text) {
      bubble.classList.add("has-caption");
      const caption = el("div", "text caption");
      caption.append(richText(message.text));
      bubble.append(caption);
    }
  } else if (message.gif && !message.deleted) {
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
    if (message.file) {
      const save = el("button", "tool");
      save.type = "button";
      save.dataset.action = "download";
      save.title = "Baixar";
      save.append(icon("download"));
      tools.append(save);
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

// Mensagem de texto, de GIF (gif = { url, width, height, title }, sem texto) ou com foto/arquivo
// (upload = o arquivo escolhido, que sobe antes da mensagem; ver uploadFile). Áudio gravado no chat
// leva upload.voice = { duration, peaks } (ver stopRecording).
function send(text, gif = null, upload = null) {
  const clean = gif || upload ? "" : text.trim();
  if ((!clean && !gif && !upload) || !me) return;
  const message = {
    id: null,
    clientId: uid(),
    sender: me,
    text: clean.slice(0, 2000),
    gif,
    file: upload && { url: null, preview: URL.createObjectURL(upload.blob), name: upload.blob.name, type: upload.blob.type, kind: fileKind(upload.blob.type), size: upload.blob.size, width: upload.width, height: upload.height, voice: upload.voice },
    upload: upload && { blob: upload.blob, key: null, progress: 0, xhr: null },
    // Hora do servidor (o relógio do celular pode estar errado e criaria um "Hoje" a cada mensagem).
    createdAt: new Date(Date.now() + musicClock).toISOString(),
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
  if (message.upload && !message.upload.key) return uploadFile(message);
  const node = () => messagesEl.querySelector(`[data-client-id="${message.clientId}"]`);
  message.status = "pending";
  if (node()) paintStatus(node());
  socket.timeout(10000).emit("message", { text: message.text, gif: message.gif, file: message.upload?.key, voice: message.file?.voice, clientId: message.clientId, replyTo: message.replyTo?.id }, (error, result) => {
    if (!pending.has(message.clientId)) return;
    if (!error && result?.ok) return receive(result.message, true);
    message.status = "failed";
    if (node()) paintStatus(node());
    if (result?.error) toast(result.error, "error");
    sound.play("error");
  });
}

// Sobe o arquivo (a barra do balão mostra o progresso) e depois manda a mensagem com a chave dele.
function uploadFile(message) {
  const upload = message.upload;
  if (upload.xhr) return;
  const node = () => messagesEl.querySelector(`[data-client-id="${message.clientId}"]`);
  const fail = (error) => {
    upload.xhr = null;
    message.status = "failed";
    if (node()) paintStatus(node());
    toast(error, "error");
    sound.play("error");
  };
  message.status = "pending";
  if (node()) paintStatus(node());
  const xhr = upload.xhr = new XMLHttpRequest();
  xhr.open("POST", apiUrl("upload"));
  xhr.setRequestHeader("Content-Type", upload.blob.type || "application/octet-stream");
  xhr.setRequestHeader("X-Potato-Token", socket.auth.token);
  xhr.setRequestHeader("X-Potato-Name", encodeURIComponent(upload.blob.name || "arquivo"));
  xhr.upload.onprogress = (event) => {
    if (!event.lengthComputable) return;
    upload.progress = event.loaded / event.total;
    node()?.querySelector(".upload-bar")?.style.setProperty("--p", upload.progress);
  };
  xhr.onload = () => {
    let result = null;
    try { result = JSON.parse(xhr.responseText); } catch {}
    if (xhr.status !== 200 || !result?.ok) return fail(result?.error || "Não foi possível enviar o arquivo.");
    upload.xhr = null;
    upload.key = result.file.key;
    deliver(message);
  };
  xhr.onerror = () => fail("O arquivo não subiu. Toque no aviso vermelho da mensagem para tentar de novo.");
  xhr.send(upload.blob);
}

// Celular: tocar no enviar (ou num emoji rápido) não tira o foco do campo. Assim o teclado continua aberto,
// a tela não pula para baixo e o primeiro toque já envia.
messageForm.addEventListener("mousedown", (event) => {
  if (document.activeElement === messageInput && event.target.closest(".send, .quick-emojis button")) event.preventDefault();
});

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!messageInput.value.trim()) return;
  // Comandos do bot de música (/play…) não viram mensagem.
  if (!runCommand(messageInput.value.trim())) send(messageInput.value);
  commandMenu.classList.add("hidden");
  fx.sendButton(messageForm.querySelector(".send"));
  messageInput.value = "";
  messageInput.style.height = "auto";
  messageInput.style.overflowY = "hidden";
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    // "/pl" + Enter completa o comando, em vez de mandar o texto.
    const first = !commandMenu.classList.contains("hidden") && commandMenu.querySelector("[data-command]");
    if (first && messageInput.value.trim() !== `/${first.dataset.command}`) return pickCommand(first.dataset.command);
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
  closeAttach();
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

// ---------- fotos e arquivos ----------

const attachButton = $("#attach-button");
const attachMenu = $("#attach-menu");
const viewer = $("#viewer");
const dropZone = $("#drop-zone");
const conversationEl = $(".conversation");
// Foto com lado maior que isso é reduzida no navegador antes de subir.
const PHOTO_SIDE = 2048;
const MEDIA_MAX_WIDTH = 300;
const MEDIA_MAX_HEIGHT = 360;

function fileKind(type) {
  if (/^image\/(jpeg|png|gif|webp)$/.test(type)) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return "file";
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1).replace(".", ",")} MB`;
}

// Foto, vídeo, áudio ou cartão de arquivo dentro do balão. O tamanho da foto fica reservado antes de carregar.
function fileView(file) {
  const src = file.preview || file.url;
  if (file.kind === "image") {
    const image = el("img", "photo-media");
    image.src = src;
    image.alt = file.name;
    image.decoding = "async";
    image.draggable = false;
    image.dataset.view = "";
    if (file.width && file.height) {
      const scale = Math.min(1, MEDIA_MAX_WIDTH / file.width, MEDIA_MAX_HEIGHT / file.height);
      image.style.width = `${Math.round(file.width * scale)}px`;
      image.style.aspectRatio = `${file.width} / ${file.height}`;
    }
    return image;
  }
  if (file.kind === "video" || file.kind === "audio") {
    const media = el(file.kind, file.kind === "video" ? "photo-media" : "audio-media");
    media.src = src;
    media.controls = true;
    media.preload = "metadata";
    if (file.kind === "video") media.playsInline = true;
    return media;
  }
  const card = el("div", "file-card");
  card.dataset.download = "";
  card.title = `Baixar ${file.name}`;
  const badge = el("span", "file-icon");
  badge.append(icon("file"), el("b", "", (file.name.match(/\.([a-z0-9]{1,5})$/i)?.[1] || "").toUpperCase()));
  const info = el("span", "file-info");
  info.append(el("strong", "", file.name), el("small", "", formatSize(file.size)));
  card.append(badge, info, icon("download", "icon file-get"));
  return card;
}

function downloadFile(file) {
  if (!file?.url) return;
  const link = el("a");
  link.href = new URL(`${file.url}&dl=1`, document.baseURI).href;
  link.download = file.name;
  link.click();
}

// Foto grande: reduz no navegador antes de subir (lado maior até PHOTO_SIDE). GIF vai inteiro, para não perder a animação.
async function preparePhoto(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return { blob: file };
  let image;
  try {
    image = await readImage(file);
  } catch {
    return { blob: file };
  }
  const { naturalWidth: width, naturalHeight: height } = image;
  const scale = Math.min(1, PHOTO_SIDE / Math.max(width, height));
  if (scale === 1 && file.size < 1.5e6) return { blob: file, width, height };
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
  if (!blob || blob.size >= file.size) return { blob: file, width, height };
  return { blob: new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "foto"}.jpg`, { type: "image/jpeg" }), width: canvas.width, height: canvas.height };
}

// Cada arquivo vira uma mensagem.
async function sendFiles(files) {
  closeAttach();
  for (const file of files) {
    if (!file.size) {
      toast(`“${file.name}” está vazio.`, "error");
      continue;
    }
    const upload = await preparePhoto(file);
    if (fileMax && upload.blob.size > fileMax) {
      toast(`“${file.name}” é grande demais (máximo de ${formatSize(fileMax)}).`, "error");
      sound.play("error");
      continue;
    }
    send("", null, upload);
  }
}

function closeAttach() {
  if (attachMenu.classList.contains("hidden")) return;
  attachMenu.classList.add("hidden");
  attachButton.setAttribute("aria-expanded", "false");
}

attachButton.addEventListener("click", () => {
  fx.press(attachButton);
  if (!attachMenu.classList.contains("hidden")) return closeAttach();
  closeGifs();
  fx.show(attachMenu, { y: 10, scale: 0.96 });
  attachButton.setAttribute("aria-expanded", "true");
});

attachMenu.addEventListener("click", (event) => {
  const option = event.target.closest("[data-pick]");
  if (!option) return;
  closeAttach();
  $(option.dataset.pick).click();
});

for (const input of [$("#pick-media"), $("#pick-file")]) {
  input.addEventListener("change", () => {
    const files = [...input.files];
    input.value = "";
    sendFiles(files);
  });
}

document.addEventListener("click", (event) => {
  if (!event.target.closest("#attach-menu, #attach-button")) closeAttach();
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || attachMenu.classList.contains("hidden")) return;
  event.stopPropagation();
  closeAttach();
}, true);

// Colar uma imagem (um print, por exemplo) no campo de mensagem envia a imagem.
messageInput.addEventListener("paste", (event) => {
  const files = [...(event.clipboardData?.files || [])];
  if (!files.length) return;
  event.preventDefault();
  sendFiles(files);
});

// Arrastar arquivos para cima da conversa.
let dragDepth = 0;
const dragsFiles = (event) => [...(event.dataTransfer?.types || [])].includes("Files");

conversationEl.addEventListener("dragenter", (event) => {
  if (!dragsFiles(event)) return;
  event.preventDefault();
  if (dragDepth++ === 0) fx.show(dropZone, { scale: 0.98 });
});
conversationEl.addEventListener("dragover", (event) => {
  if (!dragsFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});
conversationEl.addEventListener("dragleave", (event) => {
  if (!dragsFiles(event) || --dragDepth > 0) return;
  dragDepth = 0;
  dropZone.classList.add("hidden");
});
conversationEl.addEventListener("drop", (event) => {
  if (!dragsFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  dropZone.classList.add("hidden");
  sendFiles([...event.dataTransfer.files]);
});

// Foto em tela cheia.
function onViewerKey(event) {
  if (event.key !== "Escape") return;
  event.stopPropagation();
  closeViewer();
}

function openViewer(file) {
  if (!file) return;
  closeTools();
  const image = $("#viewer-img");
  image.src = file.preview || file.url;
  image.alt = file.name;
  $("#viewer-name").textContent = file.name;
  const link = $("#viewer-download");
  link.classList.toggle("hidden", !file.url);
  if (file.url) {
    link.href = `${file.url}&dl=1`;
    link.download = file.name;
  }
  fx.show(viewer, { scale: 0.96 });
  document.addEventListener("keydown", onViewerKey, true);
}

function closeViewer() {
  fx.hide(viewer, { scale: 0.96 });
  document.removeEventListener("keydown", onViewerKey, true);
}

viewer.addEventListener("click", (event) => {
  if (event.target === viewer || event.target.closest("#viewer-close")) closeViewer();
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
  const voiceAction = event.target.closest("[data-voice]")?.dataset.voice;
  if (voiceAction && message.file?.voice) {
    if (voiceAction === "speed") return cycleSpeed();
    if (voiceAction === "text") return toggleTranscript(message);
    return voiceAction === "transcribe" ? transcribeVoice(message) : toggleVoice(message);
  }
  if (event.target.closest("[data-view]")) return openViewer(message.file);
  const musicAction = event.target.closest("[data-music-action]");
  if (musicAction && message.music) return cardAction(musicAction.dataset.musicAction, message.music);
  if (event.target.closest("[data-open-music]")) return openMusic();
  if (event.target.closest("[data-download]")) return downloadFile(message.file);

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
  if (action === "download") {
    closeTools();
    return downloadFile(message.file);
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

// Devolve a mensagem que pode receber ações, ou null (links mantêm o menu do navegador;
// em vídeo e áudio o toque é dos controles, para arrastar a barra sem abrir o menu nem responder).
function actionableMessage(target) {
  if (!target.closest(".bubble") || target.closest("a, video, audio, .voice-ctl")) return null;
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
  // Dois toques rápidos no play (tocar e pausar) não viram coração.
  if (!message?.id || message.deleted || !event.target.closest(".bubble") || event.target.closest(".voice-ctl")) return;
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

// ---------- mensagens de voz ----------

// Gravar: com o campo vazio, o microfone fica no lugar do enviar. Um toque grava sem segurar (depois é só enviar
// ou apagar); segurando, a pessoa fala e solta para enviar, e deslizar para a esquerda cancela.
// Ouvir: um áudio por vez, com forma de onda (tocar ou arrastar nela pula), velocidade e, no fim, o próximo
// áudio seguido da mesma pessoa.
const micButton = $("#mic-button");
const recorderEl = $("#recorder");
const recTime = $("#rec-time");
const recWave = $("#rec-wave");
const recSlide = $("#rec-slide");
// MP4/AAC primeiro: toca em qualquer aparelho, inclusive no iPhone, que nem sempre toca o WebM/Opus.
const VOICE_TYPES = ["audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"];
const VOICE_EXTENSION = { mp4: "m4a", webm: "webm", ogg: "ogg" };
const VOICE_MIN = 1;
const VOICE_MAX = 15 * 60;
const VOICE_PEAKS = 40;
const VOICE_SPEEDS = [1, 1.5, 2];
const VOICE_SPEED_KEY = "potato.voiceSpeed";
// Segurar o microfone menos que isso é um toque (grava sem segurar); deslizar CANCEL_SLIDE px para a esquerda cancela.
const HOLD_MS = 350;
const CANCEL_SLIDE = 110;
const canRecord = Boolean(window.MediaRecorder && navigator.mediaDevices?.getUserMedia);
if (!canRecord) messageForm.classList.add("no-voice");

// Gravação em andamento (ou esperando a permissão do microfone); null = parada.
let rec = null;
// Dedo (ou mouse) segurando o microfone.
let micHold = null;

// Nível do microfone (RMS) numa escala parecida com a do ouvido: -50 dB (silêncio) = 0, -10 dB (voz alta) = 1.
const voiceLevel = (rms) => Math.min(1, Math.max(0, (20 * Math.log10(rms || 1e-5) + 50) / 40));

// Forma de onda que vai na mensagem: VOICE_PEAKS barras de 0 a 100, na proporção do trecho mais alto.
function voicePeaks(levels) {
  if (!levels.length) return [];
  const peaks = Array.from({ length: VOICE_PEAKS }, (_, index) => {
    const from = Math.floor(index * levels.length / VOICE_PEAKS);
    return Math.max(...levels.slice(from, Math.max(from + 1, Math.floor((index + 1) * levels.length / VOICE_PEAKS))));
  });
  const top = Math.max(0.35, ...peaks);
  return peaks.map((peak) => Math.round(peak / top * 100));
}

// "Áudio 2026-10-19 14.03.12.m4a", como o gravador do celular dá nome (aparece ao baixar).
function voiceFileName(type) {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const extension = VOICE_EXTENSION[type.split(/[/;]/)[1]] || "webm";
  return `Áudio ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}.${extension}`;
}

function paintRecorder() {
  const locked = rec?.mode === "locked";
  messageForm.classList.toggle("recording", Boolean(rec));
  messageForm.classList.toggle("rec-locked", locked);
  micButton.setAttribute("aria-label", locked ? "Enviar áudio" : "Gravar áudio");
  micButton.title = locked ? "Enviar áudio" : "Gravar áudio: toque para gravar, ou segure e solte para enviar";
  recSlide.style.transform = recSlide.style.opacity = "";
}

function addRecBar(level) {
  const bar = el("i");
  bar.style.setProperty("--h", level.toFixed(2));
  recWave.append(bar);
  if (recWave.childElementCount > 150) recWave.firstElementChild.remove();
}

async function startRecording(mode) {
  if (rec) return;
  if (call) return toast("Durante a chamada não dá para gravar áudio.");
  closeAttach();
  closeGifs();
  commandMenu.classList.add("hidden");
  stopVoice();
  const session = rec = { mode, chunks: [], size: 0, levels: [], peak: 0, lockedAt: performance.now() };
  recTime.textContent = "0:00";
  recWave.replaceChildren();
  paintRecorder();
  fx.show(recorderEl, { x: 24 });
  sound.play("record");
  navigator.vibrate?.(15);
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (error) {
    if (rec === session) stopRecording(false);
    toast(inExtension ? "O painel lateral não consegue usar o microfone. Abra nosso chat numa aba (botão no topo do painel) para gravar áudio."
      : error.name === "NotAllowedError" ? "Libere o microfone para o chat nas configurações do navegador."
      : "Não deu para usar o microfone.", "error");
    sound.play("error");
    return;
  }
  // Cancelou enquanto o navegador pedia a permissão.
  if (rec !== session) return stream.getTracks().forEach((track) => track.stop());
  const type = VOICE_TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  try {
    session.recorder = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 48000 } : { audioBitsPerSecond: 48000 });
  } catch {
    stream.getTracks().forEach((track) => track.stop());
    stopRecording(false);
    return toast("Este navegador não conseguiu gravar o áudio.", "error");
  }
  session.stream = stream;
  session.meter = sound.meter(stream);
  session.recorder.addEventListener("dataavailable", (event) => {
    if (!event.data.size) return;
    session.chunks.push(event.data);
    session.size += event.data.size;
    // Quase no maior arquivo que o servidor aceita: envia o que já tem.
    if (rec === session && fileMax && session.size > fileMax * 0.95) {
      toast("O áudio chegou ao tamanho máximo e foi enviado.");
      stopRecording(true);
    }
  });
  session.recorder.start(1000);
  session.started = session.lastBar = performance.now();
  session.timer = setInterval(() => recordTick(session), 30);
  // A outra pessoa vê "gravando áudio…" (o aviso some sozinho em 5 s, então vai de novo a cada 3 s).
  socket?.emit("typing", "audio");
  session.typing = setInterval(() => socket?.emit("typing", "audio"), 3000);
}

function recordTick(session) {
  const now = performance.now();
  session.peak = Math.max(session.peak, voiceLevel(session.meter()));
  // Uma barra a cada 100 ms. Com a aba em segundo plano o timer atrasa: as barras que faltam repetem o nível.
  if (now - session.lastBar >= 100) {
    for (let drawn = 0; now - session.lastBar >= 100; session.lastBar += 100, drawn++) {
      session.levels.push(session.peak);
      if (drawn < 8) addRecBar(session.peak);
    }
    session.peak = 0;
  }
  const seconds = (now - session.started) / 1000;
  const label = clockTime(seconds);
  if (recTime.textContent !== label) recTime.textContent = label;
  if (seconds >= VOICE_MAX) {
    toast("O áudio chegou a 15 minutos e foi enviado.");
    stopRecording(true);
  }
}

// Toque rápido no microfone (ou a janela de permissão interrompeu o gesto): continua gravando sem segurar.
function lockRecording() {
  rec.mode = "locked";
  rec.lockedAt = performance.now();
  paintRecorder();
}

// Para a gravação. keep = enviar (se tiver pelo menos VOICE_MIN segundos); senão, joga fora.
function stopRecording(keep) {
  const session = rec;
  if (!session) return;
  rec = null;
  micHold = null;
  clearInterval(session.timer);
  clearInterval(session.typing);
  if (session.started) socket?.emit("typing", false);
  recorderEl.classList.add("hidden");
  paintRecorder();
  const recorder = session.recorder;
  // Ainda esperando a permissão: o startRecording solta o microfone quando ela chegar.
  if (!recorder) return;
  const seconds = (performance.now() - session.started) / 1000;
  const finish = () => {
    session.stream.getTracks().forEach((track) => track.stop());
    if (!keep) return;
    if (seconds < VOICE_MIN) return toast("Áudio curto demais.");
    const type = recorder.mimeType || session.chunks[0]?.type || "audio/webm";
    const blob = new File(session.chunks, voiceFileName(type), { type });
    if (fileMax && blob.size > fileMax) return toast(`O áudio ficou grande demais (máximo de ${formatSize(fileMax)}).`, "error");
    send("", null, { blob, voice: { duration: Math.round(seconds * 10) / 10, peaks: voicePeaks(session.levels) } });
  };
  if (recorder.state === "inactive") return finish();
  recorder.addEventListener("stop", finish, { once: true });
  recorder.stop();
}

micButton.addEventListener("pointerdown", (event) => {
  if (rec || event.button !== 0 || !event.isPrimary) return;
  event.preventDefault();
  micButton.setPointerCapture?.(event.pointerId);
  micHold = { id: event.pointerId, x: event.clientX, at: performance.now() };
  startRecording("hold");
});

// Segurando: o "deslize para cancelar" acompanha o dedo; passou do limite, cancela.
micButton.addEventListener("pointermove", (event) => {
  if (micHold?.id !== event.pointerId || rec?.mode !== "hold") return;
  const offset = Math.min(0, event.clientX - micHold.x);
  if (offset > -CANCEL_SLIDE) {
    recSlide.style.transform = `translateX(${offset * 0.8}px)`;
    recSlide.style.opacity = String(1 + offset / CANCEL_SLIDE * 0.7);
    return;
  }
  sound.play("discard");
  navigator.vibrate?.(10);
  stopRecording(false);
});

function releaseMic(event) {
  if (micHold?.id !== event.pointerId) return;
  const held = performance.now() - micHold.at;
  micHold = null;
  if (rec?.mode !== "hold") return;
  if (event.type === "pointercancel" || held < HOLD_MS || !rec.recorder) lockRecording();
  else stopRecording(true);
}

micButton.addEventListener("pointerup", releaseMic);
micButton.addEventListener("pointercancel", releaseMic);
micButton.addEventListener("contextmenu", (event) => event.preventDefault());

micButton.addEventListener("click", (event) => {
  // Pelo teclado (Enter ou espaço), começa a gravar sem segurar.
  if (!rec) {
    if (event.detail === 0) startRecording("locked");
    return;
  }
  // O clique que chega logo depois do toque que começou a gravação não envia.
  if (rec.mode === "locked" && performance.now() - rec.lockedAt > 300) stopRecording(true);
});

$("#rec-cancel").addEventListener("click", () => {
  sound.play("discard");
  stopRecording(false);
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !rec) return;
  event.stopPropagation();
  sound.play("discard");
  stopRecording(false);
}, true);

addEventListener("pagehide", () => stopRecording(false));

// Áudio tocando agora (um por vez, num só <audio>). key = clientId ou id da mensagem, que não muda depois de enviada.
const savedSpeed = store.get("localStorage", VOICE_SPEED_KEY);
const playback = { key: "", message: null, audio: null, frame: 0, loading: false, drag: null, speed: VOICE_SPEEDS.includes(savedSpeed) ? savedSpeed : 1, converted: new Map() };
const voiceKey = (message) => message.clientId || message.id;
const voiceNode = (key) => (key ? messagesEl.querySelector(`.voice[data-voice-key="${CSS.escape(key)}"]`) : null);
const voiceSource = (message) => message.file.preview || new URL(message.file.url, document.baseURI).href;
const voicePlaying = () => Boolean(playback.key && !playback.audio.paused);
const speedLabel = (speed) => `${String(speed).replace(".", ",")}×`;

// Duração: a do arquivo, quando o navegador sabe (o WebM gravado no Chrome não diz); senão, a medida ao gravar.
function voiceTotal(message) {
  const duration = playback.audio?.duration;
  return voiceKey(message) === playback.key && Number.isFinite(duration) && duration > 0 ? duration : message.file.voice.duration;
}

function voiceState(message) {
  const current = voiceKey(message) === playback.key;
  return { playing: current && voicePlaying(), loading: current && playback.loading, position: current ? playback.audio.currentTime : 0, total: voiceTotal(message) };
}

// Player dentro do balão. As peças vão direto para a grade do balão (styles.css): play à esquerda, a onda com a
// velocidade no canto direito e, embaixo, o tempo (com o "Transcrever") alinhado com a hora; a transcrição por último.
function voiceView(message) {
  const { voice } = message.file;
  const node = el("div", "voice");
  node.dataset.voiceKey = voiceKey(message);
  const play = el("button", "voice-play voice-ctl swap");
  play.type = "button";
  play.dataset.voice = "play";
  play.append(icon("pause", "icon when-on"), icon("play", "icon when-off"));
  const wave = el("div", "voice-wave voice-ctl");
  wave.tabIndex = 0;
  wave.setAttribute("role", "slider");
  wave.setAttribute("aria-label", "Posição do áudio");
  wave.setAttribute("aria-valuemin", "0");
  wave.setAttribute("aria-valuemax", String(Math.round(voice.duration)));
  const bars = el("span", "voice-bars");
  for (const peak of voice.peaks.length ? voice.peaks : Array(VOICE_PEAKS).fill(0)) {
    const bar = el("i");
    bar.style.setProperty("--h", (peak / 100).toFixed(2));
    bars.append(bar);
  }
  // A mesma onda por cima, na cor forte, cortada até onde já tocou.
  const played = bars.cloneNode(true);
  played.classList.add("played");
  wave.append(bars, played, el("span", "voice-thumb"));
  const speed = el("button", "voice-speed voice-ctl", speedLabel(playback.speed));
  speed.type = "button";
  speed.dataset.voice = "speed";
  speed.title = "Mudar a velocidade";
  const meta = el("div", "voice-meta");
  meta.append(el("span", "voice-time"));
  if (message.upload && !message.id) {
    const bar = el("span", "upload-bar");
    bar.style.setProperty("--p", message.upload.progress);
    bar.append(el("i"));
    meta.append(bar);
  } else if (transcribeOn && message.id && voice.text === undefined) {
    const busy = transcribing.has(message.id);
    const ask = el("button", `voice-transcribe voice-ctl${busy ? " busy" : ""}`);
    ask.type = "button";
    ask.dataset.voice = "transcribe";
    ask.disabled = busy;
    ask.append(icon("captions"), busy ? "Transcrevendo…" : "Transcrever");
    meta.append(ask);
  }
  // Já transcrito: o texto aparece embaixo, com o botão para ocultar (ou ver de novo) na linha do tempo.
  const hidden = voice.text !== undefined && hiddenTexts.has(message.id);
  if (voice.text !== undefined && message.id) {
    const toggle = el("button", "voice-transcribe voice-ctl");
    toggle.type = "button";
    toggle.dataset.voice = "text";
    toggle.setAttribute("aria-expanded", String(!hidden));
    toggle.append(icon("captions"), hidden ? "Ver texto" : "Ocultar texto");
    meta.append(toggle);
  }
  node.append(play, wave, speed, meta);
  if (voice.text !== undefined && !hidden) node.append(el("p", `voice-text${voice.text ? "" : " empty"}`, voice.text || "Não deu para entender a fala desse áudio."));
  paintVoiceNode(node, voiceState(message));
  return node;
}

// Transcrições que a pessoa ocultou (só neste aparelho; as mais antigas saem da lista depois de 500).
const HIDDEN_TEXTS_KEY = "potato.hiddenTranscripts";
const savedHidden = store.get("localStorage", HIDDEN_TEXTS_KEY);
const hiddenTexts = new Set(Array.isArray(savedHidden) ? savedHidden : []);

function toggleTranscript(message) {
  if (!hiddenTexts.delete(message.id)) hiddenTexts.add(message.id);
  store.set("localStorage", HIDDEN_TEXTS_KEY, [...hiddenTexts].slice(-500));
  const node = messagesEl.querySelector(`[data-id="${CSS.escape(message.id)}"]`);
  if (node) fill(node, message);
  sound.play("tap");
}

// Transcrição (botão "Transcrever"): o servidor manda o áudio para o serviço do config.php e guarda o texto na
// mensagem, que chega atualizada para os dois.
const transcribing = new Set();

async function transcribeVoice(message) {
  const { id } = message;
  if (!id || transcribing.has(id)) return;
  const repaint = () => {
    const node = messagesEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (node && byId.has(id)) fill(node, byId.get(id));
  };
  transcribing.add(id);
  repaint();
  try {
    const response = await fetch(apiUrl("transcribe"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: socket.auth.token, id }) });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw new Error(result?.error || "Não deu para transcrever agora.");
    // Normalmente a mensagem atualizada já chegou pela conexão; se não, aplica o texto aqui.
    const current = byId.get(id);
    if (current?.file?.voice && current.file.voice.text === undefined) {
      updateMessage({ ...current, file: { ...current.file, voice: { ...current.file.voice, text: result.text } } });
    }
  } catch (error) {
    toast(error.message === "Failed to fetch" ? "Sem conexão para transcrever agora." : error.message, "error");
  } finally {
    transcribing.delete(id);
    repaint();
  }
}

function paintVoiceNode(node, { playing, loading, position, total }) {
  const wave = node.querySelector(".voice-wave");
  wave.style.setProperty("--p", total ? Math.min(1, position / total).toFixed(4) : "0");
  wave.setAttribute("aria-valuenow", String(Math.floor(position)));
  wave.setAttribute("aria-valuetext", `${clockTime(position)} de ${clockTime(total)}`);
  // Parado no começo mostra a duração; tocando (ou pausado no meio), onde está.
  const label = clockTime(playing || position > 0 ? position : total);
  const time = node.querySelector(".voice-time");
  if (time.textContent !== label) time.textContent = label;
  const button = node.querySelector(".voice-play");
  button.classList.toggle("is-off", !playing);
  button.classList.toggle("loading", loading);
  button.setAttribute("aria-label", playing ? "Pausar o áudio" : "Ouvir o áudio");
  node.classList.toggle("is-playing", playing);
}

// Repinta o player de uma mensagem (o que está sendo arrastado fica como o dedo deixou).
function paintVoice(key = playback.key) {
  const node = voiceNode(key);
  if (!node || (playback.drag?.moved && playback.drag.wave.closest(".voice") === node)) return;
  paintVoiceNode(node, voiceState(node.closest(".message").msg));
}

function voiceAudio() {
  if (playback.audio) return playback.audio;
  const audio = playback.audio = new Audio();
  audio.preload = "auto";
  audio.addEventListener("play", () => {
    duckMusic(true);
    if (!playback.frame) playback.frame = requestAnimationFrame(voiceFrame);
  });
  audio.addEventListener("playing", () => {
    playback.loading = false;
    paintVoice();
  });
  audio.addEventListener("waiting", () => {
    playback.loading = true;
    paintVoice();
  });
  audio.addEventListener("pause", () => {
    duckMusic(false);
    playback.loading = false;
    paintVoice();
  });
  audio.addEventListener("ended", voiceEnded);
  audio.addEventListener("error", voiceFailed);
  return audio;
}

function voiceFrame() {
  playback.frame = 0;
  if (!voicePlaying()) return;
  paintVoice();
  playback.frame = requestAnimationFrame(voiceFrame);
}

// Enquanto um áudio toca, a música do bot abaixa (só neste aparelho).
function duckMusic(on) {
  musicPlayer.setVolume(on ? Math.round(musicVolume * 0.2) : musicVolume);
}

function openVoice(message, at = 0) {
  stopVoice();
  const audio = voiceAudio();
  const key = playback.key = voiceKey(message);
  playback.message = message;
  audio.src = playback.converted.get(key) || voiceSource(message);
  audio.defaultPlaybackRate = audio.playbackRate = playback.speed;
  if (at > 0) audio.addEventListener("loadedmetadata", () => { if (playback.key === key) audio.currentTime = at; }, { once: true });
  playVoice();
}

function playVoice() {
  const { audio, key } = playback;
  playback.loading = true;
  audio.play().catch((error) => {
    if (playback.key !== key) return;
    if (error.name === "NotAllowedError") toast("Toque no play de novo para ouvir.");
    playback.loading = false;
    paintVoice();
  });
  paintVoice();
}

function toggleVoice(message) {
  if (playback.key !== voiceKey(message)) return openVoice(message);
  if (playback.audio.paused) playVoice();
  else playback.audio.pause();
}

function stopVoice() {
  const { key } = playback;
  if (!key) return;
  playback.key = "";
  playback.message = null;
  playback.loading = false;
  cancelAnimationFrame(playback.frame);
  playback.frame = 0;
  playback.audio.pause();
  paintVoice(key);
}

function seekVoice(message, fraction) {
  if (playback.key !== voiceKey(message)) return openVoice(message, fraction * message.file.voice.duration);
  playback.audio.currentTime = fraction * voiceTotal(message);
  paintVoice();
}

// Áudios seguidos da mesma pessoa tocam em sequência, como no WhatsApp.
function nextVoice(node) {
  const article = node?.closest(".message");
  let next = article?.nextElementSibling;
  while (next && !next.classList.contains("message")) next = next.nextElementSibling;
  const message = next?.msg;
  return message?.file?.voice && !message.deleted && message.sender === article.msg.sender ? message : null;
}

function voiceEnded() {
  const next = nextVoice(voiceNode(playback.key));
  stopVoice();
  if (next) openVoice(next);
}

// O aparelho não toca o formato (ex.: um iPhone com o WebM gravado num Android): decodifica e toca como WAV.
async function voiceFailed() {
  const { key, message, audio } = playback;
  if (!key || !audio.error) return;
  const unsupported = audio.error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || audio.error.code === MediaError.MEDIA_ERR_DECODE;
  if (!unsupported || playback.converted.has(key)) {
    stopVoice();
    return toast("Não deu para tocar esse áudio.", "error");
  }
  playback.loading = true;
  paintVoice();
  try {
    const url = await decodeToWav(voiceSource(message));
    playback.converted.set(key, url);
    if (playback.key !== key) return;
    audio.src = url;
    audio.defaultPlaybackRate = audio.playbackRate = playback.speed;
    playVoice();
  } catch {
    if (playback.key !== key) return;
    stopVoice();
    toast("Este aparelho não conseguiu tocar esse áudio. Dá para baixar pelo menu da mensagem.", "error");
  }
}

async function decodeToWav(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Erro ${response.status}`);
  const data = await response.arrayBuffer();
  // Decodifica já em 24 kHz (o contexto converte) e junta os canais num só: a voz fica igual e o WAV, leve.
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const decoded = await new Promise((resolve, reject) => new Offline(1, 1, 24000).decodeAudioData(data, resolve, reject));
  const samples = decoded.getChannelData(0).slice();
  for (let channel = 1; channel < decoded.numberOfChannels; channel++) {
    decoded.getChannelData(channel).forEach((value, index) => { samples[index] += value; });
  }
  if (decoded.numberOfChannels > 1) samples.forEach((value, index) => { samples[index] = value / decoded.numberOfChannels; });
  return URL.createObjectURL(wavBlob(samples, decoded.sampleRate));
}

// WAV de 16 bits, mono.
function wavBlob(samples, rate) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, samples[index])) * 0x7fff, true);
  return new Blob([view.buffer], { type: "audio/wav" });
}

function cycleSpeed() {
  playback.speed = VOICE_SPEEDS[(VOICE_SPEEDS.indexOf(playback.speed) + 1) % VOICE_SPEEDS.length];
  store.set("localStorage", VOICE_SPEED_KEY, playback.speed);
  if (playback.audio) playback.audio.defaultPlaybackRate = playback.audio.playbackRate = playback.speed;
  messagesEl.querySelectorAll(".voice-speed").forEach((button) => { button.textContent = speedLabel(playback.speed); });
  sound.play("tap");
}

// Tocar na forma de onda pula para aquele ponto; arrastar na horizontal mostra onde vai parar e pula ao soltar.
// Arrastar na vertical continua rolando a conversa (touch-action: pan-y no styles.css).
// A onda fica 6 px para dentro dos lados da área (styles.css).
const waveFraction = (wave, x) => {
  const box = wave.getBoundingClientRect();
  return Math.min(1, Math.max(0, (x - box.left - 6) / (box.width - 12)));
};

messagesEl.addEventListener("pointerdown", (event) => {
  const wave = event.target.closest(".voice-wave");
  const message = wave?.closest(".message")?.msg;
  if (!message?.file?.voice || event.button !== 0) return;
  wave.setPointerCapture?.(event.pointerId);
  playback.drag = { wave, message, id: event.pointerId, x: event.clientX, moved: false };
});

messagesEl.addEventListener("pointermove", (event) => {
  const { drag } = playback;
  if (drag?.id !== event.pointerId || (!drag.moved && Math.abs(event.clientX - drag.x) < 6)) return;
  drag.moved = true;
  const state = voiceState(drag.message);
  paintVoiceNode(drag.wave.closest(".voice"), { ...state, position: waveFraction(drag.wave, event.clientX) * state.total });
});

function endWaveDrag(event) {
  const { drag } = playback;
  if (drag?.id !== event.pointerId) return;
  playback.drag = null;
  if (event.type === "pointerup") seekVoice(drag.message, waveFraction(drag.wave, event.clientX));
  else paintVoice(voiceKey(drag.message));
}

messagesEl.addEventListener("pointerup", endWaveDrag);
messagesEl.addEventListener("pointercancel", endWaveDrag);

// Teclado: setas voltam e avançam 5 s.
messagesEl.addEventListener("keydown", (event) => {
  const message = event.target.closest?.(".voice-wave")?.closest(".message")?.msg;
  if (!message?.file?.voice || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
  event.preventDefault();
  const { position, total } = voiceState(message);
  seekVoice(message, Math.min(1, Math.max(0, (position + (event.key === "ArrowRight" ? 5 : -5)) / total)));
});

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

// Teclado do celular aberto = um campo de texto com o foco e a tela mais baixa que o normal (styles.css esconde as
// abas). Só o foco não basta: no Android, fechar o teclado não tira o foco do campo, e as abas sumiam até tocar fora.
let screenWidth = innerWidth;
let tallest = 0;
function paintKeyboard() {
  const height = Math.min(innerHeight, window.visualViewport?.height || innerHeight);
  if (innerWidth !== screenWidth) {
    screenWidth = innerWidth;
    tallest = 0;
  }
  tallest = Math.max(tallest, height);
  const typing = document.activeElement?.matches?.("textarea, input:not([type=range]):not([type=file]):not([type=checkbox])");
  document.documentElement.classList.toggle("keyboard-open", Boolean(typing) && height < tallest - 120);
}
window.visualViewport?.addEventListener("resize", paintKeyboard);
addEventListener("resize", paintKeyboard);
document.addEventListener("focusin", paintKeyboard);
document.addEventListener("focusout", () => setTimeout(paintKeyboard));

// No perfil, Esc volta para a conversa (a não ser que uma janela esteja aberta: aí o Esc é dela).
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || tab !== "profile" || document.querySelector(".modal:not(.hidden)")) return;
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
  loadStats(profileView, "", (date) => { $("#profile-since").textContent = `No chat${peerName ? ` com ${peerName}` : ""} desde ${date}`; });
}

// Dias de calendário desde a primeira mensagem, contando hoje.
function daysSince(iso) {
  const start = new Date(iso);
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today - start) / 864e5) + 1;
}

// Números do perfil dentro de box: os seus ou, com name, os da outra pessoa. since recebe a data da primeira mensagem.
function loadStats(box, name, since) {
  if (!socket?.connected) return;
  socket.timeout(8000).emit("stats", name ? { name } : null, (error, result) => {
    if (error || !result) return;
    const values = { messages: result.messages, reactions: result.reactions, days: result.since ? daysSince(result.since) : 0 };
    for (const [key, value] of Object.entries(values)) {
      const node = box.querySelector(`[data-stat="${key}"]`);
      fx.count(node, value);
      node.nextElementSibling.textContent = STAT_LABELS[key][value === 1 ? 0 : 1];
    }
    if (result.since) since(longDate(result.since));
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

// ---------- papel de parede ----------

const WALL_KEY = "potato.wallpaper";
const WALL_DEFAULT = { light: -30, blur: 0, tint: 20 };
const WALL_SIDE = 1600;
// Abaixo do limite do servidor (WALLPAPER_MAX em lib/potato.php), com folga.
const WALL_MAX = 600000;
const wallEditor = $("#wall-editor");
const wallPreview = $("#wall-preview");
const WALL_LABEL = {
  light: (value) => (value === 0 ? "Natural" : value < 0 ? `${-value}% mais escura` : `${value}% mais clara`),
  blur: (value) => (value ? String(value) : "Nenhum"),
  tint: (value) => `${value}%`
};
// Papel de parede atual ({ url, style }) e o rascunho aberto no editor ({ image, url, style }; image = foto nova).
let wallpaper = null;
let wallDraft = null;

function clampWallStyle(style = {}) {
  const number = (key, min, max) => {
    const value = Math.round(Number(style[key] ?? WALL_DEFAULT[key]));
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : WALL_DEFAULT[key];
  };
  return { light: number("light", -100, 100), blur: number("blur", 0, 20), tint: number("tint", 0, 80) };
}

// Iluminação negativa escurece (preto por cima), positiva clareia (branco); a cor do tema vem por baixo dela.
function paintWall(target, url, style) {
  const strength = Math.abs(style.light) / 100;
  target.style.setProperty("--wall-image", url ? `url("${url}")` : "none");
  target.style.setProperty("--wall-blur", `${style.blur}px`);
  target.style.setProperty("--wall-shade", style.light < 0 ? `rgb(0 0 0 / ${(strength * 0.85).toFixed(3)})` : `rgb(255 255 255 / ${(strength * 0.65).toFixed(3)})`);
  target.style.setProperty("--wall-tint", `color-mix(in srgb, var(--bg) ${style.tint}%, transparent)`);
}

function applyWallpaper(next) {
  wallpaper = next?.url ? { url: new URL(next.url, document.baseURI).href, style: clampWallStyle(next.style) } : null;
  // Cópia local para o papel de parede já aparecer ao abrir, antes de o servidor responder.
  if (wallpaper) store.set("localStorage", WALL_KEY, wallpaper);
  else store.remove("localStorage", WALL_KEY);
  chatView.classList.toggle("has-wallpaper", Boolean(wallpaper));
  if (wallpaper) paintWall(chatView, wallpaper.url, wallpaper.style);
  $("#wall-state").textContent = wallpaper ? "Foto escolhida" : "Sem papel de parede";
  $("#wall-choose span").textContent = wallpaper ? "Trocar foto" : "Escolher foto";
  $("#wall-adjust").classList.toggle("hidden", !wallpaper);
  $("#wall-remove").classList.toggle("hidden", !wallpaper);
}

// Reduz a foto no navegador (lado maior até WALL_SIDE) e baixa a qualidade até caber no limite.
async function wallPhoto(file) {
  if (!file.type.startsWith("image/")) throw new Error("Escolha um arquivo de imagem.");
  if (file.size > 40e6) throw new Error("Essa imagem é grande demais.");
  const image = await readImage(file);
  const scale = Math.min(1, WALL_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(64, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(64, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.84, 0.74, 0.64, 0.54]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length * 0.75 <= WALL_MAX) return url;
  }
  throw new Error("Não deu para deixar essa foto leve o bastante. Tente outra.");
}

function paintWallEditor() {
  paintWall(wallPreview, wallDraft.url, wallDraft.style);
  for (const input of wallEditor.querySelectorAll("[data-style]")) {
    const key = input.dataset.style;
    input.value = wallDraft.style[key];
    input.style.setProperty("--fill", `${((wallDraft.style[key] - input.min) / (input.max - input.min)) * 100}%`);
    $(`#wall-${key}-out`).textContent = WALL_LABEL[key](wallDraft.style[key]);
  }
}

function onWallKey(event) {
  if (event.key !== "Escape") return;
  event.stopPropagation();
  closeWallEditor();
}

function openWallEditor(draft) {
  wallDraft = draft;
  // A prévia tem o formato da conversa: deitada no computador, em pé no celular.
  const wide = innerWidth > 760;
  const ratio = (wide ? innerWidth - 280 : innerWidth) / (wide ? innerHeight : innerHeight - 60);
  wallPreview.style.setProperty("--preview-ar", Math.min(1.6, Math.max(0.62, ratio)).toFixed(3));
  paintWallEditor();
  wallEditor.classList.remove("hidden");
  fx.incoming(wallEditor.querySelector(".modal-card"));
  document.addEventListener("keydown", onWallKey, true);
}

function closeWallEditor() {
  wallEditor.classList.add("hidden");
  document.removeEventListener("keydown", onWallKey, true);
  wallDraft = null;
}

const editWallpaper = () => (wallpaper ? openWallEditor({ image: null, url: wallpaper.url, style: { ...wallpaper.style } }) : $("#wall-input").click());

function saveWallpaper() {
  if (!wallDraft) return;
  if (!socket?.connected) return toast("Sem conexão agora. Tente de novo em instantes.", "error");
  const card = wallEditor.querySelector(".modal-card");
  const payload = { style: wallDraft.style };
  if (wallDraft.image) payload.image = wallDraft.image;
  card.classList.add("busy");
  $("#wall-apply").textContent = "Salvando…";
  socket.timeout(25000).emit("wallpaper", payload, (error, result) => {
    card.classList.remove("busy");
    $("#wall-apply").textContent = "Aplicar";
    if (error || !result?.ok) {
      toast(result?.error || "Não foi possível salvar o papel de parede.", "error");
      sound.play("error");
      return;
    }
    closeWallEditor();
    applyWallpaper(result.wallpaper);
    // Volta para a conversa, para ver o resultado na hora.
    showTab("chat");
    sound.play("sparkle");
    toast("Papel de parede aplicado", "ok");
  });
}

function removeWallpaper() {
  if (!socket?.connected) return toast("Sem conexão agora. Tente de novo em instantes.", "error");
  socket.timeout(10000).emit("wallpaper", { image: null }, (error, result) => {
    if (error || !result?.ok) return toast("Não foi possível remover o papel de parede.", "error");
    applyWallpaper(null);
    fx.pop($("#wall-thumb"));
    toast("Papel de parede removido", "ok");
  });
}

$("#wall-choose").addEventListener("click", () => $("#wall-input").click());
$("#wall-thumb").addEventListener("click", editWallpaper);
$("#wall-adjust").addEventListener("click", editWallpaper);
$("#wall-remove").addEventListener("click", removeWallpaper);

$("#wall-input").addEventListener("change", async () => {
  const [file] = $("#wall-input").files;
  $("#wall-input").value = "";
  if (!file) return;
  try {
    const url = await wallPhoto(file);
    // Trocar a foto com o editor aberto mantém os ajustes.
    if (wallDraft) {
      Object.assign(wallDraft, { image: url, url });
      paintWallEditor();
    } else {
      openWallEditor({ image: url, url, style: { ...(wallpaper?.style || WALL_DEFAULT) } });
    }
  } catch (error) {
    toast(error.message, "error");
    sound.play("error");
  }
});

wallEditor.addEventListener("input", (event) => {
  const key = event.target.dataset?.style;
  if (!key || !wallDraft) return;
  wallDraft.style[key] = Number(event.target.value);
  paintWallEditor();
});

wallEditor.addEventListener("click", (event) => {
  if (event.target === wallEditor || event.target.closest("#wall-cancel")) closeWallEditor();
  else if (event.target.closest("#wall-repick")) $("#wall-input").click();
  else if (event.target.closest("#wall-apply")) saveWallpaper();
  else if (event.target.closest("#wall-reset") && wallDraft) {
    wallDraft.style = { ...WALL_DEFAULT };
    paintWallEditor();
    sound.play("tap");
  }
});

// ---------- bot de música (/play) ----------

// O que vem do servidor: a música (now), a fila, se está tocando e em que segundo estava em updatedAt (relógio dele).
let music = { now: null, queue: [], playing: false, position: 0, updatedAt: 0 };
// Diferença entre o relógio do servidor e o daqui (ms), medida no histórico e nas respostas aos comandos.
let musicClock = 0;
// O navegador barrou o som (falta um toque na página): aparece o "Toque para ouvir junto".
let musicBlocked = false;
let musicSeeking = false;
let blockTimer = 0;
// Tentativas de voltar a tocar com o app em segundo plano (o celular pode ter pausado o player).
let musicRetries = 0;
let paintedTrack = null;
const MUSIC_VOLUME_KEY = "potato.musicVolume";
const MUSIC_VIDEO_KEY = "potato.musicVideo";
const musicButton = $("#music-button");
const musicPanel = $("#music-panel");
const commandMenu = $("#command-menu");
const MUSIC_COMMANDS = [
  { name: "play", args: "nome ou link", icon: "play", text: "Toca do YouTube ou do Spotify (sozinho, continua a pausada)" },
  { name: "pause", icon: "pause", text: "Pausa a música para os dois" },
  { name: "skip", icon: "skip", text: "Pula para a próxima da fila" },
  { name: "stop", icon: "stop", text: "Para e limpa a fila" },
  { name: "fila", icon: "list-music", text: "Abre o tocador com a fila" },
  { name: "watchparty", args: "nome ou link (YouTube ou Twitch)", icon: "tv", text: "Abre a Batata Watch Party: YouTube, Twitch, Netflix, HBO Max ou vídeo do aparelho" }
];
const COMMAND_ALIAS = { tocar: "play", continuar: "play", resume: "play", pausar: "pause", pular: "skip", next: "skip", proxima: "skip", parar: "stop", queue: "fila", watch: "watchparty", assistir: "watchparty", wp: "watchparty", ver: "watchparty" };
// Aviso quando a outra pessoa mexe no tocador: ícone e texto.
const MUSIC_NOTICE = {
  pause: ["pause", "pausou a música"],
  resume: ["play", "voltou a tocar a música"],
  skip: ["skip", "pulou a música"],
  stop: ["stop", "parou a música e limpou a fila"]
};
const SOURCE_NAME = { youtube: "YouTube", spotify: "Spotify" };
// Cartão do chat: texto, o que o botão faz e o nome do botão, em cada estado da música.
const CARD_STATE = {
  playing: ["Tocando", "pause", "Pausar para os dois"],
  paused: ["Pausada", "resume", "Tocar para os dois"],
  queued: ["na fila", "jump", "Tocar agora"],
  done: ["Já tocou", "again", "Tocar de novo"]
};
const DEFAULT_TONE = "#3b3428";

const musicAt = () => (music.playing ? music.position + (Date.now() + musicClock - music.updatedAt) / 1000 : music.position);
// Duração: a do player (no Spotify sem login, a prévia) ou, antes de ele carregar, a que veio com a música.
const musicLength = () => (music.now ? musicPlayer.duration() || music.now.duration || 0 : 0);
const requestedBy = (name) => `pedida por ${name === me ? "você" : name}`;
// Música do Spotify que toca inteira pelo YouTube (origin): aparece como Spotify (logo, capa, link).
const shownSource = (track) => track.origin?.source || track.source;
const youtubeArt = (track) => track.source === "youtube" && !track.origin;
const trackLink = (track) => {
  const from = track.origin || track;
  return from.source === "youtube" ? `https://www.youtube.com/watch?v=${from.id}` : `https://open.spotify.com/${from.type}/${from.id}`;
};
const smallCover = (track) => (youtubeArt(track) ? `https://i.ytimg.com/vi/${track.id}/mqdefault.jpg` : track.thumb || "");

// "3:28"; com mais de uma hora, "1:02:03" (filmes, jogos completos, lives gravadas).
function clockTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const pad = (value) => String(value).padStart(2, "0");
  if (total >= 3600) return `${Math.floor(total / 3600)}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
}

// Logo do YouTube ou do Spotify (sprite do index.php, nas cores das marcas).
function brand(source) {
  const node = document.createElementNS(SVG_NS, "svg");
  node.setAttribute("class", "brand");
  node.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#b-${source}`);
  node.append(use);
  return node;
}

function equalizer() {
  const eq = el("span", "eq");
  eq.setAttribute("aria-hidden", "true");
  eq.append(el("i"), el("i"), el("i"));
  return eq;
}

// Capinha (fila e cartão do chat). No YouTube, a imagem "hq" tem faixas pretas em cima e embaixo: o CSS corta.
function musicArt(track, className) {
  const art = el("span", className);
  const src = youtubeArt(track) ? `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg` : track.thumb;
  if (!src) {
    art.append(icon("music"));
    return art;
  }
  const image = el("img");
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  image.src = src;
  art.classList.toggle("letterbox", youtubeArt(track));
  art.append(image);
  return art;
}

// Capa grande do tocador: no YouTube, a "maxres" quando existe (senão, a "hq" cortada).
const covers = new Map();
function bigCover(track) {
  if (!youtubeArt(track)) return Promise.resolve({ src: track.cover || track.thumb || "", sizes: track.cover ? "640x640" : "300x300", letterbox: false });
  if (!covers.has(track.id)) covers.set(track.id, new Promise((resolve) => {
    const image = new Image();
    const fallback = () => resolve({ src: `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`, sizes: "480x360", letterbox: true });
    // Sem a maxres, o YouTube devolve uma imagem cinza de 120 px.
    image.onload = () => (image.naturalWidth > 200 ? resolve({ src: image.src, sizes: "1280x720", letterbox: false }) : fallback());
    image.onerror = fallback;
    image.src = `https://i.ytimg.com/vi/${track.id}/maxresdefault.jpg`;
  }));
  return covers.get(track.id);
}

// Cor da música (fundo do cartão e do tocador): a que o próprio Spotify usa ou, no YouTube, a que mais aparece na capa.
const tones = new Map();
function trackTone(track) {
  if (track.color) return Promise.resolve(track.color);
  const src = smallCover(track);
  if (!src) return Promise.resolve(null);
  if (!tones.has(src)) tones.set(src, new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try { resolve(pickTone(image)); } catch { resolve(null); }
    };
    image.onerror = () => resolve(null);
    image.src = src;
  }));
  return tones.get(src);
}

function toHsl(r, g, b) {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const light = (max + min) / 2;
  if (max === min) return [0, 0, light];
  const range = max - min;
  const sat = light > 0.5 ? range / (2 - max - min) : range / (max + min);
  const hue = max === red ? (green - blue) / range + (green < blue ? 6 : 0) : max === green ? (blue - red) / range + 2 : (red - green) / range + 4;
  return [hue * 60, sat, light];
}

// Junta os pixels por matiz (as cores vivas pesam mais) e escurece a vencedora, para o texto branco ficar legível.
function pickTone(image) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 24;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, 24, 24);
  const data = context.getImageData(0, 0, 24, 24).data;
  const groups = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const [hue, sat, light] = toHsl(data[i], data[i + 1], data[i + 2]);
    if (light < 0.08 || light > 0.94) continue;
    const vivid = sat > 0.2;
    const key = vivid ? Math.round(hue / 30) % 12 : "gray";
    const weight = vivid ? 0.5 + sat : 0.3;
    const group = groups.get(key) || { r: 0, g: 0, b: 0, weight: 0 };
    group.r += data[i] * weight;
    group.g += data[i + 1] * weight;
    group.b += data[i + 2] * weight;
    group.weight += weight;
    groups.set(key, group);
  }
  const best = [...groups.values()].sort((a, b) => b.weight - a.weight)[0];
  if (!best) return null;
  const [hue, sat] = toHsl(best.r / best.weight, best.g / best.weight, best.b / best.weight);
  return `hsl(${Math.round(hue)} ${Math.round(Math.min(sat, 0.62) * 100)}% 30%)`;
}

// Título comprido rola devagar para os lados (como no Spotify).
function setMarquee(node, text) {
  const line = node.firstElementChild;
  line.textContent = text;
  node.classList.remove("rolling");
  requestAnimationFrame(() => {
    const overflow = line.offsetWidth - node.clientWidth;
    if (overflow <= 2) return;
    node.style.setProperty("--roll", `${-overflow - 18}px`);
    node.style.setProperty("--roll-time", `${Math.max(6, overflow / 22 + 4).toFixed(1)}s`);
    node.classList.add("rolling");
  });
}

const musicPlayer = createPlayer($("#music-stage"), {
  onReady: () => {
    syncMusic();
    checkBlocked();
  },
  onUpdate: () => {
    // Estava só carregando e começou a tocar: não estava barrado.
    if (musicBlocked && musicPlayer.playing()) {
      musicBlocked = false;
      paintMusic();
    }
    paintMusicTime();
    paintPosition();
  },
  // Os dois aparelhos avisam; o servidor só aceita o primeiro aviso de cada música.
  onEnded: (uid) => {
    if (music.now?.uid === uid) socket?.emit("music", { op: "ended", uid });
  },
  onError: (uid, text) => {
    if (music.now?.uid !== uid) return;
    toast(`${text} Pulando para a próxima.`, "error");
    socket?.emit("music", { op: "ended", uid });
  }
});

// Volume (só neste aparelho; o Spotify não deixa mudar por fora).
let musicVolume = Number(store.get("localStorage", MUSIC_VOLUME_KEY) ?? 80);
let volumeBefore = musicVolume || 80;
function setMusicVolume(value) {
  musicVolume = Math.max(0, Math.min(100, Math.round(value)));
  musicPlayer.setVolume(musicVolume);
  store.set("localStorage", MUSIC_VOLUME_KEY, musicVolume);
  const input = $("#music-volume");
  input.value = String(musicVolume);
  input.style.setProperty("--fill", `${musicVolume}%`);
  $("#music-mute-icon").setAttribute("href", musicVolume === 0 ? "#i-volume-off" : musicVolume < 50 ? "#i-volume-1" : "#i-volume");
  const label = musicVolume === 0 ? "Voltar o som" : "Tirar o som (só para você)";
  $("#music-mute").title = label;
  $("#music-mute").setAttribute("aria-label", label);
}
setMusicVolume(musicVolume);

// No YouTube dá para trocar a capa pelo vídeo (fica guardado neste aparelho).
let musicVideo = store.get("localStorage", MUSIC_VIDEO_KEY) === true;
function setMusicVideo(on) {
  musicVideo = on;
  store.set("localStorage", MUSIC_VIDEO_KEY, on);
  musicPanel.classList.toggle("show-video", on);
  const button = $("#music-video");
  button.title = on ? "Mostrar a capa" : "Ver o vídeo";
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-pressed", String(on));
  button.querySelector("use").setAttribute("href", on ? "#i-image" : "#i-video");
}
setMusicVideo(musicVideo);

function checkBlocked() {
  clearTimeout(blockTimer);
  blockTimer = setTimeout(() => {
    // Com o app em segundo plano não tem como tocar na tela: confere de novo quando ele voltar.
    if (document.hidden) return;
    const blocked = Boolean(music.now && music.playing && musicPlayer.ready && !musicPlayer.playing());
    if (blocked && !musicBlocked) toast("Tem música tocando: toque no ícone dela, no canto de cima, para ouvir junto.", "music", "headphones");
    musicBlocked = blocked;
    paintMusic();
  }, 2500);
}

// Acompanha o servidor: troca de música, play/pause e acerta o tempo se ficou mais de 2 s fora.
function syncMusic() {
  const track = music.now;
  if (!track) return musicPlayer.destroy();
  if (musicPlayer.uid !== track.uid) return musicPlayer.open(track, musicAt, () => music.playing);
  if (!musicPlayer.ready) return;
  if (music.playing) {
    if (Math.abs(musicPlayer.time() - musicAt()) > 2) musicPlayer.seek(musicAt());
    // Em segundo plano, insiste só um pouco: se o celular pausar de novo, volta a tocar quando o app voltar.
    if (!musicPlayer.playing() && !musicBlocked && (!document.hidden || musicRetries++ < 3)) {
      musicPlayer.play();
      checkBlocked();
    }
  } else if (musicPlayer.playing()) {
    musicPlayer.pause();
    musicPlayer.seek(music.position);
  }
}

// Volta a tocar aqui, no ponto em que a música está para os dois (depois de um toque o navegador deixa).
function listenHere() {
  musicBlocked = false;
  musicRetries = 0;
  if (music.now && musicPlayer.ready) {
    musicPlayer.seek(musicAt());
    if (music.playing) musicPlayer.play();
  }
  paintMusic();
  checkBlocked();
}

let unblockedAt = 0;
const unblockMusic = () => {
  if (!musicBlocked) return;
  unblockedAt = Date.now();
  listenHere();
};
// O toque que liberou o som não vale também como pausar (o botão mostrava o estado dos dois, não o daqui).
const justUnblocked = () => Date.now() - unblockedAt < 1000;

function applyMusic(state, measured = false) {
  if (!state) return;
  if (measured && state.serverNow) musicClock = state.serverNow - Date.now();
  const started = state.now && !music.now;
  if (state.now?.uid !== music.now?.uid) musicRetries = 0;
  music = state;
  if (!music.now) musicBlocked = false;
  paintMusic();
  // O ícone aparece no canto de cima da conversa quando a primeira música começa.
  if (started) fx.pop(musicButton);
  syncMusic();
}

function paintCard(card) {
  const uid = card.dataset.musicUid;
  const index = music.queue.findIndex((item) => item.uid === uid);
  const state = uid && music.now?.uid === uid ? (music.playing ? "playing" : "paused") : index >= 0 ? "queued" : "done";
  const [text, action, label] = CARD_STATE[state];
  const by = card.dataset.by;
  card.dataset.state = state;
  card.querySelector(".dj-state-text").textContent = [state === "queued" ? `${index + 1}ª ${text}` : text, by && (by === me ? "você pediu" : `${by} pediu`)].filter(Boolean).join(" · ");
  const button = card.querySelector(".dj-action");
  button.dataset.musicAction = action;
  button.title = label;
  button.setAttribute("aria-label", label);
}

const paintCards = () => messagesEl.querySelectorAll(".dj-card").forEach(paintCard);

// Cartão do Potato DJ no chat: compacto, com a capa desfocada no fundo. Mostra se está tocando, na fila ou se já tocou.
function musicCard(message) {
  const track = message.music;
  const card = el("div", "dj-card");
  card.dataset.openMusic = "";
  card.dataset.musicUid = track.uid || "";
  card.dataset.by = track.by || message.sender;
  const backdrop = el("span", "dj-backdrop");
  const cover = smallCover(track);
  if (cover) {
    const image = el("img");
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.src = cover;
    backdrop.append(image);
  }
  const title = el("strong", "dj-title", track.title);
  title.title = track.full || track.title;
  const artist = el("span", "dj-artist");
  artist.append(brand(shownSource(track)), el("span", "", track.artist || SOURCE_NAME[shownSource(track)]));
  const state = el("span", "dj-state");
  state.append(equalizer(), el("span", "dj-state-text"));
  const action = el("button", "dj-action");
  action.type = "button";
  action.append(icon("play", "icon when-play"), icon("pause", "icon when-pause"), icon("rotate-ccw", "icon when-again"));
  const progress = el("span", "dj-progress");
  progress.append(el("i"));
  card.append(backdrop, musicArt(track, "dj-art"), title, artist, state, action, progress);
  // A cor vai no balão (o cartão não tem caixa própria: os pedaços dele se encaixam no balão).
  trackTone(track).then((tone) => card.closest(".bubble")?.style.setProperty("--tone", tone || DEFAULT_TONE));
  paintCard(card);
  return card;
}

function cardAction(action, track) {
  if (musicBlocked) return listenHere();
  if (justUnblocked()) return;
  if (action === "again") return musicCommand("play", { query: trackLink(track) });
  musicCommand(action, action === "jump" ? { uid: track.uid } : {});
}

function queueItem(item, index) {
  const row = el("li", "music-item");
  const art = musicArt(item, "music-art");
  art.append(el("b", "music-order", String(index + 1)));
  const text = el("span", "music-item-text");
  const meta = el("small");
  meta.append(brand(shownSource(item)), el("span", "", [item.artist, requestedBy(item.by)].filter(Boolean).join(" · ")));
  text.append(el("strong", "", item.title), meta);
  const jump = el("button", "music-mini");
  jump.type = "button";
  jump.dataset.jump = item.uid;
  jump.title = "Tocar agora";
  jump.setAttribute("aria-label", `Tocar ${item.title} agora`);
  jump.append(icon("play"));
  const remove = el("button", "music-mini");
  remove.type = "button";
  remove.dataset.remove = item.uid;
  remove.title = "Tirar da fila";
  remove.setAttribute("aria-label", `Tirar ${item.title} da fila`);
  remove.append(icon("x"));
  row.append(art, text, jump, remove);
  return row;
}

// Troca de música: título, capa, cor e o que aparece na tela de bloqueio.
function paintTrack(track) {
  const title = $("#music-title");
  setMarquee(title, track.title);
  title.title = track.full || track.title;
  $("#music-meta").textContent = [track.artist, requestedBy(track.by)].filter(Boolean).join(" · ");
  $("#music-caption-title").textContent = track.title;
  $("#music-caption-artist").textContent = track.artist || SOURCE_NAME[shownSource(track)];
  $("#music-source").textContent = track.origin ? `${SOURCE_NAME[track.origin.source]} · pelo YouTube` : SOURCE_NAME[track.source];
  $("#music-logo").setAttribute("href", `#b-${shownSource(track)}`);
  const open = $("#music-open");
  open.href = trackLink(track);
  open.title = `Abrir no ${SOURCE_NAME[shownSource(track)]}`;
  open.setAttribute("aria-label", open.title);
  const small = smallCover(track);
  const glow = $("#music-glow");
  if (small) glow.src = small;
  else glow.removeAttribute("src");
  $("#music-mini-art").style.backgroundImage = small ? `url("${small}")` : "";
  musicButton.classList.toggle("has-art", Boolean(small));
  const cover = $("#music-cover");
  cover.classList.remove("ready");
  cover.removeAttribute("src");
  paintMediaTrack(track);
  bigCover(track).then((found) => {
    if (music.now?.uid !== track.uid) return;
    paintMediaTrack(track, found);
    if (!found.src) return;
    cover.classList.toggle("letterbox", found.letterbox);
    cover.onload = () => cover.classList.add("ready");
    cover.src = found.src;
  });
  trackTone(track).then((tone) => {
    if (music.now?.uid !== track.uid) return;
    for (const node of [musicPanel, musicButton]) node.style.setProperty("--tone", tone || DEFAULT_TONE);
  });
}

function paintMusic() {
  const track = music.now;
  const playing = Boolean(track && music.playing);
  musicButton.classList.toggle("hidden", !track);
  musicButton.classList.toggle("playing", playing && !musicBlocked);
  musicButton.classList.toggle("blocked", musicBlocked);
  musicButton.title = track ? `${musicBlocked ? "Toque para ouvir" : playing ? "Tocando" : "Pausada"}: ${track.title}` : "Música";
  musicPanel.classList.toggle("has-track", Boolean(track));
  musicPanel.classList.toggle("paused", !playing || musicBlocked);
  musicPanel.classList.toggle("blocked", musicBlocked);
  musicPanel.dataset.source = track?.source || "";
  $("#music-unblock").classList.toggle("hidden", !musicBlocked);
  $("#music-state").textContent = !track ? "Potato DJ" : musicBlocked ? "Toque para ouvir" : playing ? "Tocando agora" : "Pausada";
  if ((track?.uid || null) !== paintedTrack) {
    paintedTrack = track?.uid || null;
    if (track) paintTrack(track);
    else setExpanded(false);
  }
  // Som barrado aqui: o botão grande é o "ouvir junto" (e não o pausar dos dois).
  const toggle = $("#music-toggle");
  toggle.classList.toggle("is-off", !playing || musicBlocked);
  toggle.title = musicBlocked ? "Ouvir junto" : playing ? "Pausar para os dois" : "Tocar para os dois";
  $("#music-queue").replaceChildren(...music.queue.map(queueItem));
  $("#music-count").textContent = music.queue.length ? String(music.queue.length) : "";
  $("#music-next").classList.toggle("hidden", !music.queue.length);
  paintCards();
  paintMusicTime();
  paintMediaState();
  paintPosition();
  syncAnchor();
  syncWakeLock();
}

function paintMusicTime() {
  if (!music.now) return;
  const length = musicLength();
  const at = Math.min(musicAt(), length || Infinity);
  const progress = length ? Math.min(1, Math.max(0, at / length)) : 0;
  $("#music-time").textContent = clockTime(at);
  $("#music-length").textContent = length ? clockTime(length) : "–:––";
  messagesEl.querySelector(`.dj-card[data-music-uid="${CSS.escape(music.now.uid)}"]`)?.style.setProperty("--p", progress.toFixed(4));
  // Spotify sem login: o player só toca a prévia de 30 s.
  const full = music.now.duration;
  const heard = musicPlayer.duration();
  $("#music-preview").classList.toggle("hidden", !(music.now.source === "spotify" && full && heard && heard < full - 5));
  const seek = $("#music-seek");
  seek.disabled = !length;
  if (musicSeeking || !length) return;
  seek.max = String(length);
  seek.value = String(at);
  seek.style.setProperty("--fill", `${progress * 100}%`);
}

let bufferingSince = 0;
setInterval(paintMusicTime, 500);
setInterval(() => {
  if (!music.now) return;
  syncMusic();
  // Travado "carregando" há mais de 8 s com o app na tela: carrega de novo, no ponto certo.
  bufferingSince = musicPlayer.state() === 3 ? bufferingSince || Date.now() : 0;
  if (music.playing && !document.hidden && bufferingSince && Date.now() - bufferingSince > 8000) {
    bufferingSince = 0;
    musicPlayer.revive(musicAt());
  }
  // Já devia ter acabado (por exemplo, ninguém estava com o chat aberto quando terminou).
  const length = musicLength();
  if (music.playing && length && musicAt() > length + 4) socket?.emit("music", { op: "ended", uid: music.now.uid });
}, 4000);

// De volta ao app: no celular, o YouTube largou a música enquanto o app estava fora da tela (só o app dele,
// com Premium, toca em segundo plano). Ela volta sozinha, já no ponto em que está para os dois.
document.addEventListener("visibilitychange", () => {
  syncWakeLock();
  if (document.hidden || !music.now) return;
  musicRetries = 0;
  if (music.playing && musicPlayer.revive(musicAt())) bufferingSince = 0;
  else syncMusic();
  checkBlocked();
});

// Celular ou tablet (toque, sem mouse).
const phone = matchMedia("(hover: none) and (pointer: coarse)").matches;

// No celular, a tela fica acesa enquanto a música toca com o chat aberto: com a tela apagada, o YouTube para.
let wakeLock = null;
let wakeAsking = false;
const wantWake = () => phone && "wakeLock" in navigator && !document.hidden && Boolean(music.now && music.playing && !musicBlocked);
async function syncWakeLock() {
  if (wantWake() && !wakeLock && !wakeAsking) {
    wakeAsking = true;
    try {
      const lock = await navigator.wakeLock.request("screen");
      lock.addEventListener("release", () => {
        if (wakeLock === lock) wakeLock = null;
      });
      wakeLock = lock;
    } catch {}
    wakeAsking = false;
  }
  if (!wantWake() && wakeLock) {
    const lock = wakeLock;
    wakeLock = null;
    lock.release().catch(() => {});
  }
}

// ---- tela de bloqueio, notificação e teclas de mídia (no computador) ----
// Um silêncio tocando em loop nesta página, junto com a música, faz o sistema tratar o chat como o tocador:
// a notificação e as teclas de mídia mostram a capa e mandam no tocador dos dois. No celular ela fica
// desligada: lá o YouTube para quando o app sai da tela, e a tela de bloqueio mostraria "tocando" em silêncio.
const media = "mediaSession" in navigator ? navigator.mediaSession : null;
let anchor = null;

// WAV de 10 s em silêncio (8 kHz). Mais de 5 s: o Chrome só mostra a notificação para áudio "de verdade".
function silence(seconds = 10, rate = 8000) {
  return URL.createObjectURL(wavBlob(new Float32Array(seconds * rate), rate));
}

function syncAnchor() {
  if (!media || phone) return;
  if (!music.now || !music.playing || musicBlocked) return anchor?.pause();
  anchor ||= Object.assign(new Audio(silence()), { loop: true });
  if (anchor.paused) anchor.play().catch(() => {});
}

function paintMediaTrack(track, cover) {
  if (!media) return;
  try {
    media.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist || SOURCE_NAME[shownSource(track)],
      album: `Potato Chat · ${requestedBy(track.by)}`,
      artwork: cover?.src ? [{ src: cover.src, sizes: cover.sizes, type: "image/jpeg" }] : []
    });
  } catch {}
}

function paintMediaState() {
  if (!media) return;
  try {
    media.playbackState = !music.now ? "none" : music.playing ? "playing" : "paused";
    if (!music.now) media.metadata = null;
  } catch {}
}

function paintPosition() {
  const length = musicLength();
  if (!media?.setPositionState || !music.now || !length) return;
  try {
    media.setPositionState({ duration: length, playbackRate: 1, position: Math.min(Math.max(0, musicAt()), length) });
  } catch {}
}

if (media) {
  const actions = {
    play: () => (music.playing ? listenHere() : musicCommand("resume")),
    pause: () => musicCommand("pause"),
    stop: () => musicCommand("pause"),
    nexttrack: () => musicCommand("skip"),
    previoustrack: () => musicCommand("seek", { position: 0 }),
    seekto: (details) => musicCommand("seek", { position: details.seekTime }),
    seekbackward: (details) => musicCommand("seek", { position: Math.max(0, musicAt() - (details.seekOffset || 10)) }),
    seekforward: (details) => musicCommand("seek", { position: musicAt() + (details.seekOffset || 10) })
  };
  for (const [action, handler] of Object.entries(actions)) {
    try { media.setActionHandler(action, handler); } catch {}
  }
}

function musicCommand(op, extra = {}) {
  if (!socket?.connected) return toast("Sem conexão agora. Tente de novo em instantes.", "error");
  // Pelo nome demora um pouco (busca no YouTube), e o link do Spotify também (procura a mesma música no YouTube).
  if (op === "play" && extra.query && !/youtu\.?be/i.test(extra.query)) {
    toast(/https?:\/\/|spotify:/i.test(extra.query) ? "Abrindo a música…" : `Procurando “${extra.query.slice(0, 60)}”…`, "music", "search");
  }
  socket.timeout(25000).emit("music", { op, ...extra }, (error, result) => {
    if (error) return toast("O bot de música não respondeu. Tente de novo.", "error");
    if (!result?.ok) {
      sound.play("error");
      return toast(result?.error || "Não deu certo.", "error");
    }
    applyMusic(result.state, true);
    if (op === "play" && result.action?.added > 1) toast(`${result.action.added} músicas na fila: tocam inteiras, uma depois da outra`, "music", "list-music");
    else if (op === "play" && result.action?.queued) toast(`${result.action.queued}ª na fila: ${result.action.track.title}`, "music", "list-music");
  });
}

function musicNotice(action) {
  if (!action || action.by === me) return;
  if (action.op === "jump" && action.track) return toast(`${action.by} pôs “${action.track.title}” para tocar agora`, "music", "play");
  const [name, text] = MUSIC_NOTICE[action.op] || [];
  if (text) toast(`${action.by} ${text}`, "music", name);
}

// "/play …", "/pause", "/skip", "/stop", "/fila" (e apelidos em português). Outro texto com "/" vai como mensagem normal.
function runCommand(text) {
  const match = text.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return false;
  const typed = match[1].toLowerCase();
  const name = COMMAND_ALIAS[typed] || typed;
  if (!MUSIC_COMMANDS.some((command) => command.name === name)) return false;
  const query = (match[2] || "").trim();
  unblockMusic();
  if (name === "fila") openMusic();
  else if (name === "watchparty") {
    setWatchRoom(true);
    if (query) watchCommand("start", { query });
  } else if (name === "play") musicCommand("play", query ? { query } : {});
  else musicCommand(name);
  sound.play("tap");
  return true;
}

// Menu dos comandos: aparece ao começar a mensagem com "/".
function paintCommandMenu() {
  const typed = messageInput.value.match(/^\/(\S*)$/)?.[1].toLowerCase();
  const matches = typed === undefined ? [] : MUSIC_COMMANDS.filter((command) => command.name.startsWith(typed)
    || (typed && Object.entries(COMMAND_ALIAS).some(([alias, target]) => target === command.name && alias.startsWith(typed))));
  commandMenu.classList.toggle("hidden", !matches.length);
  commandMenu.replaceChildren(...matches.map((command) => {
    const option = el("button", "command");
    option.type = "button";
    option.setAttribute("role", "option");
    option.dataset.command = command.name;
    const name = el("span", "command-name", `/${command.name}`);
    if (command.args) name.append(el("i", "", ` ${command.args}`));
    const badge = el("span", "command-icon");
    badge.append(icon(command.icon));
    option.append(badge, name, el("small", "", command.text));
    return option;
  }));
}

function pickCommand(name) {
  const command = MUSIC_COMMANDS.find((item) => item.name === name);
  if (!command) return;
  if (command.args) {
    messageInput.value = `/${name} `;
    messageInput.focus();
  } else {
    messageInput.value = "";
    runCommand(`/${name}`);
  }
  paintCommandMenu();
}

messageInput.addEventListener("input", paintCommandMenu);
messageInput.addEventListener("keydown", (event) => {
  if (event.key !== "Tab" || commandMenu.classList.contains("hidden")) return;
  event.preventDefault();
  pickCommand(commandMenu.querySelector("[data-command]").dataset.command);
});
commandMenu.addEventListener("click", (event) => {
  const option = event.target.closest("[data-command]");
  if (option) pickCommand(option.dataset.command);
});

// Painel do tocador. Fechado, ele só sai da vista: a música continua tocando.
function openMusic() {
  closeGifs();
  closeAttach();
  musicPanel.classList.remove("closed");
  musicButton.setAttribute("aria-expanded", "true");
  paintMusic();
  if (music.now) setMarquee($("#music-title"), music.now.title);
}

function closeMusic() {
  setExpanded(false);
  musicPanel.classList.add("closed");
  musicButton.setAttribute("aria-expanded", "false");
}

// Tela cheia: a capa (ou o vídeo) grande. No computador e no Android vira tela cheia de verdade;
// no iPhone, que não deixa, ocupa a tela do navegador.
function setExpanded(on) {
  if (musicPanel.classList.contains("expanded") === on) return;
  musicPanel.classList.toggle("expanded", on);
  const button = $("#music-expand");
  button.title = on ? "Sair da tela cheia" : "Ver em tela cheia";
  button.setAttribute("aria-label", button.title);
  $("#music-expand-icon").setAttribute("href", on ? "#i-minimize" : "#i-maximize");
  if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  if (!on && document.fullscreenElement === document.documentElement) document.exitFullscreen?.().catch(() => {});
}

// Saiu da tela cheia pelo sistema (Esc, voltar do celular): a capa volta para o tocador.
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) setExpanded(false);
});

function showQueue() {
  if (!music.queue.length) return toast("A fila está vazia: peça outra com /play.", "music", "list-music");
  musicPanel.scrollTo({ top: $("#music-next").offsetTop - 12, behavior: "smooth" });
}

musicButton.addEventListener("click", () => {
  fx.press(musicButton);
  unblockMusic();
  if (musicPanel.classList.contains("closed")) openMusic();
  else closeMusic();
});

musicPanel.addEventListener("click", (event) => {
  const target = event.target;
  if (target.closest("#music-close")) return closeMusic();
  if (target.closest("#music-unblock")) return listenHere();
  if (target.closest("#music-toggle")) {
    if (musicBlocked) return listenHere();
    if (justUnblocked()) return;
    return musicCommand(music.playing ? "pause" : "resume");
  }
  if (target.closest("#music-skip")) return musicCommand("skip");
  if (target.closest("#music-stop")) return musicCommand("stop");
  if (target.closest("#music-restart")) return musicCommand("seek", { position: 0 });
  if (target.closest("#music-video")) return setMusicVideo(!musicVideo);
  if (target.closest("#music-expand")) return setExpanded(!musicPanel.classList.contains("expanded"));
  if (target.closest("#music-list")) return showQueue();
  if (target.closest("#music-mute")) {
    if (musicVolume > 0) volumeBefore = musicVolume;
    return setMusicVolume(musicVolume > 0 ? 0 : volumeBefore || 80);
  }
  if (target.closest("#music-try")) {
    closeMusic();
    messageInput.value = "/play ";
    messageInput.focus();
    return;
  }
  const jump = target.closest("[data-jump]");
  if (jump) return musicCommand("jump", { uid: jump.dataset.jump });
  const remove = target.closest("[data-remove]");
  if (remove) musicCommand("remove", { uid: remove.dataset.remove });
});

// Celular: arrastar o tocador para baixo (pelo topo ou pela capa) fecha, como no Spotify.
let musicDrag = null;
musicPanel.addEventListener("pointerdown", (event) => {
  if (!matchMedia("(max-width: 760px)").matches || event.button > 0 || musicPanel.classList.contains("expanded")) return;
  if (!event.target.closest(".music-head, .music-hero") || event.target.closest("button, a, input")) return;
  musicDrag = { id: event.pointerId, y: event.clientY, dy: 0 };
});
musicPanel.addEventListener("pointermove", (event) => {
  if (musicDrag?.id !== event.pointerId) return;
  musicDrag.dy = Math.max(0, event.clientY - musicDrag.y);
  if (musicDrag.dy < 6) return;
  musicPanel.classList.add("dragging");
  musicPanel.style.translate = `0 ${musicDrag.dy}px`;
});
const dropMusic = (event) => {
  if (musicDrag?.id !== event.pointerId) return;
  const far = musicDrag.dy > 110;
  musicDrag = null;
  musicPanel.classList.remove("dragging");
  musicPanel.style.translate = "";
  if (far) closeMusic();
};
musicPanel.addEventListener("pointerup", dropMusic);
musicPanel.addEventListener("pointercancel", dropMusic);

$("#music-seek").addEventListener("input", (event) => {
  const seek = event.target;
  musicSeeking = true;
  seek.style.setProperty("--fill", `${(seek.value / seek.max) * 100}%`);
  $("#music-time").textContent = clockTime(Number(seek.value));
});
$("#music-seek").addEventListener("change", (event) => {
  musicSeeking = false;
  musicCommand("seek", { position: Number(event.target.value) });
});

$("#music-volume").addEventListener("input", (event) => setMusicVolume(Number(event.target.value)));

// Um toque em qualquer lugar já libera o som (o navegador só deixa tocar depois de um toque na página).
for (const type of ["pointerup", "keydown"]) addEventListener(type, unblockMusic, true);

document.addEventListener("click", (event) => {
  if (!musicPanel.classList.contains("closed") && !event.target.closest("#music-panel, #music-button, [data-open-music]")) closeMusic();
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!commandMenu.classList.contains("hidden")) {
    event.stopPropagation();
    commandMenu.classList.add("hidden");
  } else if (musicPanel.classList.contains("expanded")) {
    event.stopPropagation();
    setExpanded(false);
  } else if (!musicPanel.classList.contains("closed")) {
    event.stopPropagation();
    closeMusic();
  }
}, true);

// ---------- watch party (/watchparty) ----------
// Uma sala só para assistir: o vídeo grande e a conversa do lado (no celular, embaixo).

// O que vem do servidor: o vídeo (now), se está passando e em que segundo estava em updatedAt (relógio dele).
let watch = { now: null, playing: false, position: 0, updatedAt: 0 };
// Vídeo do aparelho: cada um escolhe o seu arquivo (nada sobe para o servidor).
let watchFile = null;
let watchFileFor = null;
let watchStarting = false;
let watchPicking = false;
let watchBlocked = false;
let watchSeeking = false;
let watchBlockTimer = 0;
let watchUnblockedAt = 0;
// A sala está aberta aqui (cada um abre e sai quando quiser; o vídeo é o mesmo para os dois).
let watchRoom = false;
// A sala na tela (troca no meio da abertura de cinema, com as cortinas fechadas).
let watchView = false;
// O catálogo na sala, como no Rave: home (os serviços), youtube (o catálogo aqui dentro) e netflix, max e twitch
// (abrem o serviço; a sala segue o que for escolhido lá).
let watchScreen = "home";
const watchPanel = $("#watch-panel");
const watchButton = $("#watch-button");
const watchStage = $("#watch-stage");
// updatedAt no futuro = contagem para o play: até lá, parado no mesmo segundo.
const watchAt = () => (watch.playing ? watch.position + Math.max(0, Date.now() + musicClock - watch.updatedAt) / 1000 : watch.position);
// Netflix e HBO Max: nada toca aqui; cada um assiste na própria conta (a extensão sincroniza; no celular, a contagem).
const STREAMING = {
  netflix: { name: "Netflix", mark: "NETFLIX", open: "https://www.netflix.com/browse" },
  max: { name: "HBO Max", mark: "max", open: "https://play.hbomax.com/" }
};
const streaming = (item) => Boolean(item && STREAMING[item.source]);
const WATCH_HINT = {
  streaming: "Pode ser a mesma conta nos dois (com plano de 2 telas) ou uma para cada. No computador, a extensão do Potato Chat faz o player seguir a sala; no celular, a contagem ajuda a darem o play juntos."
};
const WATCH_WHERE = { youtube: "no YouTube", netflix: "na Netflix", max: "na HBO Max", twitch: "na Twitch" };
// Netflix, HBO Max e Twitch: a tela de cada um no catálogo.
const WATCH_LAUNCH = {
  netflix: { title: "Escolha na Netflix", text: "A Netflix abriu: escolha o filme ou o episódio e dê o play. No computador com a extensão do Potato Chat, a sala começa sozinha para os dois. No celular, volte aqui e toque em Começar a sessão." },
  max: { title: "Escolha na HBO Max", text: "A HBO Max abriu: escolha o filme ou o episódio e dê o play. No computador com a extensão do Potato Chat, a sala começa sozinha para os dois. No celular, volte aqui e toque em Começar a sessão." },
  twitch: { title: "Qual canal?", text: "O nome do canal (ao vivo) ou o link de um vídeo gravado." }
};
// Prateleiras do catálogo do YouTube (as buscas de cada uma ficam no servidor).
const WATCH_SHELVES = [["alta", "Em alta"], ["musicas", "Músicas"], ["trailers", "Trailers"], ["humor", "Humor"], ["games", "Games"], ["podcasts", "Podcasts"], ["esportes", "Esportes"], ["documentarios", "Documentários"], ["receitas", "Receitas"]];
let catalogShelf = "alta";
let catalogAsk = 0;
const catalogCache = new Map();
const catalogVideos = new Map();
let countdownAt = 0;
let countdownTimer = 0;
const hasWatchFile = (item) => Boolean(watchFile && (watchFileFor === item.uid || watchFile.name === item.name));

const watchPlayer = createWatchPlayer($("#watch-host"), {
  onReady: () => {
    syncWatch();
    checkWatchBlocked();
  },
  onUpdate: () => {
    if (watchBlocked && watchPlayer.playing()) {
      watchBlocked = false;
      paintWatch();
    }
    paintWatchTime();
  },
  onEnded: (uid) => {
    if (watch.now?.uid === uid) socket?.emit("watch", { op: "ended", uid });
  },
  onError: (uid, text) => {
    if (watch.now?.uid === uid) toast(text, "error");
  }
});

// O navegador barrou o som: aparece o "Toque no play" (no iPhone, o toque tem que ser no próprio player).
function checkWatchBlocked() {
  clearTimeout(watchBlockTimer);
  watchBlockTimer = setTimeout(() => {
    if (document.hidden) return;
    watchBlocked = Boolean(watch.now && watch.playing && watchPlayer.ready && !watchPlayer.playing());
    paintWatch();
  }, 3000);
}

// Acompanha o servidor: troca de vídeo, play/pause e acerta o tempo se ficou mais de 2 s fora.
function syncWatch() {
  const item = watch.now;
  if (!watchView || !item || streaming(item) || (item.source === "local" && !hasWatchFile(item))) return watchPlayer.destroy();
  if (watchPlayer.uid !== item.uid) return watchPlayer.open(item, watchAt, () => watch.playing, watchFile);
  if (!watchPlayer.ready) return;
  if (watch.playing) {
    if (!watchPlayer.live && Math.abs(watchPlayer.time() - watchAt()) > 2) watchPlayer.seek(watchAt());
    if (!watchPlayer.playing() && !watchBlocked) {
      watchPlayer.play();
      checkWatchBlocked();
    }
  } else if (watchPlayer.playing()) {
    watchPlayer.pause();
    if (!watchPlayer.live) watchPlayer.seek(watch.position);
  }
}

function watchListen() {
  watchBlocked = false;
  watchUnblockedAt = Date.now();
  if (watch.now && watchPlayer.ready) {
    if (!watchPlayer.live) watchPlayer.seek(watchAt());
    if (watch.playing) watchPlayer.play();
  }
  paintWatch();
  checkWatchBlocked();
}

// join: a sala abre sozinha quando um vídeo começa agora (ao abrir o app com um já passando, só o botão avisa).
function applyWatch(state, measured = false, join = true) {
  if (!state) return;
  if (measured && state.serverNow) musicClock = state.serverNow - Date.now();
  const started = Boolean(state.now && state.now.uid !== watch.now?.uid);
  watch = state;
  if (started) {
    watchBlocked = false;
    // Quem começou um vídeo do aparelho já está com o arquivo.
    if (watchStarting && state.now.source === "local" && state.now.by === me) watchFileFor = state.now.uid;
    watchStarting = false;
    // Quando o vídeo acabar, o catálogo volta do começo (os serviços).
    watchScreen = "home";
  }
  // Começou um vídeo: a sala abre para os dois.
  if (started && join) setWatchRoom(true);
  paintWatch();
  syncWatch();
}

function setWatchRoom(on) {
  if (watchRoom === on) return;
  watchRoom = on;
  watchButton.setAttribute("aria-pressed", String(on));
  if (on) closeMusic();
  else setWatchExpanded(false);
  // Saiu da sala no meio da escolha: para de aparecer "escolhendo" para a outra pessoa.
  if (!on) setWatchScreen("home");
  paintWatch();
  // Abertura (ou encerramento) de cinema: o site muda por trás do clarão. Entrando, o player (pesado) só abre
  // quando a animação termina, para ela não engasgar; saindo, ele fecha na hora.
  fx.cinema(on, () => {
    watchView = on;
    document.querySelector(".app-shell").classList.toggle("watching", on);
    paintWatch();
    if (!on) syncWatch();
    scrollToLatest();
  }, (cue) => sound.play(cue), () => {
    if (watchView) syncWatch();
  });
}

// ---------- catálogo (como no Rave) ----------

// Troca a tela do catálogo. A outra pessoa vê onde esta está escolhendo ("Ana está escolhendo na Netflix…"); na
// Netflix e na HBO Max, é isso que diz à extensão para começar a sala quando esta pessoa der o play lá.
function setWatchScreen(screen) {
  if (watchScreen === screen) return paintWatchPicker();
  watchScreen = screen;
  socket?.emit("watch", { op: "browse", service: screen === "home" ? "" : screen });
  if (screen === "youtube" && !$("#catalog-grid").childElementCount) loadCatalog({ shelf: catalogShelf });
  paintWatchPicker();
  if (!matchMedia("(pointer: fine)").matches) return;
  if (screen === "youtube") $("#catalog-query").focus();
  if (screen === "twitch") $("#watch-twitch-query").focus();
}

// Tocou num serviço: o vídeo do aparelho abre a escolha do arquivo; a Netflix e a HBO Max abrem de verdade (no
// celular, o app), com a conta de cada um; YouTube e Twitch abrem a tela deles aqui na sala.
function openWatchService(source) {
  if (source === "local") return $("#pick-watch").click();
  if (STREAMING[source]) window.open(STREAMING[source].open, "_blank", "noopener");
  setWatchScreen(source);
}

// A outra pessoa escolhendo agora (o aviso vale por 10 minutos).
function watchChooser() {
  const fresh = Object.entries(watch.browsing || {}).find(([name, entry]) => name !== me && Date.now() + musicClock - entry.at < 600000);
  return fresh ? { name: fresh[0], service: fresh[1].service } : null;
}

function paintWatchPicker() {
  const screen = watchScreen;
  $("#watch-home").classList.toggle("hidden", screen !== "home");
  $("#watch-catalog").classList.toggle("hidden", screen !== "youtube");
  $("#watch-launch").classList.toggle("hidden", !WATCH_LAUNCH[screen]);
  // No celular, escolhendo, o catálogo ganha mais altura.
  watchPanel.classList.toggle("browsing", screen !== "home");
  const chooser = watchChooser();
  const notice = $("#watch-browsing");
  notice.classList.toggle("hidden", !chooser);
  if (chooser) notice.textContent = `${chooser.name} está escolhendo ${WATCH_WHERE[chooser.service] || "algo"}…`;
  const recent = watch.recent || [];
  $("#watch-recent").classList.toggle("hidden", !recent.length);
  paintWatchRow($("#watch-recent-list"), recent);
  if (WATCH_LAUNCH[screen]) paintWatchLaunch(screen);
}

// A tela da Netflix, da HBO Max ou da Twitch.
function paintWatchLaunch(screen) {
  const service = STREAMING[screen];
  const launch = $("#watch-launch");
  launch.dataset.service = screen;
  $("#watch-launch-mark").replaceChildren(service ? el("b", `wordmark ${screen}`, service.mark) : brand(screen));
  $("#watch-launch-title").textContent = WATCH_LAUNCH[screen].title;
  $("#watch-launch-text").textContent = WATCH_LAUNCH[screen].text;
  $("#watch-launch-actions").classList.toggle("hidden", !service);
  $("#watch-twitch").classList.toggle("hidden", Boolean(service));
  if (service) {
    const open = $("#watch-launch-open");
    open.href = service.open;
    open.querySelector("span").textContent = `Abrir a ${service.name}`;
  }
  const seen = (watch.recent || []).filter((entry) => entry.source === screen);
  $("#watch-launch-seen").classList.toggle("hidden", !seen.length);
  paintWatchRow($("#watch-launch-recent"), seen);
}

// "Vistos por vocês": capa do YouTube, logo da Twitch ou a marca da Netflix e da HBO Max, e o nome.
function paintWatchRow(row, entries) {
  const keys = entries.map((entry) => entry.key).join("|");
  if (row.dataset.keys === keys) return;
  row.dataset.keys = keys;
  row.replaceChildren(...entries.map((entry) => {
    const card = el("button", `recent-card ${entry.source}`);
    card.type = "button";
    card.dataset.recent = entry.key;
    card.title = entry.title;
    const art = el("span", "recent-art");
    if (entry.source === "youtube") art.append(watchThumb(entry.id));
    else if (STREAMING[entry.source]) art.append(el("b", `wordmark ${entry.source}`, STREAMING[entry.source].mark));
    else art.append(brand(entry.source));
    card.append(art, el("span", "recent-title", entry.title));
    return card;
  }));
}

function watchThumb(id) {
  const image = new Image();
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  image.src = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
  return image;
}

// De novo, para os dois. Na Netflix e na HBO Max, abre o mesmo título aqui e começa a sessão.
function replayWatch(key) {
  const entry = (watch.recent || []).find((item) => item.key === key);
  if (!entry) return;
  if (entry.source === "youtube") return watchCommand("start", { video: { id: entry.id, title: entry.title, channel: entry.channel, duration: entry.duration } });
  if (entry.source === "twitch") return watchCommand("start", { query: entry.kind === "video" ? `https://www.twitch.tv/videos/${entry.id}` : `https://www.twitch.tv/${entry.id}` });
  window.open(entry.url, "_blank", "noopener");
  watchCommand("start", { query: entry.url, service: entry.source, title: entry.title });
}

// Uma prateleira ou a busca: os cartões cinza aparecem enquanto o YouTube responde (fica guardado 10 minutos).
function loadCatalog({ shelf = "", query = "" }) {
  catalogShelf = shelf;
  for (const chip of $("#catalog-shelves").children) chip.classList.toggle("active", chip.dataset.shelf === shelf);
  const key = shelf ? `shelf:${shelf}` : `query:${query.toLowerCase()}`;
  const cached = catalogCache.get(key);
  if (cached && Date.now() - cached.at < 600000) return paintCatalog(cached.results);
  const ask = ++catalogAsk;
  paintCatalog(null);
  if (!socket?.connected) return paintCatalog([], "Sem conexão agora. Tente de novo em instantes.");
  socket.timeout(25000).emit("watch", { op: "search", shelf, query }, (error, result) => {
    if (ask !== catalogAsk) return;
    if (error || !result?.ok) return paintCatalog([], "Não deu para carregar agora. Tente de novo.");
    catalogCache.set(key, { at: Date.now(), results: result.results });
    paintCatalog(result.results);
  });
}

// Os vídeos em grade, como no YouTube: capa com a duração, o nome, o canal e as visualizações.
function paintCatalog(results, message = "") {
  const grid = $("#catalog-grid");
  grid.scrollTop = 0;
  grid.toggleAttribute("aria-busy", !results);
  if (!results) {
    grid.replaceChildren(...Array.from({ length: 8 }, () => {
      const card = el("div", "catalog-card skeleton");
      const info = el("span", "catalog-info");
      info.append(el("i"), el("i"));
      card.append(el("span", "catalog-thumb"), info);
      return card;
    }));
    return;
  }
  if (!results.length) return grid.replaceChildren(el("p", "catalog-empty", message || "Nada por aqui. Tente outra busca."));
  catalogVideos.clear();
  grid.replaceChildren(...results.map((video) => {
    catalogVideos.set(video.id, video);
    const card = el("button", "catalog-card");
    card.type = "button";
    card.dataset.video = video.id;
    const art = el("span", "catalog-thumb");
    art.append(watchThumb(video.id));
    if (video.duration) art.append(el("span", "catalog-time", clockTime(video.duration)));
    const info = el("span", "catalog-info");
    info.append(el("strong", "", video.title), el("small", "", [video.channel, video.views, video.age].filter(Boolean).join(" · ")));
    card.append(art, info);
    return card;
  }));
}

$("#catalog-shelves").append(...WATCH_SHELVES.map(([key, label]) => {
  const chip = el("button", "catalog-shelf", label);
  chip.type = "button";
  chip.dataset.shelf = key;
  return chip;
}));

$("#catalog-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#catalog-query");
  const query = input.value.trim();
  if (!query) return input.focus();
  // Link colado (YouTube, Twitch, Netflix ou HBO Max): abre direto.
  if (/^https?:\/\/|youtu\.?be|twitch\.tv|netflix\.com|max\.com/i.test(query)) {
    input.value = "";
    return watchCommand("start", { query });
  }
  input.blur();
  loadCatalog({ query });
});

$("#watch-twitch").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#watch-twitch-query");
  let query = input.value.trim();
  if (!query) return input.focus();
  // Só o nome do canal já basta.
  if (!/twitch\.tv/i.test(query)) query = `twitch.tv/${query.replace(/^@/, "")}`;
  watchCommand("start", { query });
  input.value = "";
});

function paintWatch() {
  const item = watch.now;
  watchPanel.classList.toggle("hidden", !watchView);
  watchPanel.classList.toggle("has-video", Boolean(item));
  watchButton.classList.toggle("live", Boolean(item) && !watchRoom);
  watchButton.title = item && !watchRoom ? `Batata Watch Party rolando: ${item.title}` : "Batata Watch Party";
  $("#watch-picker").classList.toggle("hidden", Boolean(item));
  $("#watch-who").textContent = peerName ? `com ${peerName}` : "";
  watchPanel.dataset.source = item?.source || "";
  // Fechou o vídeo: sai também o cartão da Netflix ou da HBO Max e os avisos de cima do palco.
  const service = item ? STREAMING[item.source] : null;
  $("#watch-stream").classList.toggle("hidden", !service);
  if (!item) {
    $("#watch-need").classList.add("hidden");
    $("#watch-unblock").classList.add("hidden");
    paintWatchPicker();
    return setWatchExpanded(false);
  }
  watchPanel.classList.remove("browsing");
  const needFile = item.source === "local" && !hasWatchFile(item);
  const live = item.source === "twitch" && item.kind === "channel";
  if (service) {
    const mark = $("#watch-stream-mark");
    mark.textContent = service.mark;
    mark.className = `wordmark ${item.source}`;
    $("#watch-stream-title").textContent = item.title === service.name ? "" : item.title;
    const open = $("#watch-stream-open");
    open.href = item.url;
    open.querySelector("span").textContent = `Abrir na ${service.name}`;
    $("#watch-stream-note").textContent = WATCH_HINT.streaming;
  }
  $("#watch-need").classList.toggle("hidden", !needFile);
  $("#watch-need-name").textContent = item.name || "";
  $("#watch-unblock").classList.toggle("hidden", !watchBlocked || needFile);
  watchStage.classList.toggle("blocked", watchBlocked);
  watchPanel.classList.toggle("live", live);
  $("#watch-live").classList.toggle("hidden", !live);
  $("#watch-title").textContent = item.title;
  $("#watch-title").title = item.title;
  $("#watch-logo").setAttribute("href", `#b-${item.source}`);
  const toggle = $("#watch-toggle");
  toggle.classList.toggle("is-off", !watch.playing || watchBlocked);
  toggle.title = watchBlocked ? "Assistir junto" : watch.playing ? "Pausar para os dois" : "Tocar para os dois";
  toggle.setAttribute("aria-label", toggle.title);
  paintWatchTime();
}

function paintWatchTime() {
  if (!watch.now) return;
  if (streaming(watch.now)) {
    const waiting = watch.playing && watch.updatedAt > Date.now() + musicClock;
    $("#watch-stream-clock").textContent = clockTime(watchAt());
    $("#watch-stream-state").textContent = waiting ? "Prontos para o play…" : watch.playing ? "Passando agora" : "Pausado";
    $("#watch-stream").classList.toggle("playing", watch.playing && !waiting);
  }
  const length = watchPlayer.duration() || watch.now.duration || 0;
  const at = Math.min(watchAt(), length || Infinity);
  $("#watch-time").textContent = clockTime(at);
  $("#watch-length").textContent = length ? clockTime(length) : "–:––";
  const seek = $("#watch-seek");
  seek.disabled = !length;
  if (watchSeeking || !length) return;
  seek.max = String(length);
  seek.value = String(at);
  seek.style.setProperty("--fill", `${(at / length) * 100}%`);
}

setInterval(paintWatchTime, 500);
setInterval(() => {
  if (watch.now) syncWatch();
}, 3000);

function watchCommand(op, extra = {}) {
  if (!socket?.connected) return toast("Sem conexão agora. Tente de novo em instantes.", "error");
  if (op === "start" && (extra.query || extra.video)) toast("Abrindo o vídeo…", "music", "tv");
  socket.timeout(20000).emit("watch", { op, ...extra }, (error, result) => {
    if (error) return toast("Não deu para mexer no vídeo agora. Tente de novo.", "error");
    if (!result?.ok) {
      watchStarting = false;
      sound.play("error");
      return toast(result?.error || "Não deu certo.", "error");
    }
    applyWatch(result.state, true);
    if (result.action?.op === "countdown") showCountdown(result.action.at);
  });
}

function watchNotice(action) {
  if (action?.op === "countdown") showCountdown(action.at);
  if (!action || action.by === me) return;
  // Netflix e HBO Max sem a extensão: o aviso pede para fazer o mesmo no player de lá.
  if (streaming(watch.now) && action.op === "pause") return toast(`${action.by} pausou: pause aí também`, "music", "pause");
  if (streaming(watch.now) && action.op === "resume") return toast(`${action.by} deu o play: dê o play aí também`, "music", "play");
  if (action.op === "start" && action.item) toast(`${action.by} começou um vídeo: ${action.item.title}`, "music", "tv");
  else if (action.op === "pause") toast(`${action.by} pausou o vídeo`, "music", "pause");
  else if (action.op === "resume") toast(`${action.by} voltou a passar o vídeo`, "music", "play");
  else if (action.op === "stop") toast(`${action.by} fechou o vídeo`, "music", "x");
}

// Vídeo do aparelho: lê a duração e começa para os dois (a outra pessoa escolhe o mesmo arquivo no aparelho dela).
async function startLocalVideo(file) {
  if (!file.type.startsWith("video/") && !/\.(mp4|m4v|mov|webm|mkv)$/i.test(file.name)) return toast("Escolha um arquivo de vídeo.", "error");
  const duration = await new Promise((resolve) => {
    const probe = document.createElement("video");
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(value);
    };
    probe.preload = "metadata";
    probe.onloadedmetadata = () => finish(Number.isFinite(probe.duration) ? probe.duration : 0);
    probe.onerror = () => finish(0);
    setTimeout(() => finish(0), 6000);
    probe.src = url;
  });
  watchFile = file;
  watchFileFor = null;
  watchStarting = true;
  watchCommand("start", { local: { name: file.name, size: file.size, duration } });
}

$("#pick-watch").addEventListener("change", (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  // Entrando num vídeo que a outra pessoa começou: só guarda o arquivo daqui.
  if (watchPicking && watch.now?.source === "local") {
    watchPicking = false;
    watchFile = file;
    watchFileFor = watch.now.uid;
    if (watch.now.size && file.size !== watch.now.size) toast("Esse arquivo é diferente do da outra pessoa: as cenas podem não bater.", "info");
    paintWatch();
    return syncWatch();
  }
  watchPicking = false;
  startLocalVideo(file);
});

// Tela cheia: no computador e no Android, de verdade; no iPhone, ocupa a tela do navegador.
function setWatchExpanded(on) {
  if (watchPanel.classList.contains("expanded") === on) return;
  watchPanel.classList.toggle("expanded", on);
  $("#watch-full-icon").setAttribute("href", on ? "#i-minimize" : "#i-maximize");
  $("#watch-full").title = on ? "Sair da tela cheia" : "Tela cheia";
  if (on && !document.fullscreenElement) watchPanel.requestFullscreen?.().catch(() => {});
  if (!on && document.fullscreenElement === watchPanel) document.exitFullscreen?.().catch(() => {});
}

document.addEventListener("fullscreenchange", () => {
  if (document.fullscreenElement !== watchPanel) setWatchExpanded(false);
});

watchButton.addEventListener("click", () => {
  fx.press(watchButton);
  setWatchRoom(!watchRoom);
});

// Contagem 3, 2, 1 nos dois aparelhos ao mesmo tempo (pelo relógio do servidor), para darem o play juntos.
function showCountdown(at) {
  if (!at || at === countdownAt) return;
  countdownAt = at;
  const box = $("#watch-count");
  const number = $("#watch-count-number");
  let shown = "";
  box.classList.remove("hidden");
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    const left = at - (Date.now() + musicClock);
    const next = left > 3000 ? "Prontos?" : left > 0 ? String(Math.ceil(left / 1000)) : "Play!";
    if (next !== shown) {
      shown = next;
      number.textContent = next;
      box.classList.toggle("go", next === "Play!");
      fx.pop(number);
      sound.play(next === "Play!" ? "connected" : "tap");
    }
    if (left < -1200) {
      clearInterval(countdownTimer);
      box.classList.add("hidden");
    }
  }, 80);
}

watchPanel.addEventListener("click", async (event) => {
  const target = event.target;
  if (target.closest("#watch-leave")) return setWatchRoom(false);
  if (target.closest("#watch-countdown")) return watchCommand("countdown");
  const source = target.closest("[data-watch-source]");
  if (source) return openWatchService(source.dataset.watchSource);
  if (target.closest("[data-watch-back]")) return setWatchScreen("home");
  const shelf = target.closest("[data-shelf]");
  if (shelf) {
    $("#catalog-query").value = "";
    return loadCatalog({ shelf: shelf.dataset.shelf });
  }
  const video = target.closest("[data-video]");
  if (video) return watchCommand("start", { video: catalogVideos.get(video.dataset.video) });
  const recent = target.closest("[data-recent]");
  if (recent) return replayWatch(recent.dataset.recent);
  // Sem a extensão (no celular): já escolheram lá e deram o play; a sala começa a contar o tempo.
  if (target.closest("#watch-launch-start")) return watchCommand("start", { service: watchScreen, query: "" });
  if (target.closest("#watch-unblock")) return watchListen();
  if (target.closest("#watch-pick")) {
    watchPicking = true;
    return $("#pick-watch").click();
  }
  if (target.closest("#watch-full")) return setWatchExpanded(!watchPanel.classList.contains("expanded"));
  if (target.closest("#watch-toggle")) {
    if (watchBlocked) return watchListen();
    if (Date.now() - watchUnblockedAt < 1000) return;
    return watchCommand(watch.playing ? "pause" : "resume");
  }
  if (target.closest("#watch-close")) {
    if (await confirmDialog({ title: "Fechar o vídeo?", text: "Ele para para os dois.", confirm: "Fechar" })) watchCommand("stop");
  }
});

$("#watch-seek").addEventListener("input", (event) => {
  const seek = event.target;
  watchSeeking = true;
  seek.style.setProperty("--fill", `${(seek.value / seek.max) * 100}%`);
  $("#watch-time").textContent = clockTime(Number(seek.value));
});
$("#watch-seek").addEventListener("change", (event) => {
  watchSeeking = false;
  watchCommand("seek", { position: Number(event.target.value) });
});

// Um toque em qualquer lugar já libera o som do vídeo (como na música).
for (const type of ["pointerup", "keydown"]) {
  addEventListener(type, () => {
    if (watchBlocked) watchListen();
  }, true);
}

// De volta ao app (celular): o vídeo volta no ponto certo.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && watch.now) syncWatch();
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !watchPanel.classList.contains("expanded")) return;
  event.stopPropagation();
  setWatchExpanded(false);
}, true);

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
  peerOpen.classList.toggle("has-peer", Boolean(peer));
  peerOpen.tabIndex = peer ? 0 : -1;
  peerOpen.title = peer ? `Ver o perfil de ${peer.name}` : "";
  peerOpen.setAttribute("aria-label", peer ? `Ver o perfil de ${peer.name}` : "Ninguém na conversa ainda");
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

// "digitando…", "online agora", "Visto por último hoje às 14:03"… (no topo e no perfil da outra pessoa).
function peerStatusText(peer) {
  if (peerTyping) return peerTyping === "audio" ? "gravando áudio…" : "digitando…";
  if (!peer) return "Mande o link para a outra pessoa criar a conta dela";
  if (peer.online) return peer.active ? "online agora" : "online";
  return lastSeenLabel(peer.lastSeen);
}

function paintPeerStatus() {
  const peer = presenceList.find((user) => user.name === peerName);
  peerStatus.classList.toggle("live", Boolean(peerTyping || peer?.online));
  setTicker(peerStatus, peerStatusText(peer));
  if (!peerProfile.classList.contains("hidden")) paintPeerProfile();
}

// ---------- perfil da outra pessoa ----------

// Abre tocando no nome ou na foto dela, no topo da conversa: a foto (toque para ampliar), o status ao vivo,
// os números dela e atalhos para ligar ou escrever.
const peerProfile = $("#peer-profile");
const peerOpen = $("#peer-open");

function openPeerProfile() {
  if (!peerName) return;
  closeTools();
  $("#peer-profile-since").textContent = "";
  paintPeerProfile();
  peerProfile.classList.remove("hidden");
  fx.incoming(peerProfile.querySelector(".modal-card"));
  $("#peer-profile-close").focus();
  sound.play("tap");
  document.addEventListener("keydown", onPeerProfileKey, true);
  loadStats(peerProfile, peerName, (date) => { $("#peer-profile-since").textContent = `Conversando com você desde ${date}`; });
}

function closePeerProfile() {
  if (peerProfile.classList.contains("hidden")) return;
  peerProfile.classList.add("hidden");
  document.removeEventListener("keydown", onPeerProfileKey, true);
  peerOpen.focus({ preventScroll: true });
}

function paintPeerProfile() {
  if (!peerName) return closePeerProfile();
  const peer = presenceList.find((user) => user.name === peerName);
  const hasPhoto = avatars.has(peerName);
  $("#peer-profile-name").textContent = peerName;
  paintAvatar($("#peer-profile-face"), peerName);
  const photo = $("#peer-profile-photo");
  photo.classList.toggle("no-photo", !hasPhoto);
  photo.setAttribute("aria-label", hasPhoto ? `Ver a foto de ${peerName}` : `${peerName} ainda não tem foto`);
  const status = $("#peer-profile-status");
  status.textContent = peerStatusText(peer);
  status.classList.toggle("live", Boolean(peerTyping || peer?.online));
  // Ligar só com a pessoa online (como os botões do topo; tocar mesmo assim explica por quê).
  peerProfile.querySelectorAll('[data-peer-action="audio"], [data-peer-action="video"]').forEach((button) => button.classList.toggle("unavailable", !peer?.online));
}

// Esc fecha o perfil (com a foto ampliada aberta, o Esc é dela).
function onPeerProfileKey(event) {
  if (event.key !== "Escape" || !viewer.classList.contains("hidden")) return;
  event.stopPropagation();
  closePeerProfile();
}

peerOpen.addEventListener("click", openPeerProfile);
peerOpen.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  openPeerProfile();
});

peerProfile.addEventListener("click", (event) => {
  if (event.target === peerProfile || event.target.closest("#peer-profile-close")) return closePeerProfile();
  if (event.target.closest("#peer-profile-photo")) {
    if (avatars.has(peerName)) openViewer({ url: avatars.get(peerName), name: peerName });
    return;
  }
  const action = event.target.closest("[data-peer-action]")?.dataset.peerAction;
  if (!action) return;
  closePeerProfile();
  if (action === "message") {
    if (tab !== "chat") showTab("chat");
    messageInput.focus();
  } else {
    $(action === "audio" ? "#audio-call" : "#video-call").click();
  }
});

// Texto que não cabe no celular (o "Visto por último…") passa devagar, como um letreiro. Só no celular: no
// computador, o que não couber (na sala da Watch Party) termina em "…", com o texto inteiro ao passar o mouse.
// Duas cópias andando juntas: quando a primeira sai, a segunda está no lugar dela, sem emenda.
const tickerScreen = matchMedia("(max-width: 760px)");
function setTicker(node, text, force = false) {
  if (node.dataset.text === text && !force) return;
  node.dataset.text = text;
  node.title = text;
  const line = el("span", "ticker-line", text);
  node.replaceChildren(line);
  node.classList.remove("ticking");
  if (!tickerScreen.matches) return;
  requestAnimationFrame(() => {
    if (line.offsetWidth <= node.clientWidth + 1) return;
    const copy = el("span", "ticker-line", text);
    copy.setAttribute("aria-hidden", "true");
    node.append(copy);
    node.style.setProperty("--ticker-time", `${(line.offsetWidth / 30 + 2).toFixed(1)}s`);
    node.classList.add("ticking");
  });
}

// O espaço muda (girar o celular, entrar ou sair da Watch Party, o botão da música crescendo, fonte carregando):
// mede de novo. Observa a barra e os botões, que não mudam de tamanho por causa do letreiro.
let tickerTimer = 0;
const remeasureTicker = () => {
  clearTimeout(tickerTimer);
  tickerTimer = setTimeout(() => setTicker(peerStatus, peerStatus.dataset.text || peerStatus.textContent, true), 200);
};
if (window.ResizeObserver) {
  const tickerSpace = new ResizeObserver(remeasureTicker);
  tickerSpace.observe($(".topbar"));
  tickerSpace.observe($(".topbar .actions"));
} else {
  addEventListener("resize", remeasureTicker);
}
document.fonts?.ready.then(remeasureTicker);

// audio = gravando um áudio (quem grava repete o aviso a cada 3 s; sem aviso por 5 s, some).
function setPeerTyping(active, audio = false) {
  clearTimeout(peerTypingTimer);
  if (active) peerTypingTimer = setTimeout(() => setPeerTyping(false), 5000);
  const mode = !active ? "" : audio ? "audio" : "text";
  if (mode === peerTyping) return;
  const appearing = !peerTyping;
  peerTyping = mode;
  // O "digitando" só ocupa espaço enquanto aparece: quem estava no fim da conversa continua vendo a última mensagem.
  const pinned = nearBottom();
  typingText.textContent = mode ? `${peerName || "A outra pessoa"} está ${mode === "audio" ? "gravando um áudio" : "digitando"}` : "";
  // Sumindo, o ícone fica como estava até o fim da animação.
  if (mode) typingEl.classList.toggle("audio", mode === "audio");
  if (appearing || !mode) fx.typing(typingEl, Boolean(mode));
  if (appearing && mode && pinned) setTimeout(() => scrollToLatest(true), 220);
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
const myStream = $("#my-stream");
const myStreamVideo = myStream.querySelector("video");
const shareSheet = $("#share-sheet");
const SHARE_AUDIO_KEY = "potato.shareAudio";
const QUALITY_LABEL = { "720p": "720p", "1080p": "1080p", "1080p60": "1080p 60fps" };
const canPip = Boolean(document.pictureInPictureEnabled && streamVideo.requestPictureInPicture);
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

// Enquadramento: o quadro de cada vídeo segue o formato real da câmera (celular em pé fica em pé), sem cortar o rosto.
function watchShape(tile, video) {
  const update = () => {
    if (!video.videoWidth || !video.videoHeight) return;
    tile.style.setProperty("--ar", `${video.videoWidth} / ${video.videoHeight}`);
    tile.style.setProperty("--ar-n", (video.videoWidth / video.videoHeight).toFixed(4));
  };
  video.addEventListener("loadedmetadata", update);
  video.addEventListener("resize", update);
}

function setVideo(element, track) {
  const id = track?.id || "";
  if (element.dataset.track === id) return;
  element.srcObject = track ? new MediaStream([track]) : null;
  element.dataset.track = id;
}

function paintTile(tile, { video, muted, live }) {
  setVideo(tile.querySelector("video"), video);
  if (!video) ["--ar", "--ar-n"].forEach((name) => tile.style.removeProperty(name));
  tile.classList.toggle("has-video", Boolean(video));
  tile.classList.toggle("muted", muted);
  tile.classList.toggle("live", live);
}

function leavePip() {
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
}

function paintStage() {
  if (!call) return;
  const { local, remote, remoteState } = call;
  const peerLive = Boolean(remoteState.screen && remote.screen);

  // A transmissão da outra pessoa ocupa o palco; a sua aparece só como prévia no canto.
  stage.classList.toggle("has-stream", peerLive);
  streamTile.classList.toggle("hidden", !peerLive);
  if (peerLive) {
    const tracks = [remote.screen, remote.screenAudio].filter(Boolean);
    const ids = tracks.map((track) => track.id).join();
    if (streamVideo.dataset.tracks !== ids) {
      streamVideo.srcObject = new MediaStream(tracks);
      streamVideo.dataset.tracks = ids;
    }
    $("#stream-owner").textContent = `Transmissão de ${call.name}`;
  } else if (streamVideo.srcObject) {
    leavePip();
    streamVideo.srcObject = null;
    delete streamVideo.dataset.tracks;
  }
  myStream.classList.toggle("hidden", !local.screen);
  setVideo(myStreamVideo, local.screen);
  const pill = $("#live-pill");
  pill.classList.toggle("hidden", !local.screen);
  pill.textContent = local.screen ? `Transmitindo · ${QUALITY_LABEL[call.quality] || "tela"}` : "";

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

// key = qualidade (QUALITY); audio = levar junto o som do que estiver tocando.
async function startLive(key = currentQuality(), audio = shareAudio()) {
  const active = call;
  if (!active || !canStream) return false;
  const quality = QUALITY[key] || QUALITY["1080p"];
  let display;
  try {
    display = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: quality.width }, height: { ideal: quality.height }, frameRate: { ideal: quality.frameRate, max: quality.frameRate } },
      audio,
      systemAudio: audio ? "include" : "exclude",
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

// share = { quality, audio }, escolhidos na janela de transmitir (só para media "screen").
async function startCall(media, share = {}) {
  if (call) {
    if (media === "video" && !call.local.cam) return toggleCam();
    if (media === "screen" && !call.local.screen) return startLive(share.quality, share.audio);
    return toast("Você já está numa chamada.");
  }
  if (!peerOnline()) {
    sound.play("error");
    return toast(`${peerName || "A outra pessoa"} não está online agora.`);
  }
  const active = call = newCall({ media, role: "caller", name: peerName });
  // A tela é escolhida primeiro, enquanto o clique ainda vale para o navegador.
  if (media === "screen" && !(await startLive(share.quality, share.audio))) return teardown(false);
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
  closeShare();
  leavePip();
  myStream.classList.add("hidden");
  $("#live-pill").classList.add("hidden");
  chatView.classList.remove("call-expanded", "in-call");
  callInfo.classList.remove("live");
  messageInput.placeholder = "Escreva uma mensagem…";
  [tileMe, tilePeer].forEach((tile) => {
    tile.classList.remove("speaking", "has-video", "live", "muted", "ringing");
    ["--ar", "--ar-n"].forEach((name) => tile.style.removeProperty(name));
  });
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  fx.hide(callPanel, { y: -20, scale: 0.97 });
  requestAnimationFrame(() => scrollToLatest());
}

function toggleFullscreen() {
  if (document.fullscreenElement) return document.exitFullscreen().catch(() => {});
  streamTile.requestFullscreen?.().catch(() => {});
}

// ---------- transmitir a tela ----------

const shareAudio = () => store.get("localStorage", SHARE_AUDIO_KEY) !== false;

// Navegador de celular (Android e iPhone) não deixa site nenhum capturar a tela: o botão fica, e explica.
function explainNoShare() {
  const phone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || matchMedia("(pointer: coarse)").matches;
  toast(!window.isSecureContext ? "Para transmitir a tela, o site precisa abrir com https://."
    : inExtension ? mediaDeniedText()
    : phone ? "O celular não deixa transmitir a tela pelo navegador. Transmita pelo computador; pelo celular dá para assistir."
    : "Este navegador não deixa transmitir a tela. Use o Chrome, o Edge ou o Firefox no computador.");
  sound.play("error");
}

function paintShare(quality) {
  shareSheet.dataset.choice = quality;
  shareSheet.querySelectorAll("[data-quality]").forEach((option) => option.setAttribute("aria-checked", String(option.dataset.quality === quality)));
  const audio = $("#share-audio");
  audio.classList.toggle("is-off", !shareAudio());
  audio.setAttribute("aria-checked", String(shareAudio()));
}

function onShareKey(event) {
  if (event.key !== "Escape") return;
  event.stopPropagation();
  closeShare();
}

function openShare() {
  if (!canStream) return explainNoShare();
  if (!call && !peerOnline()) {
    sound.play("error");
    return toast(`${peerName || "A outra pessoa"} não está online agora.`);
  }
  paintShare(currentQuality());
  shareSheet.classList.remove("hidden");
  fx.incoming(shareSheet.querySelector(".modal-card"));
  document.addEventListener("keydown", onShareKey, true);
  $("#share-go").focus();
}

function closeShare() {
  shareSheet.classList.add("hidden");
  document.removeEventListener("keydown", onShareKey, true);
}

shareSheet.addEventListener("click", (event) => {
  const option = event.target.closest("#share-options [data-quality]");
  if (option) {
    paintShare(option.dataset.quality);
    fx.press(option);
    sound.play("tap");
  } else if (event.target.closest("#share-audio")) {
    store.set("localStorage", SHARE_AUDIO_KEY, !shareAudio());
    paintShare(shareSheet.dataset.choice);
    fx.press($("#share-audio"));
  } else if (event.target.closest("#share-go")) {
    // O clique em Transmitir abre a escolha de tela do navegador (precisa ser direto do clique).
    const share = { quality: shareSheet.dataset.choice, audio: shareAudio() };
    closeShare();
    if (call) startLive(share.quality, share.audio);
    else startCall("screen", share);
  } else if (event.target === shareSheet || event.target.closest("#share-cancel")) {
    closeShare();
  }
});

$("#audio-call").addEventListener("click", () => startCall("audio"));
$("#video-call").addEventListener("click", () => startCall("video"));
$("#share-screen").addEventListener("click", () => (call?.local.screen ? toast("Você já está transmitindo.") : openShare()));
$("#toggle-mic").addEventListener("click", toggleMic);
$("#toggle-cam").addEventListener("click", toggleCam);
$("#toggle-live").addEventListener("click", () => (call?.local.screen ? stopLive() : openShare()));
$("#stop-stream").addEventListener("click", () => stopLive());
$("#stream-pip").classList.toggle("hidden", !canPip);
$("#stream-pip").addEventListener("click", () => {
  const request = document.pictureInPictureElement ? document.exitPictureInPicture() : streamVideo.requestPictureInPicture();
  request.catch(() => toast("Não deu para abrir a janelinha flutuante."));
});
watchShape(tileMe, tileMe.querySelector("video"));
watchShape(tilePeer, tilePeer.querySelector("video"));
watchShape(myStream, myStreamVideo);
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

// ---------- início ----------

document.querySelectorAll(".hero-potato, .potato-mini").forEach((potato) => potato.addEventListener("click", () => {
  fx.squish(potato.querySelector("svg") || potato);
  sound.play("whoosh");
}));

renderThemes();
applyTheme(store.get("localStorage", THEME_KEY));
applyWallpaper(store.get("localStorage", WALL_KEY));
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
