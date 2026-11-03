import { sound } from "./sound.js";
import { fx, effectFor, motion } from "./fx.js";
import { io, apiUrl } from "./realtime.js";
import { createPlayer } from "./music.js";
import { createWatchPlayer } from "./watch.js";
import { nativeScreenAvailable, nativeScreenAudioAvailable, startNativeScreen, stopNativeScreen } from "./native-screen.js";
import { updateRemotePip } from "./remote-pip.js";
import { createRtcRecovery } from "./rtc-recovery.js";
import { createRtcConfigLoader } from "./rtc-config.js";
import { createEmojiPicker } from "./emoji-picker.js";

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
const loadNewer = $("#load-newer");
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
const ROOM_KEY = "potato.room";
const REACTIONS = ["❤️", "😂", "😮", "😢", "👍", "🔥"];
const loadRtcConfig = createRtcConfigLoader(apiUrl("rtc-config"), () => socket?.auth.token || "");

// Quando o site roda dentro do painel lateral da extensão, conversa com ela via postMessage.
const parentOrigin = window.parent !== window ? (location.ancestorOrigins?.[0] || "") : "";
const inExtension = parentOrigin.startsWith("chrome-extension://");
// No app do Android: o próprio app deixa o site entre a barra de status e a de navegação (styles.css zera as margens
// de tela), e os lembretes e as novidades com o app fechado vêm dele (notificação com responder).
const inAndroid = /PotatoChatAndroid/.test(navigator.userAgent);
document.documentElement.classList.toggle("in-android", inAndroid);

let socket = null;
let me = "";
let list = [];
const byId = new Map();
// Partidas dos joguinhos que valem mesmo fora do trecho carregado (as que ainda estão rolando vêm com o histórico): a
// mesinha e os avisos continuam funcionando depois de o chat recarregar só as mensagens mais novas.
const games = new Map();
const pending = new Map();
let reads = {};
let presenceList = [];
// A pessoa da conversa aberta.
let peerName = "";
// A conversa aberta (id; fica guardada para a próxima vez), as conversas (os contatos: com quem, a última mensagem e
// quantas não foram lidas) e se esta pessoa é do casal (o Nosso cantinho é só dele).
let room = "";
let rooms = [];
let couple = false;
let peerWasOnline = null;
// "" (nada), "text" (digitando) ou "audio" (gravando um áudio).
let peerTyping = "";
let replyTo = null;
let hasMore = false;
let loadingOlder = false;
// Lendo um trecho antigo (pesquisa, "ir para um dia" ou resposta antiga): list tem só esse trecho, e a conversa de agora
// fica guardada aqui ({ list, hasMore }), recebendo as mensagens novas. Descer até o fim (ou o botão de descer) volta.
let latest = null;
let loadingNewer = false;
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

// Guarda de quem é (data-avatar) para a foto entrar depois: ao abrir, a conversa chega antes da lista com as fotos.
// A letra fica num nó de texto próprio, o primeiro; o resto (o visto do voto, a coroa do placar) continua lá.
function paintAvatar(node, name) {
  const photo = name ? avatars.get(name) : "";
  node.dataset.avatar = name || "";
  const letter = photo ? "" : name ? name.trim()[0].toUpperCase() : "?";
  if (node.firstChild?.nodeType === Node.TEXT_NODE) node.firstChild.nodeValue = letter;
  else node.prepend(letter);
  node.style.setProperty("--hue", name ? hue(name) : 40);
  node.style.backgroundImage = photo ? `url("${photo}")` : "";
  node.classList.toggle("has-photo", Boolean(photo));
}

// Avatares fora da lista de pessoas (abas, barra lateral, perfil e chamada).
function repaintAvatars() {
  for (const node of [$("#side-avatar"), $("#profile-face")]) paintAvatar(node, me);
  // E as que já estavam na tela: cartões dos jogos, placar, jogadores da mesinha…
  document.querySelectorAll("[data-avatar]").forEach((node) => paintAvatar(node, node.dataset.avatar));
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
  : message.game ? GAME_NAMES[message.game.type] || "Joguinho"
  : message.call ? callLabel(message.call)
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

// Primeiro acesso: as duas primeiras pessoas escolhem nome e senha, que ficam valendo para sempre. Depois, conta nova só
// com um convite (o link #convite=código): quem abre cria a conta, ou entra na dela, e vira contato de quem convidou.
const loginHint = $("#login-hint");
let openSeats = 0;
let creating = false;
let inviteCode = "";
let inviteFrom = "";

const inviteInHash = () => location.hash.match(/^#convite=([a-z0-9]+)/i)?.[1] || "";

function paintHint() {
  const text = creating
    ? `Primeiro acesso de ${creating}: repita a senha para criar sua conta. Depois disso, nome e senha não mudam mais.`
    : inviteFrom ? `${inviteFrom} te convidou! Escolha seu nome e uma senha para criar sua conta (ou entre na sua, se já tiver).`
    : inviteCode ? "Esse convite não vale mais (já foi usado ou passou de 7 dias). Peça outro para quem te convidou."
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
  inviteCode = inviteInHash();
  try {
    const response = await fetch(apiUrl("welcome") + (inviteCode ? `&convite=${encodeURIComponent(inviteCode)}` : ""), { cache: "no-store" });
    if (response.ok) {
      const result = await response.json();
      openSeats = result.open || 0;
      inviteFrom = result.invite?.from || "";
    }
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
    if (inviteFrom) body.invite = inviteCode;
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
    // Entrou pelo convite: já usado; a conversa com quem convidou é a que abre.
    if (result.room) {
      room = result.room;
      history.replaceState(null, "", location.pathname + location.search);
    }
    startSession(result, { animate: true });
    if (result.created) setTimeout(() => toast("Conta criada! Escolha sua foto e o tema no seu perfil.", "ok"), 900);
    else if (result.room && inviteFrom) setTimeout(() => toast(`Pronto! Agora você e ${inviteFrom} podem conversar.`, "ok"), 900);
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
  callFromHash();
  room ||= store.get("localStorage", ROOM_KEY) || "";
  store.set("localStorage", SESSION_KEY, { token, name });
  tellParent({ type: "potato:session", token, name });
  connect(token, animate);
  openFromHash();
  // Já com a conta, abriu o link de um convite: aceita assim que conectar.
  pendingInvite = inviteInHash();
  if (pendingInvite) history.replaceState(null, "", location.pathname + location.search);
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
  socket = io({ auth: { token, client: "web", room }, reconnectionDelayMax: 8000 });

  socket.on("connect", () => {
    if (!chatShown) showChat(animate);
    else if (!netBanner.classList.contains("hidden")) toast("Conectado de novo", "ok");
    fx.hide(netBanner, { y: -10 });
    socket.emit("visibility", !document.hidden);
    for (const message of pending.values()) deliver(message);
    if (call?.recovery) call.recovery.request();
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

  socket.on("history", applyHistory);

  socket.on("message", (message) => receive(message, true));
  socket.on("message:update", updateMessage);
  socket.on("seen", ({ name, id, at, room: where }) => {
    // Lida em outro aparelho seu: a conversa sai das não lidas.
    if (name === me) markRoomRead(where);
    if (where && where !== room) return;
    reads[name] = { id, at };
    if (name !== me) markRead(id, at);
    refreshStatuses();
  });
  socket.on("presence", updatePresence);
  socket.on("typing", ({ active, audio, room: where }) => {
    if (!where || where === room) setPeerTyping(active, audio);
  });
  // Contato novo (um convite aceito, aqui ou do outro lado).
  socket.on("rooms", refreshRooms);
  // Tema trocado em outra aba ou aparelho da mesma pessoa.
  // Papel de parede trocado em outra aba ou aparelho da mesma pessoa.
  socket.on("wallpaper", ({ wallpaper: next }) => applyWallpaper(next));
  // Bot de música e Watch Party: cada conversa tem os seus; o de outra conversa não mexe nesta.
  socket.on("music", ({ state, action, room: where }) => {
    if (where && where !== room) return;
    applyMusic(state);
    musicNotice(action);
  });
  socket.on("watch", ({ state, action, room: where }) => {
    if (where && where !== room) return;
    applyWatch(state);
    watchNotice(action);
  });
  // Nosso cantinho: o dia de cada um, agenda, sonhos, cartinhas.
  socket.on("us", applyUs);

  socket.on("theme", ({ theme }) => {
    themeSaved = true;
    applyTheme(theme);
  });

  socket.on("call-ring", ring);
  socket.on("call-update", receiveCallUpdate);
  socket.on("call-replaced", ({ id }) => {
    if (call?.id !== id) return;
    resumeSuppressed.add(id);
    store.set("sessionStorage", "potato.replacedCalls", [...resumeSuppressed]);
    teardown(false);
    toast("A chamada foi aberta em outro aparelho ou aba.");
  });
  socket.on("call-accepted", sendOffer);
  socket.on("webrtc-offer", receiveOffer);
  socket.on("webrtc-answer", receiveAnswer);
  socket.on("webrtc-ice", receiveIce);
  socket.on("webrtc-restart", (message) => {
    if (call && message.from === call.peerId && message.id === call.id && (message.generation ?? 0) === call.generation) call.recovery?.receive(message);
  });
  socket.on("call-state", receiveCallState);
  socket.on("call-ended", callEnded);
  // Atendida em outro aparelho seu: aqui para de tocar.
  socket.on("call-handled", ({ id } = {}) => {
    if (call?.role === "callee" && !call.accepted && (!id || id === call.id)) teardown(false);
  });
}

// O histórico que chega ao conectar (e a cada reconexão, ou ao abrir outra conversa): a conversa aberta (as mensagens,
// as leituras, a música, a Watch Party e as partidas dela), a lista de conversas, as chamadas abertas e o resto.
function applyHistory(payload) {
  const switched = (payload.room || "") !== room;
  room = payload.room || "";
  if (socket) socket.auth.room = room;
  store.set("localStorage", ROOM_KEY, room);
  rooms = payload.rooms || [];
  couple = Boolean(payload.couple);
  peerName = payload.peer || "";
  chatView.classList.toggle("no-couple", !couple);
  if (switched) leaveRoom();
  // Reconectou lendo um trecho antigo: ele continua na tela, e a conversa de agora é trocada pela que chegou.
  if (latest) latest = { list: payload.items, hasMore: payload.hasMore };
  else {
    list = payload.items;
    hasMore = payload.hasMore;
  }
  // As partidas: as que estão rolando (vêm com o histórico) e a aberta na mesinha, que não pode sumir no meio do jogo
  // (se ela não veio, o servidor diz como ela está agora).
  const open = table.id ? byId.get(table.id) : null;
  games.clear();
  for (const message of payload.games || []) games.set(message.id, message);
  if (open && !games.has(open.id) && !payload.items.some((message) => message.id === open.id)) {
    games.set(open.id, open);
    refreshGame(open.id);
  }
  indexMessages();
  for (const clientId of pending.keys()) if (payload.items.some((message) => message.clientId === clientId)) pending.delete(clientId);
  reads = payload.reads || {};
  gifKey = payload.gifKey || "";
  fileMax = payload.fileMax || 0;
  watchChunk = payload.watchChunk || 0;
  transcribeOn = Boolean(payload.transcribe);
  syncTheme(payload.theme);
  applyWallpaper(payload.wallpaper);
  applyMusic(payload.music, true);
  applyWatch(payload.watch, true, false);
  renderAll();
  if (latest) fx.show(jump, { scale: 0.6 });
  else scrollToLatest();
  markSeen();
  if (couple) loadUs();
  if (table.id) paintTable();
  updatePresence(presenceList);
  syncCall(payload.calls || []);
  // Ligar de volta pela notificação (o app acabou de abrir) e o convite do link: a lista de quem está nas conversas
  // chega logo depois.
  setTimeout(() => {
    runPendingDial();
    if (pendingInvite) acceptInvite(pendingInvite);
    pendingInvite = "";
  });
}

// Saindo da conversa (para outra): o que era só dela fecha.
function leaveRoom() {
  latest = null;
  clearReply();
  closeSearch();
  search.run += 1;
  setPeerTyping(false);
  unseenBelow = 0;
  jumpCount.classList.add("hidden");
  unreadAway = 0;
  peerWasOnline = null;
  if (table.id) closeTable();
}

// ---------- mensagens ----------

function receive(message, live) {
  if (message.room && message.room !== room) return otherRoom(message, live);
  if (byId.has(message.id)) return;
  byId.set(message.id, message);
  if (message.game) games.set(message.id, message);
  const local = message.clientId && pending.get(message.clientId);
  const mine = message.sender === me;

  if (latest) {
    // Lendo um trecho antigo: a mensagem fica na conversa de agora (o botão de descer conta quantas chegaram).
    latest.list.push(message);
    if (local) pending.delete(message.clientId);
  } else if (local) {
    list.push(message);
    pending.delete(message.clientId);
    // A foto continua vindo da cópia local: trocar pelo endereço do servidor faria a imagem piscar.
    if (local.file?.preview && message.file) message.file.preview = local.file.preview;
    const node = messagesEl.querySelector(`[data-client-id="${message.clientId}"]`);
    if (node) {
      fill(node, message);
      fx.sent(node);
    } else appendNode(message, true);
  } else {
    list.push(message);
    messagesEl.querySelector(".empty")?.remove();
    appendNode(message, live);
  }
  if (!latest) refreshStatuses();
  noteInRooms(message, false);
  if (message.game) paintUsBadge();
  if (message.game && tab === "us" && us.section === "jogos") paintGames();
  if (!live) return;

  if (!mine) {
    setPeerTyping(false);
    // A chamada tem o próprio aviso: toca e abre a janela de atender.
    if (!message.call) {
      sound.play("receive");
      notify(message);
    }
    if (tab !== "chat") bumpUnread();
    if (message.game) toast(`${message.sender} te chamou para jogar: ${GAME_NAMES[message.game.type]}`, "info", "dice");
  } else if (!local) {
    sound.play("tap");
  }

  if (!latest && (mine || nearBottom())) scrollToLatest(true);
  else if (!mine) {
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

// A última mensagem de uma conversa (e as não lidas, unread) na lista de conversas, que fica na ordem das mais recentes.
function noteInRooms(message, unread) {
  const entry = rooms.find((item) => item.id === message.room);
  if (!entry || entry.last?.id === message.id) return Boolean(entry);
  entry.last = { id: message.id, sender: message.sender, text: previewText(message), at: message.createdAt, deleted: false };
  if (unread) entry.unread += 1;
  rooms.sort((a, b) => String(b.last?.at || b.since).localeCompare(String(a.last?.at || a.since)));
  paintRooms();
  return true;
}

// Mensagem de outra conversa: a lista de conversas mostra e, se for da outra pessoa, avisa (som e um aviso na tela,
// ou a notificação com a página escondida).
function otherRoom(message, live) {
  const mine = message.sender === me;
  if (!noteInRooms(message, !mine)) return refreshRooms();
  paintMenuDot();
  if (!live || mine || message.call) return;
  sound.play("receive");
  if (document.hidden) notify(message);
  else toast(`${message.sender}: ${(previewText(message) || "Nova mensagem").slice(0, 90)}`, "info", "message");
}

function updateMessage(message) {
  if (message.room && message.room !== room) {
    const entry = rooms.find((item) => item.id === message.room);
    if (entry?.last?.id === message.id) {
      Object.assign(entry.last, { text: message.deleted ? "" : previewText(message), deleted: message.deleted });
      paintRooms();
    }
    return;
  }
  const previous = byId.get(message.id);
  // Partida fora do trecho carregado (a resposta da sua jogada, por exemplo): passa a valer aqui também.
  if (!previous && !message.game) return;
  if (previous && message.deleted && playback.key === voiceKey(previous)) stopVoice();
  for (const items of [list, latest?.list]) {
    const index = items ? items.findIndex((item) => item.id === message.id) : -1;
    if (index >= 0) items[index] = message;
  }
  byId.set(message.id, message);
  if (message.game && !message.deleted) games.set(message.id, message);
  else games.delete(message.id);
  paintInfo();
  // Jogos: avisos (sua vez, quem ganhou) e a mesinha aberta acompanha a jogada (e fecha se a partida for apagada).
  if (message.game) gameNotice(previous?.game, message.game, message);
  // Uma partida acabou (ou uma que já tinha acabado foi apagada): o placar muda.
  if (Boolean(message.game?.winner) !== Boolean(previous?.game?.winner)) loadScore();
  if (table.id === message.id) paintTable();
  if (message.game || previous?.game) paintUsBadge();
  if ((message.game || previous?.game) && tab === "us" && us.section === "jogos") paintGames();
  const node = messagesEl.querySelector(`[data-id="${message.id}"]`);
  if (!node || !previous) return;
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

// Mensagens seguidas da mesma pessoa ficam juntinhas. Os cartões de música, de jogo e de chamada (no meio da conversa)
// não entram: eles têm sempre o mesmo espaço em volta.
const isCard = (message) => Boolean(message.music || message.game || message.call);
function isGrouped(previous, message) {
  return Boolean(previous) && !isCard(previous) && !isCard(message) && previous.sender === message.sender && !needsDay(previous, message)
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
  // As que estão saindo agora só aparecem na conversa de agora.
  const waiting = latest ? [] : [...pending.values()].filter((message) => message.room === room);
  for (const message of [...list, ...waiting]) {
    if (needsDay(previous, message)) fragment.append(dayNode(message.createdAt));
    fragment.append(buildNode(message, previous));
    previous = message;
  }
  messagesEl.append(fragment);
  if (!list.length && !waiting.length) {
    const empty = el("div", "empty");
    const text = !room ? "Mande o link para a outra pessoa criar a conta dela. A conversa começa aqui."
      : rooms.find((entry) => entry.id === room)?.couple ? "Nosso chat começa aqui. Manda um oi!" : `A conversa com ${peerName} começa aqui. Manda um oi!`;
    empty.append(potatoArt(), el("span", "", text));
    messagesEl.append(empty);
  }
  loadMore.classList.toggle("hidden", !hasMore);
  messagesEl.append(loadNewer);
  loadNewer.classList.toggle("hidden", !latest);
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
  } else if (message.game && !message.deleted) {
    article.classList.add("game-note");
    bubble.classList.add("game-card");
    bubble.append(gameCard(message));
  } else if (message.call && !message.deleted) {
    article.classList.add("call-row");
    bubble.classList.add("call-card");
    bubble.append(callCard(message));
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
      const info = el("button", "tool");
      info.type = "button";
      info.dataset.action = "info";
      info.title = "Dados da mensagem";
      info.append(icon("info"));
      const remove = el("button", "tool danger-tool");
      remove.type = "button";
      remove.dataset.action = "delete";
      remove.title = "Apagar para todos";
      remove.append(icon("trash"));
      tools.append(info);
      // Cartões de música (os comandos), jogos e chamadas ficam: só mensagem escrita, foto, arquivo e áudio se apagam.
      if (!isCard(message)) tools.append(remove);
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

// Lida: a mensagem diz (vem do servidor e muda com o "seen") ou, por garantia, está antes da última que a outra pessoa leu.
const isRead = (message, readIndex = peerReadIndex()) => Boolean(message.read) || list.indexOf(message) <= readIndex;

function paintStatus(article, readIndex = peerReadIndex()) {
  const holder = article.querySelector(".status");
  const message = article.msg;
  if (!holder || !message) return;
  let state = "sent";
  if (!message.id) state = message.status === "failed" ? "failed" : "pending";
  else if (isRead(message, readIndex)) state = "read";
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

// A outra pessoa leu até a mensagem id: as minhas até ali ficam lidas, com a hora (para os dados da mensagem).
function markRead(id, at) {
  const upTo = (items) => items.findIndex((message) => message.id === id);
  for (const items of [list, latest?.list]) {
    if (!items) continue;
    let last = upTo(items);
    // O trecho antigo aberto vem antes da conversa de agora: se ela leu algo de agora, leu o trecho inteiro.
    if (last < 0 && items === list && latest && upTo(latest.list) >= 0) last = items.length - 1;
    for (const message of items.slice(0, last + 1)) {
      if (message.sender === me && !message.read) Object.assign(message, { read: true, readAt: at });
    }
  }
  paintInfo();
}

// ---- dados da mensagem: quando foi enviada e quando a outra pessoa leu ----

// "hoje às 14:03", "ontem às 9:10", "3 de outubro às 22:40".
function whenLabel(iso) {
  const day = dayLabel(iso);
  return `${day === "Hoje" || day === "Ontem" ? day.toLowerCase() : day} às ${time(iso)}`;
}

function infoField(message) {
  const read = isRead(message);
  const reader = peerName || "a outra pessoa";
  const readValue = !read ? "Ainda não leu" : message.readAt ? whenLabel(message.readAt) : "Antes de o chat guardar a hora da leitura";
  return {
    name: "info",
    type: "facts",
    info: message.id,
    quote: message.deleted ? "Mensagem apagada" : previewText(message),
    rows: [
      ["check-check", `Lida por ${reader}`, readValue, read ? "is-read" : "is-waiting"],
      ["check", "Enviada", whenLabel(message.createdAt), ""]
    ]
  };
}

function openInfo(message) {
  openSheet({ title: "Dados da mensagem", icon: "info", submit: null, cancel: "Fechar", fields: [infoField(message)] });
}

// Com os dados abertos, a leitura (ou a mensagem apagada) aparece na hora.
function paintInfo() {
  const message = byId.get(sheetState?.fields[0]?.info);
  if (!message) return;
  sheetState.fields = [infoField(message)];
  $("#sheet-body").replaceChildren(fieldNode(sheetState.fields[0]));
}

// Mensagem de texto, de GIF (gif = { url, width, height, title }, sem texto) ou com foto/arquivo
// (upload = o arquivo escolhido, que sobe antes da mensagem; ver uploadFile). Áudio gravado no chat
// leva upload.voice = { duration, peaks } (ver stopRecording).
function send(text, gif = null, upload = null) {
  const clean = gif || upload ? "" : text.trim();
  if ((!clean && !gif && !upload) || !me) return;
  backToLatest();
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
    status: "pending",
    room
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
  // Vai para a conversa em que foi escrita, mesmo que outra esteja aberta agora (o reenvio depois de cair a conexão).
  const open = socket.auth.room;
  socket.auth.room = message.room;
  socket.timeout(10000).emit("message", { text: message.text, gif: message.gif, file: message.upload?.key, voice: message.file?.voice, clientId: message.clientId, replyTo: message.replyTo?.id }, (error, result) => {
    if (!pending.has(message.clientId)) return;
    if (!error && result?.ok && result.message.room !== room) pending.delete(message.clientId);
    if (!error && result?.ok) return receive(result.message, true);
    message.status = "failed";
    if (node()) paintStatus(node());
    if (result?.error) toast(result.error, "error");
    sound.play("error");
  });
  socket.auth.room = open;
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

// Celular: tocar no enviar não tira o foco do campo. Assim o teclado continua aberto,
// a tela não pula para baixo e o primeiro toque já envia.
messageForm.addEventListener("mousedown", (event) => {
  if (document.activeElement === messageInput && event.target.closest(".send")) event.preventDefault();
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

const emojiPicker = createEmojiPicker({
  button: $("#emoji-button"), input: messageInput,
  beforeOpen: () => { closeGifs(); closeAttach(); commandMenu.classList.add("hidden"); },
  onLimit: () => toast("A mensagem chegou ao limite de caracteres.")
});

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
  if (event.target.closest("#load-newer")) return loadNewerPage();
  if (!message) return;

  const status = event.target.closest(".status");
  if (status?.dataset.state === "failed") return deliver(message);

  const quote = event.target.closest(".reply-quote");
  if (quote) return focusMessage(quote.dataset.target);
  const voiceAction = event.target.closest("[data-voice]")?.dataset.voice;
  if (voiceAction && message.file?.voice) {
    if (voiceAction === "text") return toggleTranscript(message);
    return voiceAction === "transcribe" ? transcribeVoice(message) : toggleVoice(message);
  }
  if (event.target.closest("[data-view]")) return openViewer(message.file);
  const musicAction = event.target.closest("[data-music-action]");
  if (musicAction && message.music) return cardAction(musicAction.dataset.musicAction, message.music);
  const gameAction = event.target.closest("[data-game]");
  if (gameAction && message.game) return playGame(message, gameAction.dataset.game, gameAction.dataset.value, article);
  const callAction = event.target.closest("[data-call-action]");
  if (callAction && message.call) return callCardAction(callAction.dataset.callAction, message.call);
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
  if (action === "info") {
    closeTools();
    return openInfo(message);
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
// em vídeo e áudio o toque é dos controles, para arrastar a barra sem abrir o menu nem responder; nos jogos, das jogadas).
function actionableMessage(target) {
  if (!target.closest(".bubble") || target.closest("a, video, audio, .voice-ctl, .game-ctl")) return null;
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

// Vai até a mensagem (e marca o termo pesquisado nela). Se ela não está carregada, abre o trecho em volta dela.
function focusMessage(id, query = "", smooth = true) {
  const node = messagesEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (!node) return openAt({ id, query });
  showMessage(node, query, smooth);
}

function showMessage(node, query, smooth) {
  messagesEl.querySelectorAll("mark.hit").forEach((mark) => mark.replaceWith(...mark.childNodes));
  if (query) markHits(node, query);
  node.scrollIntoView({ behavior: smooth && motion() ? "smooth" : "auto", block: "center" });
  node.classList.remove("flash");
  void node.offsetWidth;
  node.classList.add("flash");
}

function indexMessages() {
  byId.clear();
  for (const message of games.values()) byId.set(message.id, message);
  for (const message of [...list, ...(latest?.list || [])]) {
    byId.set(message.id, message);
    if (message.game && !message.deleted) games.set(message.id, message);
  }
}

// Tudo o que está carregado (o trecho antigo aberto, a conversa de agora e as partidas que estão rolando).
const loaded = () => joinMessages(list, latest?.list || [], [...games.values()]);

// Junta trechos da conversa sem repetir, na ordem em que as mensagens foram enviadas.
function joinMessages(...parts) {
  const seen = new Set();
  return parts.flat().filter((message) => !seen.has(message.id) && seen.add(message.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// Abre a conversa na mensagem id ou na primeira desde from (começo de um dia, em ISO). Se o trecho encosta na conversa
// de agora, vira uma conversa só; senão, ela espera no botão de descer.
async function openAt({ id = "", from = "", query = "" }) {
  if (id && latest?.list.some((message) => message.id === id)) {
    backToLatest();
    return focusMessage(id, query, false);
  }
  if (!socket?.connected) return toast("Sem conexão agora.");
  const at = room;
  const result = await new Promise((resolve) => socket.timeout(8000).emit("history:around", { id, from }, (error, value) => resolve(error ? null : value)));
  if (room !== at) return;
  if (!result?.ok) return toast(result?.error || "Não deu para abrir esse trecho agora.", "error");
  const now = latest || { list, hasMore };
  const known = new Set(now.list.map((message) => message.id));
  const older = result.items.filter((message) => !known.has(message.id));
  if (!result.hasNewer || older.length < result.items.length) {
    list = joinMessages(result.items, now.list);
    hasMore = older.length ? result.hasMore : now.hasMore;
    latest = null;
  } else {
    latest = now;
    list = result.items;
    hasMore = result.hasMore;
  }
  indexMessages();
  renderAll();
  if (latest) fx.show(jump, { scale: 0.6 });
  const node = messagesEl.querySelector(`[data-id="${CSS.escape(result.target)}"]`);
  if (node) showMessage(node, query, false);
}

// Descendo num trecho antigo: a próxima página; quando ela chega na conversa de agora, as duas viram uma só.
function loadNewerPage() {
  if (!latest || loadingNewer || !socket?.connected || !list.length) return;
  loadingNewer = true;
  loadNewer.textContent = "Carregando…";
  const at = room;
  socket.timeout(8000).emit("history:after", { after: list[list.length - 1].id }, (error, result) => {
    loadingNewer = false;
    loadNewer.textContent = "Carregar mensagens seguintes";
    if (error || !result || !latest || room !== at) return;
    const top = messagesEl.scrollTop;
    const meets = !result.hasNewer || result.items.some((message) => latest.list.some((item) => item.id === message.id));
    list = joinMessages(list, result.items, meets ? latest.list : []);
    if (meets) latest = null;
    indexMessages();
    renderAll();
    messagesEl.scrollTop = top;
  });
}

// Volta do trecho antigo para a conversa de agora, já no fim.
function backToLatest() {
  if (!latest) return;
  ({ list, hasMore } = latest);
  latest = null;
  indexMessages();
  renderAll();
  messagesEl.scrollTop = messagesEl.scrollHeight;
  unseenBelow = 0;
  jumpCount.classList.add("hidden");
  markSeen();
}

function loadOlder() {
  if (!hasMore || loadingOlder || !socket?.connected || !list.length) return;
  loadingOlder = true;
  loadMore.textContent = "Carregando…";
  const at = room;
  socket.timeout(8000).emit("history:before", { before: list[0].id }, (error, result) => {
    loadingOlder = false;
    loadMore.textContent = "Carregar mensagens anteriores";
    if (error || !result || room !== at) return;
    const previousHeight = messagesEl.scrollHeight;
    const known = new Set(list.map((message) => message.id));
    list = [...result.items.filter((message) => !known.has(message.id)), ...list];
    hasMore = result.hasMore;
    indexMessages();
    renderAll();
    messagesEl.scrollTop += messagesEl.scrollHeight - previousHeight;
  });
}

// ---------- mensagens de voz ----------

// Gravar: com o campo vazio, o microfone fica no lugar do enviar. Um toque grava sem segurar (depois é só enviar
// ou apagar, ou parar para ouvir antes); segurando, a pessoa fala e solta para enviar, e deslizar para a esquerda
// cancela.
// Ouvir: um áudio por vez, com forma de onda (tocar ou arrastar nela pula) e, no fim, o próximo áudio seguido da
// mesma pessoa. Sem escolha de velocidade, como no Discord.
const micButton = $("#mic-button");
const recorderEl = $("#recorder");
const recTime = $("#rec-time");
const recWave = $("#rec-wave");
const recSlide = $("#rec-slide");
const recLock = $("#rec-lock");
const recStop = $("#rec-stop");
// MP4/AAC primeiro: toca em qualquer aparelho, inclusive no iPhone, que nem sempre toca o WebM/Opus.
const VOICE_TYPES = ["audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"];
const VOICE_EXTENSION = { mp4: "m4a", webm: "webm", ogg: "ogg" };
const VOICE_MIN = 1;
const VOICE_MAX = 15 * 60;
const VOICE_PEAKS = 40;
// 64 kbps: voz limpa no AAC e no Opus (15 minutos dão uns 7 MB).
const VOICE_BITRATE = 64000;
// Segurar o microfone menos que isso é um toque (grava sem segurar). Segurando, deslizar CANCEL_SLIDE px para a
// esquerda cancela e LOCK_SLIDE px para cima trava (continua gravando sem o dedo).
const HOLD_MS = 350;
const CANCEL_SLIDE = 110;
const LOCK_SLIDE = 80;
const NOISE_KEY = "potato.noise";
const canRecord = Boolean(window.MediaRecorder && navigator.mediaDevices?.getUserMedia);
if (!canRecord) messageForm.classList.add("no-voice");

// Gravação em andamento (ou esperando a permissão do microfone, ou parada esperando enviar: mode "review");
// null = nenhuma.
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
  $("#emoji-button").disabled = Boolean(rec);
  if (rec) emojiPicker.close();
  const review = rec?.mode === "review";
  const locked = rec?.mode === "locked" || review;
  const playing = Boolean(rec?.audio && !rec.audio.paused);
  messageForm.classList.toggle("recording", Boolean(rec));
  messageForm.classList.toggle("rec-locked", locked);
  messageForm.classList.toggle("rec-review", review);
  messageForm.classList.toggle("rec-playing", playing);
  micButton.setAttribute("aria-label", locked ? "Enviar áudio" : "Gravar áudio");
  micButton.title = locked ? "Enviar áudio" : "Gravar áudio: toque para gravar, ou segure e solte para enviar";
  const stopLabel = !review ? "Parar a gravação" : playing ? "Pausar" : "Ouvir o áudio";
  recStop.setAttribute("aria-label", stopLabel);
  recStop.title = review ? stopLabel : "Parar para ouvir antes de enviar";
  recSlide.style.transform = recSlide.style.opacity = recLock.style.transform = "";
  // A cor da onda muda com a faixa (segurando ou não): o canvas lê de novo no próximo quadro.
  if (rec) rec.waveColor = "";
  recLock.classList.remove("ready");
}

// Redução de ruído (opcional, no Perfil; vem desligada): o microfone passa por um corte dos graves (ronco abaixo de
// 80 Hz) e pelo RNNoise, uma rede neural de voz que roda no próprio aparelho (vendor/noise), antes de ir para o
// gravador. Sem AudioWorklet (ou se algo falhar), grava direto.
const noiseOn = () => store.get("localStorage", NOISE_KEY) === true;
let noiseKit = null;

function loadNoiseKit() {
  noiseKit ||= import("./vendor/noise/index.js")
    .then(async ({ RnnoiseWorkletNode, loadRnnoise }) => ({
      RnnoiseWorkletNode,
      wasm: await loadRnnoise({ url: new URL("vendor/noise/rnnoise.wasm", document.baseURI).href, simdUrl: new URL("vendor/noise/rnnoise_simd.wasm", document.baseURI).href })
    }))
    .catch((error) => {
      noiseKit = null;
      throw error;
    });
  return noiseKit;
}

async function cleanMic(stream, context) {
  const { RnnoiseWorkletNode, wasm } = await loadNoiseKit();
  await context.audioWorklet.addModule(new URL("vendor/noise/rnnoise-worklet.js", document.baseURI).href);
  // Um canal só: o RNNoise limpa um canal, e um segundo sairia mudo.
  const lowCut = new BiquadFilterNode(context, { type: "highpass", frequency: 80, channelCount: 1, channelCountMode: "explicit" });
  const denoise = new RnnoiseWorkletNode(context, { wasmBinary: wasm, maxChannels: 1 });
  const output = context.createMediaStreamDestination();
  output.channelCount = 1;
  context.createMediaStreamSource(stream).connect(lowCut).connect(denoise).connect(output);
  await context.resume();
  return { stream: output.stream, denoise };
}

// Solta o microfone e desmonta a redução de ruído.
function releaseMicStream(session) {
  session.stream?.getTracks().forEach((track) => track.stop());
  session.denoise?.destroy();
  session.context?.close().catch(() => {});
}

// A onda ao vivo, desenhada num canvas a cada quadro: as barras deslizam sem pulos, e a da ponta (a dos últimos
// 100 ms) cresce com a voz na hora. Junto, o brilho em volta da faixa (e do microfone, segurando) segue a voz.
const recCanvas = el("canvas", "rec-canvas");
const recPill = $(".rec-pill");
const REC_STEP = 5;
const REC_BAR = 3;

function animateRecording(session) {
  if (rec !== session || session.mode === "review") return;
  session.draw = requestAnimationFrame(() => animateRecording(session));
  if (!session.started) return;
  const now = performance.now();
  const level = voiceLevel(session.meter());
  session.live = Math.max(level, (session.live || 0) * 0.82);
  const glow = session.live.toFixed(2);
  recPill.style.setProperty("--level", glow);
  micButton.style.setProperty("--level", glow);
  const width = recWave.clientWidth;
  const height = recWave.clientHeight;
  // Segurando o microfone, a onda não aparece.
  if (!width || !height) return;
  const ratio = devicePixelRatio || 1;
  if (recCanvas.width !== Math.round(width * ratio) || recCanvas.height !== Math.round(height * ratio)) {
    recCanvas.width = Math.round(width * ratio);
    recCanvas.height = Math.round(height * ratio);
  }
  const context = recCanvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = session.waveColor ||= getComputedStyle(recWave).color;
  // A barra da ponta entra pela direita durante os seus 100 ms; quando vira barra de verdade, já está no lugar.
  const progress = Math.min(1, (now - session.lastBar) / 100);
  const bar = (x, value) => {
    const size = Math.max(REC_BAR, value * height);
    context.beginPath();
    if (context.roundRect) context.roundRect(x, (height - size) / 2, REC_BAR, size, REC_BAR / 2);
    else context.rect(x, (height - size) / 2, REC_BAR, size);
    context.fill();
  };
  const edge = width - progress * REC_STEP;
  bar(edge, Math.max(session.peak, level));
  const levels = session.levels;
  for (let index = 0; index < levels.length; index += 1) {
    const x = edge - REC_STEP * (index + 1);
    if (x < -REC_STEP) break;
    bar(x, levels[levels.length - 1 - index]);
  }
}

function stopRecordingGlow(session) {
  cancelAnimationFrame(session.draw);
  recPill.style.removeProperty("--level");
  micButton.style.removeProperty("--level");
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
  recWave.replaceChildren(recCanvas);
  recCanvas.getContext("2d").clearRect(0, 0, recCanvas.width, recCanvas.height);
  paintRecorder();
  fx.show(recorderEl, { x: 24 });
  if (mode === "locked") fx.recorder(messageForm);
  sound.play("record");
  navigator.vibrate?.(15);
  // O contexto de áudio da redução de ruído nasce ainda no toque: criado depois, o navegador pode deixá-lo parado,
  // e o áudio sairia mudo. A redução começa a baixar junto com o pedido do microfone.
  const denoising = noiseOn() && Boolean(window.AudioWorkletNode);
  if (denoising) {
    session.context = new AudioContext({ sampleRate: 48000 });
    loadNoiseKit().catch(() => {});
  }
  try {
    // O microfone como ele ouve, igual a um gravador de voz (e ao WhatsApp). Com o cancelamento de eco, o celular
    // grava no modo de chamada (som abafado, de telefone), e os filtros do navegador picotam a voz; eles ficam só
    // para as chamadas.
    session.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
  } catch (error) {
    releaseMicStream(session);
    if (rec === session) stopRecording(false);
    toast(inExtension ? "O painel lateral não consegue usar o microfone. Abra nosso chat numa aba (botão no topo do painel) para gravar áudio."
      : error.name === "NotAllowedError" ? "Libere o microfone para o chat nas configurações do navegador."
      : "Não deu para usar o microfone.", "error");
    sound.play("error");
    return;
  }
  let stream = session.stream;
  if (session.context) {
    try {
      const clean = await cleanMic(stream, session.context);
      stream = clean.stream;
      session.denoise = clean.denoise;
    } catch (error) {
      console.warn("Redução de ruído indisponível; gravando sem ela.", error);
      session.context.close().catch(() => {});
      session.context = null;
    }
  }
  // Cancelou enquanto o navegador pedia a permissão.
  if (rec !== session) return releaseMicStream(session);
  const type = VOICE_TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  try {
    session.recorder = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: VOICE_BITRATE } : { audioBitsPerSecond: VOICE_BITRATE });
  } catch {
    releaseMicStream(session);
    stopRecording(false);
    return toast("Este navegador não conseguiu gravar o áudio.", "error");
  }
  session.meter = sound.meter(stream);
  session.recorder.addEventListener("dataavailable", (event) => {
    if (!event.data.size) return;
    session.chunks.push(event.data);
    session.size += event.data.size;
    // Quase no maior arquivo que o servidor aceita: envia o que já tem.
    if (rec === session && session.mode !== "review" && fileMax && session.size > fileMax * 0.95) {
      toast("O áudio chegou ao tamanho máximo e foi enviado.");
      stopRecording(true);
    }
  });
  session.recorder.start(1000);
  session.started = session.lastBar = performance.now();
  session.timer = setInterval(() => recordTick(session), 30);
  animateRecording(session);
  // A outra pessoa vê "gravando áudio…" (o aviso some sozinho em 5 s, então vai de novo a cada 3 s).
  socket?.emit("typing", "audio");
  session.typing = setInterval(() => socket?.emit("typing", "audio"), 3000);
}

function recordTick(session) {
  const now = performance.now();
  session.peak = Math.max(session.peak, voiceLevel(session.meter()));
  // Uma barra a cada 100 ms (a onda é desenhada em animateRecording). Com a aba em segundo plano o timer atrasa: as
  // barras que faltam repetem o nível.
  if (now - session.lastBar >= 100) {
    for (; now - session.lastBar >= 100; session.lastBar += 100) session.levels.push(session.peak);
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
  fx.recorder(messageForm);
}

// Fecha o arquivo (o gravador entrega o último pedaço ao parar) e solta o microfone. Dá o áudio pronto
// ({ blob, seconds, voice }), ou null se o microfone ainda nem tinha sido liberado.
function closeRecorder(session) {
  if (session.closing) return session.closing;
  clearInterval(session.timer);
  clearInterval(session.typing);
  if (session.started) socket?.emit("typing", false);
  const recorder = session.recorder;
  // Ainda esperando a permissão: o startRecording solta o microfone quando ela chegar.
  if (!recorder) return Promise.resolve(null);
  const seconds = (performance.now() - session.started) / 1000;
  session.closing = new Promise((resolve) => {
    const finish = () => {
      releaseMicStream(session);
      const type = recorder.mimeType || session.chunks[0]?.type || "audio/webm";
      resolve({ blob: new File(session.chunks, voiceFileName(type), { type }), seconds, voice: { duration: Math.round(seconds * 10) / 10, peaks: voicePeaks(session.levels) } });
    };
    if (recorder.state === "inactive") return finish();
    recorder.addEventListener("stop", finish, { once: true });
    recorder.stop();
  });
  return session.closing;
}

function sendVoice(take) {
  if (!take) return;
  if (take.seconds < VOICE_MIN) return toast("Áudio curto demais.");
  if (fileMax && take.blob.size > fileMax) return toast(`O áudio ficou grande demais (máximo de ${formatSize(fileMax)}).`, "error");
  send("", null, { blob: take.blob, voice: take.voice });
}

// Para a gravação. keep = enviar (se tiver pelo menos VOICE_MIN segundos); senão, joga fora.
function stopRecording(keep) {
  const session = rec;
  if (!session) return;
  rec = null;
  micHold = null;
  if (session.audio) {
    cancelAnimationFrame(session.frame);
    session.audio.pause();
    URL.revokeObjectURL(session.audio.src);
  }
  stopRecordingGlow(session);
  // A faixa sai animada (para o enviar ou para a lixeira) e só depois o campo volta (se não começou outra gravação).
  fx.recorderOut(messageForm, keep, () => {
    if (rec) return;
    recorderEl.classList.add("hidden");
    paintRecorder();
  });
  closeRecorder(session).then((take) => {
    if (keep) sendVoice(take);
  });
}

// O quadradinho (gravando sem segurar): a gravação para, mas o áudio espera, para ouvir antes de enviar ou apagar.
// A faixa vira um tocador: o mesmo botão toca e pausa, e a onda inteira vai se pintando enquanto toca.
async function reviewRecording() {
  const session = rec;
  if (session?.mode !== "locked" || !session.recorder) return;
  session.mode = "review";
  stopRecordingGlow(session);
  paintRecorder();
  sound.play("tap");
  const take = await closeRecorder(session);
  if (rec !== session) return;
  if (take.seconds < VOICE_MIN) {
    toast("Áudio curto demais.");
    return stopRecording(false);
  }
  session.take = take;
  const audio = session.audio = new Audio(URL.createObjectURL(take.blob));
  const repaint = () => {
    if (rec !== session) return;
    paintPreview(session);
    paintRecorder();
  };
  audio.addEventListener("pause", repaint);
  audio.addEventListener("ended", repaint);
  recWave.replaceChildren(...take.voice.peaks.map((peak) => {
    const bar = el("i");
    bar.style.setProperty("--h", (peak / 100).toFixed(2));
    return bar;
  }));
  paintPreview(session);
  fx.recorderReview([...recWave.children], recStop.querySelector(".when-play"));
}

// Onde está o áudio parado: as barras já tocadas acendem e o tempo conta (no começo ou no fim, mostra o total).
function paintPreview(session) {
  const { audio, take } = session;
  const progress = audio.ended ? 0 : Math.min(1, audio.currentTime / take.seconds);
  const played = Math.round(progress * recWave.childElementCount);
  [...recWave.children].forEach((bar, index) => bar.classList.toggle("played", index < played));
  recTime.textContent = clockTime(progress ? audio.currentTime : take.seconds);
}

function togglePreview() {
  const session = rec;
  const audio = session?.audio;
  if (!audio) return;
  if (!audio.paused) return audio.pause();
  stopVoice();
  audio.play().catch(() => {});
  const step = () => {
    if (rec !== session || audio.paused) return;
    paintPreview(session);
    session.frame = requestAnimationFrame(step);
  };
  session.frame = requestAnimationFrame(step);
  paintRecorder();
}

recStop.addEventListener("click", () => {
  if (rec?.mode === "locked") reviewRecording();
  else if (rec?.mode === "review") togglePreview();
});

micButton.addEventListener("pointerdown", (event) => {
  if (rec || event.button !== 0 || !event.isPrimary) return;
  event.preventDefault();
  micButton.setPointerCapture?.(event.pointerId);
  micHold = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now() };
  startRecording("hold");
});

// Segurando: para a esquerda, o "deslize para cancelar" acompanha o dedo e, passando do limite, cancela;
// para cima, o cadeado sobe junto e, chegando nele, a gravação trava (dá para soltar o dedo e enviar depois).
micButton.addEventListener("pointermove", (event) => {
  if (micHold?.id !== event.pointerId || rec?.mode !== "hold") return;
  const left = Math.min(0, event.clientX - micHold.x);
  const up = Math.max(0, micHold.y - event.clientY);
  // Vale a direção principal: deslizando para o lado com o dedo subindo um pouco, não trava (e vice-versa).
  if (up >= LOCK_SLIDE && up > -left) {
    navigator.vibrate?.(10);
    sound.play("tap");
    return lockRecording();
  }
  if (left <= -CANCEL_SLIDE && -left > up) {
    sound.play("discard");
    navigator.vibrate?.(10);
    return stopRecording(false);
  }
  recSlide.style.transform = `translateX(${left * 0.8}px)`;
  recSlide.style.opacity = String(1 + left / CANCEL_SLIDE * 0.7);
  recLock.style.transform = `translateY(${-up * 0.5}px)`;
  recLock.classList.toggle("ready", up > LOCK_SLIDE * 0.6);
});

function releaseMic(event) {
  if (micHold?.id !== event.pointerId) return;
  const held = performance.now() - micHold.at;
  micHold = null;
  // Travou arrastando para cima: soltar o dedo não envia (nem o clique que vem logo depois).
  if (rec?.mode === "locked") {
    rec.lockedAt = performance.now();
    return;
  }
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
  if (rec.mode !== "hold" && performance.now() - rec.lockedAt > 300) stopRecording(true);
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

// Áudio tocando agora (um por vez, num só <audio>). key = clientId ou id da mensagem, que não muda depois de enviada
// (nos áudios das cartinhas, "letter:" ou "draft:" e a chave do arquivo).
const playback = { key: "", message: null, audio: null, frame: 0, loading: false, drag: null, converted: new Map() };
const voiceKey = (message) => message.clientId || message.id;
const voiceNode = (key) => (key ? document.querySelector(`.voice[data-voice-key="${CSS.escape(key)}"]`) : null);
const voiceSource = (message) => message.file.preview || new URL(message.file.url, document.baseURI).href;
const voicePlaying = () => Boolean(playback.key && !playback.audio.paused);

// Duração: a do arquivo, quando o navegador sabe (o WebM gravado no Chrome não diz); senão, a medida ao gravar.
function voiceTotal(message) {
  const duration = playback.audio?.duration;
  return voiceKey(message) === playback.key && Number.isFinite(duration) && duration > 0 ? duration : message.file.voice.duration;
}

function voiceState(message) {
  const current = voiceKey(message) === playback.key;
  return { playing: current && voicePlaying(), loading: current && playback.loading, position: current ? playback.audio.currentTime : 0, total: voiceTotal(message) };
}

// Player dentro do balão, como no Discord. As peças vão direto para a grade do balão (styles.css): play à esquerda, a
// onda e o tempo à direita dela e, embaixo, o "Transcrever" alinhado com a hora; a transcrição por último.
function voiceView(message) {
  const { voice } = message.file;
  const node = el("div", "voice");
  node.dataset.voiceKey = voiceKey(message);
  node.msg = message;
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
  const meta = el("div", "voice-meta");
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
  node.append(play, wave, el("span", "voice-time"), meta);
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
  node.classList.toggle("at-start", !playing && position <= 0);
}

// Repinta o player de uma mensagem (o que está sendo arrastado fica como o dedo deixou).
function paintVoice(key = playback.key) {
  const node = voiceNode(key);
  if (!node || (playback.drag?.moved && playback.drag.wave.closest(".voice") === node)) return;
  paintVoiceNode(node, voiceState(node.msg));
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

// Tocar na forma de onda pula para aquele ponto; arrastar na horizontal mostra onde vai parar e pula ao soltar.
// Arrastar na vertical continua rolando a conversa (touch-action: pan-y no styles.css). Vale na conversa e nas cartinhas.
// A onda fica 6 px para dentro dos lados da área (styles.css).
const waveFraction = (wave, x) => {
  const box = wave.getBoundingClientRect();
  return Math.min(1, Math.max(0, (x - box.left - 6) / (box.width - 12)));
};

document.addEventListener("pointerdown", (event) => {
  const wave = event.target.closest?.(".voice-wave");
  const message = wave?.closest(".voice")?.msg;
  if (!message?.file?.voice || event.button !== 0) return;
  wave.setPointerCapture?.(event.pointerId);
  playback.drag = { wave, message, id: event.pointerId, x: event.clientX, moved: false };
});

document.addEventListener("pointermove", (event) => {
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

document.addEventListener("pointerup", endWaveDrag);
document.addEventListener("pointercancel", endWaveDrag);

// Teclado: setas voltam e avançam 5 s.
document.addEventListener("keydown", (event) => {
  const message = event.target.closest?.(".voice-wave")?.closest(".voice")?.msg;
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
  if (nearBottom() && latest) {
    loadNewerPage();
  } else if (nearBottom()) {
    unseenBelow = 0;
    jumpCount.classList.add("hidden");
    fx.hide(jump, { scale: 0.6 });
    markSeen();
  } else if (messagesEl.scrollHeight - messagesEl.clientHeight > 400 && jump.classList.contains("hidden")) {
    fx.show(jump, { scale: 0.6 });
  }
  if (messagesEl.scrollTop < 60) loadOlder();
}, { passive: true });

jump.addEventListener("click", () => {
  if (!latest) return scrollToLatest(true);
  backToLatest();
  fx.hide(jump, { scale: 0.6 });
});

function markSeen() {
  // No perfil a conversa está escondida, e num trecho antigo as novas ainda não apareceram: nada foi lido ainda.
  if (!socket?.connected || document.hidden || tab !== "chat" || latest || !nearBottom()) return;
  const last = list[list.length - 1];
  if (last && reads[me]?.id !== last.id) {
    reads[me] = { id: last.id, at: new Date().toISOString() };
    socket.emit("seen", { id: last.id });
  }
  markRoomRead(room);
}

function markRoomRead(id) {
  const entry = rooms.find((item) => item.id === id);
  if (!entry?.unread) return;
  entry.unread = 0;
  paintRooms();
  paintMenuDot();
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
    const notification = new Notification(message.sender, { body: message.deleted ? "" : previewText(message).slice(0, 160), icon: avatars.get(message.sender), tag: `potato-chat:${message.room}`, renotify: true, silent: true });
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

// Redução de ruído nos áudios que a pessoa grava (só neste aparelho). Desligada, grava o som como ele está.
function paintNoise() {
  const button = $("#toggle-noise");
  button.classList.toggle("hidden", !canRecord);
  button.classList.toggle("is-off", !noiseOn());
  button.setAttribute("aria-checked", String(noiseOn()));
  $("#noise-state").textContent = noiseOn() ? "Ligada nos áudios que você grava" : "Desligada: o áudio vai como o microfone ouve";
}

$("#toggle-noise").addEventListener("click", (event) => {
  store.set("localStorage", NOISE_KEY, !noiseOn());
  paintNoise();
  fx.press(event.currentTarget);
  sound.play("tap");
});
paintNoise();

// ---------- pesquisa na conversa ----------

// A lupa do topo abre a pesquisa: no computador, uma coluna à direita da conversa; no celular, a tela toda. O servidor
// procura na conversa inteira (não só no que está carregado): no texto, nas legendas, nos nomes dos arquivos, nas
// transcrições dos áudios e nas músicas pedidas, sem diferença de acentos. Tocar num resultado abre a conversa naquela
// mensagem, com o termo marcado; "Ir para um dia" abre no começo do dia escolhido.
const searchPanel = $("#search-panel");
const searchInput = $("#search-input");
const searchResults = $("#search-results");
const searchButton = $("#search-button");
const searchDay = $("#search-day");
const SEARCH_WAIT = 350;
// query = o que foi pesquisado; run = a pesquisa mais recente (as respostas atrasadas de outras são ignoradas).
const search = { query: "", items: [], hasMore: false, loading: false, error: "", run: 0, timer: 0, active: "" };
const phoneLayout = matchMedia("(max-width: 760px)");

// Sem acentos e em minúsculas, como o fold do servidor.
const foldText = (text) => text.normalize("NFD").replace(/\p{Mn}+/gu, "").toLowerCase();
const cleanQuery = (text) => text.trim().replace(/\s+/g, " ");
const searchOpen = () => !searchPanel.classList.contains("hidden");

function openSearch() {
  if (!searchOpen()) {
    fx.show(searchPanel, { x: 24 });
    $(".conversation").classList.add("searching");
    searchButton.setAttribute("aria-expanded", "true");
    searchDay.max = isoDay(new Date(Date.now() + musicClock));
    paintSearch();
  }
  searchInput.focus();
  searchInput.select();
}

function closeSearch() {
  if (!searchOpen()) return;
  clearTimeout(search.timer);
  searchPanel.classList.add("hidden");
  $(".conversation").classList.remove("searching");
  searchButton.setAttribute("aria-expanded", "false");
  messagesEl.querySelectorAll("mark.hit").forEach((mark) => mark.replaceWith(...mark.childNodes));
}

function runSearch(more = false) {
  clearTimeout(search.timer);
  const query = more ? search.query : cleanQuery(searchInput.value);
  const run = ++search.run;
  if (!more) Object.assign(search, { query, items: [], hasMore: false, error: "" });
  if (foldText(query).length < 2 || !socket?.connected) {
    search.loading = false;
    search.error = query && !socket?.connected ? "Sem conexão agora." : "";
    return paintSearch();
  }
  search.loading = true;
  paintSearch();
  socket.timeout(15000).emit("search", { query, before: more ? search.items[search.items.length - 1]?.id : "" }, (error, result) => {
    if (run !== search.run) return;
    search.loading = false;
    if (error || !result?.ok) search.error = result?.error || "A pesquisa não respondeu. Tente de novo.";
    else Object.assign(search, { items: [...search.items, ...result.items], hasMore: result.hasMore });
    paintSearch();
  });
}

function searchNote(iconName, text, className = "") {
  const node = el("div", `search-note${className ? ` ${className}` : ""}`);
  node.append(icon(iconName), el("span", "", text));
  return node;
}

function paintSearch() {
  const { query, items, hasMore, loading, error } = search;
  const typed = foldText(query).length >= 2;
  const nodes = [];
  if (!typed && !error) {
    nodes.push(searchNote("search", query ? "Escreva pelo menos 2 letras." : "Procure uma palavra, uma música, o nome de um arquivo ou o que foi dito num áudio transcrito."));
  } else if (items.length) {
    nodes.push(el("p", "search-count", `${items.length}${hasMore ? "+" : ""} ${items.length === 1 ? "mensagem" : "mensagens"}`), ...items.map(searchHit));
  }
  if (loading) nodes.push(searchNote("loader", "Procurando…", "busy"));
  else if (error) nodes.push(searchNote("alert", error));
  else if (typed && !items.length) nodes.push(searchNote("search", `Nada encontrado para “${query}”.`));
  else if (hasMore) {
    const more = el("button", "load-more search-more", "Mostrar mais antigas");
    more.type = "button";
    more.dataset.searchMore = "";
    nodes.push(more);
  }
  searchResults.replaceChildren(...nodes);
}

// Data do resultado: a hora (hoje), "Ontem", "3 de out." (este ano) ou "03/10/2025".
function hitDate(iso) {
  const day = dayLabel(iso);
  if (day === "Hoje") return time(iso);
  if (day === "Ontem") return day;
  const date = new Date(iso);
  const thisYear = date.getFullYear() === new Date(Date.now() + musicClock).getFullYear();
  return new Intl.DateTimeFormat("pt-BR", thisYear ? { day: "numeric", month: "short" } : { day: "2-digit", month: "2-digit", year: "numeric" }).format(date).replace(".", "");
}

function searchHit(message) {
  const button = el("button", `search-hit${message.id === search.active ? " active" : ""}`);
  button.type = "button";
  button.dataset.hit = message.id;
  const top = el("span", "hit-top");
  const stamp = el("time", "", hitDate(message.createdAt));
  stamp.dateTime = message.createdAt;
  top.append(el("strong", "", message.sender === me ? "Você" : message.sender), stamp);
  // Onde o termo apareceu: o texto, a transcrição do áudio, o nome do arquivo ou a música.
  const needle = foldText(search.query);
  const places = [
    [message.text, ""],
    [message.file?.voice?.text, "mic"],
    [message.file && !message.file.voice ? message.file.name : "", "paperclip"],
    [message.music ? [message.music.title, message.music.artist].filter(Boolean).join(" — ") : "", "music"]
  ];
  const [text, iconName] = places.find(([value]) => value && foldText(value).includes(needle)) || [previewText(message), ""];
  const line = el("span", "hit-text");
  if (iconName) line.append(icon(iconName));
  line.append(snippet(text, search.query));
  button.append(top, line);
  return button;
}

// Onde o termo está no texto ([começo, fim]), sem diferença de maiúsculas nem acentos ("joao" acha "João").
function findFolded(text, query) {
  const needle = foldText(cleanQuery(query));
  if (!needle) return null;
  let folded = "";
  const starts = [];
  for (let index = 0; index < text.length;) {
    const char = String.fromCodePoint(text.codePointAt(index));
    const plain = foldText(char);
    for (let count = 0; count < plain.length; count += 1) starts.push(index);
    folded += plain;
    index += char.length;
  }
  starts.push(text.length);
  const at = folded.indexOf(needle);
  return at < 0 ? null : [starts[at], starts[at + needle.length]];
}

// O trecho em volta do termo, com ele marcado.
function snippet(text, query) {
  const flat = text.replace(/\s+/g, " ").trim();
  const fragment = document.createDocumentFragment();
  const range = findFolded(flat, query);
  if (!range) {
    fragment.append(flat);
    return fragment;
  }
  const [from, to] = range;
  let start = 0;
  if (from > 40) {
    start = flat.lastIndexOf(" ", from - 30) + 1 || from - 30;
    fragment.append("…");
  }
  fragment.append(flat.slice(start, from), el("mark", "", flat.slice(from, to)), flat.slice(to));
  return fragment;
}

// Marca o termo no balão (as marcas somem quando ele é redesenhado ou a pesquisa fecha).
function markHits(node, query) {
  for (const box of node.querySelectorAll(".bubble .text, .voice-text")) {
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    for (let current of texts) {
      for (let range = findFolded(current.data, query); range; range = findFolded(current.data, query)) {
        const hit = current.splitText(range[0]);
        current = hit.splitText(range[1] - range[0]);
        const mark = el("mark", "hit");
        hit.replaceWith(mark);
        mark.append(hit);
      }
    }
  }
}

searchButton.addEventListener("click", () => {
  sound.play("tap");
  if (searchOpen()) closeSearch();
  else openSearch();
});
$("#search-close").addEventListener("click", closeSearch);
searchInput.addEventListener("input", () => {
  clearTimeout(search.timer);
  search.timer = setTimeout(runSearch, SEARCH_WAIT);
});
$("#search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch();
  // No celular, o teclado sai da frente dos resultados.
  if (phoneLayout.matches) searchInput.blur();
});
searchPanel.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.stopPropagation();
  closeSearch();
  searchButton.focus();
});
searchResults.addEventListener("click", (event) => {
  if (event.target.closest("[data-search-more]")) return runSearch(true);
  const hit = event.target.closest("[data-hit]");
  if (!hit) return;
  search.active = hit.dataset.hit;
  searchResults.querySelectorAll(".search-hit.active").forEach((node) => node.classList.remove("active"));
  hit.classList.add("active");
  sound.play("tap");
  // No celular a pesquisa cobre a conversa: fecha para mostrar a mensagem.
  if (phoneLayout.matches) closeSearch();
  focusMessage(hit.dataset.hit, search.query);
});
// Chegando no fim da lista, vêm as mais antigas.
searchResults.addEventListener("scroll", () => {
  if (search.hasMore && !search.loading && searchResults.scrollHeight - searchResults.scrollTop - searchResults.clientHeight < 80) runSearch(true);
}, { passive: true });
// No computador, o calendário abre ao clicar em qualquer parte da linha (não só no ícone do campo).
searchDay.addEventListener("click", () => {
  if (!matchMedia("(pointer: fine)").matches) return;
  try {
    searchDay.showPicker?.();
  } catch {}
});
searchDay.addEventListener("change", () => {
  if (!searchDay.value) return;
  if (phoneLayout.matches) closeSearch();
  openAt({ from: new Date(`${searchDay.value}T00:00:00`).toISOString() });
});

// ---------- abas: conversa e perfil ----------

const profileView = $("#profile-view");
let tab = "chat";
// Mensagens que chegaram enquanto a pessoa olhava o perfil (ou o Nosso cantinho), e as novidades do Nosso cantinho.
let unreadAway = 0;
let usNews = 0;
// A conversa some com display: none e perde a rolagem; null = estava no fim.
let chatScroll = null;

function paintTabs() {
  document.querySelectorAll("[data-tab-target]").forEach((button) => {
    const active = button.dataset.tabTarget === tab;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  // A conversa aberta, na lista de conversas.
  peopleEl.querySelectorAll("[data-room]").forEach((row) => row.classList.toggle("active", tab === "chat" && row.dataset.room === room));
  // As partes do Nosso cantinho, no menu.
  document.querySelectorAll(".side-link").forEach((link) => {
    const active = tab === "us" && link.dataset.usOpen === us.section;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  paintCallDock();
}

function paintUnread() {
  document.querySelectorAll(".unread-badge").forEach((badge) => {
    badge.textContent = unreadAway > 99 ? "99+" : String(unreadAway);
    badge.classList.toggle("hidden", !unreadAway);
  });
  paintMenuDot();
}

// No celular, a conversa e o perfil ficam no menu: o pontinho do botão acende com mensagem nova fora da conversa e
// com novidade no Nosso cantinho.
function paintMenuDot() {
  const elsewhere = rooms.reduce((total, entry) => total + (entry.id === room ? 0 : entry.unread), 0);
  document.querySelectorAll(".menu-dot").forEach((dot) => dot.classList.toggle("hidden", !(unreadAway + usNews + elsewhere)));
}

function bumpUnread() {
  unreadAway += 1;
  paintUnread();
  document.querySelectorAll(".unread-badge, .menu-dot").forEach((badge) => fx.pop(badge));
}

// Ordem das abas (a tela nova entra do lado de onde a aba está).
const TABS = ["chat", "us", "profile"];

function showTab(name) {
  if (name === tab || !me) return;
  // O Nosso cantinho é do casal, e da conversa dele: vindo de outra conversa, ela abre junto.
  if (name === "us") {
    if (!couple) return;
    const home = rooms.find((entry) => entry.couple)?.id;
    if (home && home !== room) return void openRoom(home).then((opened) => opened && showTab("us"));
  }
  closeTools();
  closeGifs();
  if (tab === "chat") chatScroll = nearBottom() ? null : messagesEl.scrollTop;
  const direction = TABS.indexOf(name) > TABS.indexOf(tab) ? 1 : -1;
  tab = name;
  chatView.dataset.tab = name;
  paintTabs();
  sound.play("tap");
  if (name === "profile") {
    openProfile();
    fx.view(profileView, direction);
    return;
  }
  if (name === "us") {
    openUs();
    fx.view(usView, direction);
    return;
  }
  paintUsBadge();
  unreadAway = 0;
  paintUnread();
  messagesEl.scrollTop = chatScroll ?? messagesEl.scrollHeight;
  markSeen();
  fx.view($(".conversation"), direction);
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-tab-target]");
  if (!target) return;
  showTab(target.dataset.tabTarget);
});

// No perfil, Esc volta para a conversa (a não ser que uma janela esteja aberta: aí o Esc é dela).
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || tab !== "profile" || document.querySelector(".modal:not(.hidden), .viewer:not(.hidden)")) return;
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
// Vídeo do aparelho: quem escolhe manda o arquivo para o servidor (em pedaços) e cada um assiste de lá.
// O envio em andamento: { file, xhr, cancelled }. Pedaço que o servidor aceita (vem com o histórico).
let watchUpload = null;
let watchChunk = 0;
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
  if (!watchView || !item || streaming(item)) return watchPlayer.destroy();
  if (watchPlayer.uid !== item.uid) return watchPlayer.open(item, watchAt, () => watch.playing);
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
  if (chooser) notice.textContent = chooser.service === "local" ? `${chooser.name} está enviando um vídeo do aparelho…` : `${chooser.name} está escolhendo ${WATCH_WHERE[chooser.service] || "algo"}…`;
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
    $("#watch-unblock").classList.add("hidden");
    paintWatchPicker();
    return setWatchExpanded(false);
  }
  watchPanel.classList.remove("browsing");
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
  $("#watch-unblock").classList.toggle("hidden", !watchBlocked);
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

// Vídeo do aparelho: lê a duração, manda o arquivo para o servidor em pedaços e começa para os dois. Cada um assiste de
// lá: quem mandou pode sair que o vídeo continua. A internet caiu no meio: tenta de novo de onde o servidor parou.
async function uploadWatchVideo(file) {
  if (!file.type.startsWith("video/") && !/.(mp4|m4v|mov|webm|mkv)$/i.test(file.name)) return toast("Escolha um arquivo de vídeo.", "error");
  if (watchUpload) return toast("Já tem um vídeo subindo.", "error");
  if (!socket?.connected || !watchChunk) return toast("Sem conexão agora. Tente de novo em instantes.", "error");
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
  const upload = watchUpload = { file, room, key: "", sent: 0, xhr: null, cancelled: false, told: 0 };
  paintWatchUpload();
  let failures = 0;
  try {
    while (upload.sent < file.size) {
      // A outra pessoa vê "Ana está enviando um vídeo…" (o aviso vale 10 minutos: renova no caminho).
      if (Date.now() - upload.told > 300000) {
        upload.told = Date.now();
        socket?.emit("watch", { op: "browse", service: "local" });
      }
      const result = await sendWatchChunk(upload);
      if (upload.cancelled) return;
      if (result.key) upload.key = result.key;
      if (Number.isFinite(result.received)) upload.sent = result.received;
      if (result.ok) {
        failures = 0;
        continue;
      }
      if (!result.retry || ++failures > 5) throw new Error(result.error || "O vídeo não subiu. Tente de novo.");
      await new Promise((resolve) => setTimeout(resolve, 2000 * failures));
    }
    watchCommand("start", { local: { key: upload.key, duration } });
  } catch (error) {
    sound.play("error");
    toast(error.message, "error");
    socket?.emit("watch", { op: "browse", service: "" });
  } finally {
    if (watchUpload === upload) watchUpload = null;
    paintWatchUpload();
  }
}

// Um pedaço: o servidor responde quanto já tem (received). Internet ou servidor fora do ar: retry (tenta de novo);
// recusa de verdade (não é vídeo, grande demais): para.
function sendWatchChunk(upload) {
  return new Promise((resolve) => {
    const start = upload.sent;
    const xhr = upload.xhr = new XMLHttpRequest();
    xhr.open("POST", apiUrl("watch-upload"));
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-Potato-Token", socket.auth.token);
    xhr.setRequestHeader("X-Potato-Room", upload.room || "");
    xhr.setRequestHeader("X-Potato-Name", encodeURIComponent(upload.file.name));
    xhr.setRequestHeader("X-Potato-Size", String(upload.file.size));
    xhr.setRequestHeader("X-Potato-Key", upload.key);
    xhr.setRequestHeader("X-Potato-Offset", String(start));
    xhr.upload.onprogress = (event) => paintWatchUpload(start + event.loaded);
    xhr.onload = () => {
      let result = null;
      try { result = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status === 200 && result) return resolve({ ...result, retry: !result.ok && Boolean(result.key) });
      resolve({ ok: false, error: result?.error, retry: xhr.status === 0 || xhr.status >= 500 });
    };
    xhr.onerror = () => resolve({ ok: false, retry: true });
    xhr.onabort = () => resolve({ ok: false, retry: false });
    xhr.send(upload.file.slice(start, start + watchChunk));
  });
}

function cancelWatchUpload() {
  if (!watchUpload) return;
  watchUpload.cancelled = true;
  watchUpload.xhr?.abort();
  socket?.emit("watch", { op: "browse", service: "" });
}

function paintWatchUpload(sent = watchUpload?.sent || 0) {
  const upload = watchUpload;
  $("#watch-upload").classList.toggle("hidden", !upload);
  if (!upload) return;
  const total = upload.file.size;
  $("#watch-upload-name").textContent = upload.file.name;
  $("#watch-upload-text").textContent = `Subindo para o servidor: ${Math.floor((sent / total) * 100)}% (${formatSize(sent)} de ${formatSize(total)}). Quando terminar, começa para os dois.`;
  $("#watch-upload-bar").value = sent / total;
}

// Fechar a aba no meio do envio perde o que já subiu: o navegador pergunta antes.
window.addEventListener("beforeunload", (event) => {
  if (watchUpload) event.preventDefault();
});

$("#pick-watch").addEventListener("change", (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (file) uploadWatchVideo(file);
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
  if (target.closest("#watch-upload-cancel")) return cancelWatchUpload();
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
  const peer = users.find((user) => user.name === peerName && user.name !== me) || null;

  if (peer && peerWasOnline !== null && peer.online !== peerWasOnline) {
    sound.play(peer.online ? "join" : "leave");
    toast(peer.online ? `${peer.name} está online` : `${peer.name} saiu do chat`, peer.online ? "ok" : "info");
    if (peer.online) fx.pop(peerAvatar);
  }
  peerWasOnline = peer ? peer.online : null;

  roomTitle.textContent = peer ? peer.name : "Ninguém aqui ainda";
  peerOpen.classList.toggle("has-peer", Boolean(peer));
  peerOpen.tabIndex = peer ? 0 : -1;
  peerOpen.title = peer ? `Ver o perfil de ${peer.name}` : "";
  peerOpen.setAttribute("aria-label", peer ? `Ver o perfil de ${peer.name}` : "Ninguém na conversa ainda");
  paintAvatar(peerAvatar, peerName);
  peerAvatar.classList.toggle("online", Boolean(peer?.online));
  paintPeerStatus();

  // Dá para ligar com a outra pessoa offline (a chamada fica esperando): o botão só avisa.
  for (const button of document.querySelectorAll("#audio-call, #video-call, #share-screen")) {
    button.title = peer?.online ? button.dataset.title : `${button.dataset.title} (${peer?.name || "a outra pessoa"} está offline: a chamada fica esperando)`;
  }

  paintRooms();
  paintTabs();
  paintUnread();
}

// ---------- conversas (os contatos) ----------
// Na barra lateral, das mais recentes para as mais antigas: a foto (com o ponto de online), o nome, a última mensagem
// (ou como a pessoa está) e quantas não foram lidas. Tocar abre a conversa; embaixo, o Adicionar pessoa.
function paintRooms() {
  const rows = rooms.map((entry) => {
    const person = presenceList.find((user) => user.name === entry.peer);
    const row = el("button", `person${person?.online ? " online" : ""}`);
    row.type = "button";
    row.dataset.room = entry.id;
    row.classList.toggle("active", tab === "chat" && entry.id === room);
    const avatar = el("div", "avatar");
    paintAvatar(avatar, entry.peer);
    avatar.classList.toggle("online", Boolean(person?.online));
    const last = entry.last ? `${entry.last.sender === me ? "Você: " : ""}${entry.last.deleted ? "Mensagem apagada" : entry.last.text || "Mensagem"}` : "";
    const status = person?.online ? (person.active ? "Ativo agora" : "Online") : last || lastSeenLabel(person?.lastSeen) || "Diga oi!";
    const text = el("div", "person-text");
    text.append(el("strong", "", entry.peer), el("small", "", person?.online && last ? last : status));
    // A aberta conta as que chegaram com você fora dela (no perfil, no Nosso cantinho); as outras, as não lidas.
    const count = entry.id === room ? unreadAway : entry.unread;
    const badge = el("span", `tab-badge${entry.id === room ? " unread-badge" : ""}`, count > 99 ? "99+" : String(count));
    badge.classList.toggle("hidden", !count);
    row.append(avatar, text, badge);
    return row;
  });
  // O Adicionar pessoa (convite) fica escondido: o chat é só do casal. Para mostrar, é só pôr o botão de volta aqui.
  peopleEl.replaceChildren(...rows);
}

peopleEl.addEventListener("click", (event) => {
  if (event.target.closest("[data-add-person]")) return openAddPerson();
  const row = event.target.closest("[data-room]");
  if (!row) return;
  setMenu(false);
  openRoom(row.dataset.room).then((opened) => { if (opened) showTab("chat"); });
});

// Abre outra conversa: o servidor manda o histórico dela (como ao conectar). true = ela está aberta.
function openRoom(id) {
  return new Promise((resolve) => {
    if (id === room) return resolve(true);
    if (!socket?.connected) {
      toast("Sem conexão agora. Tente de novo em instantes.", "error");
      return resolve(false);
    }
    socket.timeout(15000).emit("room", { id }, (error, result) => {
      if (error || !result?.ok) {
        toast(result?.error || "Não deu para abrir a conversa agora.", "error");
        return resolve(false);
      }
      applyHistory(result);
      resolve(true);
    });
  });
}

// Contato novo (um convite aceito, aqui ou do outro lado): a lista de conversas vem de novo.
function refreshRooms() {
  socket?.timeout(10000).emit("rooms", null, (error, result) => {
    if (error || !result?.ok) return;
    const known = new Set(rooms.map((entry) => entry.id));
    rooms = result.rooms;
    paintRooms();
    paintMenuDot();
    for (const entry of rooms) if (!known.has(entry.id)) toast(`${entry.peer} agora está nas suas conversas`, "ok", "user-plus");
    // Era a primeira conversa: ela abre.
    if (!room && rooms[0]) openRoom(rooms[0].id);
  });
}

// ---------- adicionar pessoa ----------
// O convite é um link que vale uma vez, por 7 dias: quem abre cria a conta (ou entra na dela) e vocês ganham uma
// conversa. Quem recebeu um convite também pode colar o link (ou o código) aqui, sem sair do app.
const addSheet = $("#add-person");
let pendingInvite = "";

function openAddPerson() {
  setMenu(false);
  $("#invite-link").value = "";
  $("#invite-code").value = "";
  $("#invite-state").textContent = "Criando o link…";
  addSheet.classList.remove("hidden");
  fx.incoming(addSheet.querySelector(".modal-card"));
  sound.play("tap");
  document.addEventListener("keydown", onAddKey, true);
  if (!socket?.connected) return void ($("#invite-state").textContent = "Sem conexão agora. Tente de novo em instantes.");
  socket.timeout(10000).emit("invite", { op: "create" }, (error, result) => {
    if (error || !result?.ok) return void ($("#invite-state").textContent = result?.error || "Não deu para criar o link agora.");
    $("#invite-link").value = `${location.origin}${location.pathname}#convite=${result.code}`;
    $("#invite-state").textContent = `Vale uma vez, por ${result.days} dias.`;
  });
}

function closeAddPerson() {
  addSheet.classList.add("hidden");
  document.removeEventListener("keydown", onAddKey, true);
}

function onAddKey(event) {
  if (event.key !== "Escape") return;
  event.stopPropagation();
  closeAddPerson();
}

function copyInvite() {
  const link = $("#invite-link").value;
  if (!link) return;
  navigator.clipboard?.writeText(link)
    .then(() => toast("Link copiado! Agora é só mandar.", "ok"))
    .catch(() => {
      $("#invite-link").select();
      toast("Selecione o link e copie.", "info");
    });
}

// Compartilhar: no app do Android, a janela de compartilhar dele (WhatsApp, Instagram…); no navegador, a do sistema.
function shareInvite() {
  const link = $("#invite-link").value;
  if (!link) return;
  const text = `Vem conversar comigo no Potato Chat! ${link}`;
  if (inAndroid && window.PotatoAndroid) {
    try { return window.PotatoAndroid.postMessage(JSON.stringify({ type: "share", text })); } catch {}
  }
  if (navigator.share) return void navigator.share({ title: "Potato Chat", text, url: link }).catch(() => {});
  copyInvite();
}

addSheet.addEventListener("click", (event) => {
  if (event.target === addSheet || event.target.closest("#add-close")) return closeAddPerson();
  if (event.target.closest("#invite-copy")) return copyInvite();
  if (event.target.closest("#invite-share")) return shareInvite();
});

$("#invite-form").addEventListener("submit", (event) => {
  event.preventDefault();
  acceptInvite($("#invite-code").value.trim());
});

function acceptInvite(code) {
  if (!code) return;
  if (!socket?.connected) return toast("Sem conexão agora. Tente de novo em instantes.", "error");
  socket.timeout(10000).emit("invite", { op: "accept", code }, (error, result) => {
    if (error || !result?.ok) {
      sound.play("error");
      return toast(result?.error || "Não deu para usar esse convite.", "error");
    }
    closeAddPerson();
    openRoom(result.room).then((opened) => {
      if (opened) showTab("chat");
      toast(`Pronto! Agora você e ${result.peer} podem conversar.`, "ok", "user-plus");
    });
  });
}

// "digitando…", "online agora", "Visto por último hoje às 14:03"… (no topo e no perfil da outra pessoa).
function peerStatusText(peer) {
  if (peerTyping) return peerTyping === "audio" ? "gravando áudio…" : "digitando…";
  if (!peer) return room ? "" : "Mande o link para a outra pessoa criar a conta dela";
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
// Como a chamada ficou (a mensagem dela na conversa; call_label em lib/potato.php).
const callLabel = (info) => (info.result === "missed" ? "Chamada perdida" : info.result === "declined" ? "Chamada recusada" : mediaLabel[info.media] || "Chamada");
// Agora, no relógio do servidor (até quando a chamada toca vem nele).
const serverNow = () => Date.now() + musicClock;
// Canais fixos da chamada, sempre nesta ordem. Ligar câmera ou tela no meio da chamada só troca a faixa, sem religar nada.
const SLOTS = ["mic", "cam", "screen", "screenAudio"];
const SLOT_KIND = { mic: "audio", cam: "video", screen: "video", screenAudio: "audio" };
const QUALITY_KEY = "potato.quality";
const QUALITY = {
  "720p": { width: 1280, height: 720, frameRate: 30, bitrate: 2_500_000, hint: "detail" },
  "1080p": { width: 1920, height: 1080, frameRate: 30, bitrate: 4_500_000, hint: "detail" },
  "1080p60": { width: 1920, height: 1080, frameRate: 60, bitrate: 8_000_000, hint: "motion" }
};
const canStream = nativeScreenAvailable() || Boolean(navigator.mediaDevices?.getDisplayMedia);

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
const canPip = inAndroid || Boolean(document.pictureInPictureEnabled && streamVideo.requestPictureInPicture);
const callInfo = $(".call-info");
const callDock = $("#call-dock");
const dockMic = $("#call-dock-mic");
const SPEAKING_LEVEL = 0.025;
const availableCalls = new Map();
const replacedCalls = store.get("sessionStorage", "potato.replacedCalls");
const resumeSuppressed = new Set(Array.isArray(replacedCalls) ? replacedCalls : []);
const closedCallIds = new Set();
const resumeSuppressedRooms = new Set();
const callTab = store.get("sessionStorage", "potato.callTab") || uid();
store.set("sessionStorage", "potato.callTab", callTab);
const availableCall = $("#available-call");
const waitLabel = (until) => {
  const seconds = Math.max(0, Math.ceil((until - serverNow()) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};
const ownParticipant = (info) => info?.participants?.find((item) => item.name === me);
const otherParticipant = (info) => info?.participants?.find((item) => item.name !== me);

function rememberCall(active = call) {
  if (!active?.id || (active.role === "callee" && !active.accepted)) return;
  store.set("localStorage", "potato.callResume", { id: active.id, account: me, tab: callTab, room: active.room, mic: micOn(), cam: Boolean(active.local.cam) });
}

function forgetCall(id) {
  const saved = store.get("localStorage", "potato.callResume");
  if (saved?.account === me && saved.id === id) store.remove("localStorage", "potato.callResume");
}

function paintAvailableCall() {
  const info = [...availableCalls.values()].find((item) => item.room === room);
  const activeHere = call && (call.role === "caller" || call.accepted);
  availableCall.classList.toggle("hidden", !info || Boolean(activeHere));
  if (info && !activeHere) {
    const elsewhere = ownParticipant(info)?.conn && ownParticipant(info).conn !== socket?.id;
    $("#available-call-text").textContent = elsewhere ? "Chamada em outro aparelho" : info.waitingUntil
      ? `Chamada disponível · ${waitLabel(info.waitingUntil)}` : "Chamada em andamento";
    const button = $("#join-available-call");
    button.disabled = Boolean(elsewhere || (info.waitingUntil && info.waitingUntil <= serverNow()));
    button.textContent = info.joined?.includes(me) ? "Entrar novamente" : "Entrar";
  }
  const current = availableCalls.get(call?.id);
  if (activeHere && current?.waitingUntil && !otherParticipant(current)) {
    callStatus.textContent = `Aguardando ${call.name} · ${waitLabel(current.waitingUntil)}`;
  }
  paintCallDock();
}
setInterval(paintAvailableCall, 1000);
$("#join-available-call").addEventListener("click", () => {
  const info = [...availableCalls.values()].find((item) => item.room === room);
  if (info) joinExistingCall(info);
});

function callRequest(op, id, data = {}) {
  return new Promise((resolve, reject) => socket.timeout(15000).emit("call", { op, id, ...data }, (error, result) => {
    if (error || !result?.ok) reject(new Error(result?.error || "Não foi possível entrar na chamada agora."));
    else resolve(result.call);
  }));
}

// Fecha só o transporte antigo. Microfone/câmera/tela locais continuam disponíveis enquanto a outra pessoa volta.
function resetPeer(active) {
  active.recovery?.close();
  active.recovery = null;
  const peer = peerConnection;
  peerConnection = null;
  if (peer) { peer.onconnectionstatechange = peer.ontrack = peer.onicecandidate = null; peer.close(); }
  pendingCandidates = [];
  active.slots = null;
  active.peerId = null;
  active.offered = false;
  active.connected = false;
  active.remote = {};
  active.remoteState = { mic: false, cam: false, screen: false };
  clearInterval(active.clock);
  cancelAnimationFrame(active.frame);
  remoteAudio.srcObject = null;
  callInfo.classList.remove("live");
  paintStage();
}

async function resumeCurrentCall(active) {
  if (active.joining || !socket?.connected) return;
  active.joining = true;
  try {
    const info = await callRequest("resume", active.id, { state: myState() });
    if (call !== active) return;
    active.conn = socket.id;
    active.joining = false;
    receiveCallUpdate(info);
  } catch (error) {
    if (call !== active) return;
    active.joining = false;
    callStatus.textContent = "Aguardando conexão para voltar à chamada…";
  }
}

function applyCallInfo(info) {
  const active = call;
  if (!active || active.id !== info.id || active.joining || (active.role === "callee" && !active.accepted)) return;
  const mine = ownParticipant(info);
  if (mine?.conn !== socket?.id) {
    if (!mine || mine.conn === active.conn) resumeCurrentCall(active);
    else {
      resumeSuppressed.add(info.id);
      teardown(false);
      toast("A chamada está em outro aparelho.");
    }
    return;
  }
  active.conn = socket.id;
  active.lease = mine.lease;
  if (info.answeredAt && !active.since) active.since = Date.now() - Math.max(0, serverNow() - info.answeredAt);
  const peer = otherParticipant(info);
  if (active.generation !== info.generation || active.peerId !== (peer?.conn || null)) {
    resetPeer(active);
    active.generation = info.generation;
    if (peer) {
      if (active.role === "caller") sendOffer({ id: info.id, from: peer.conn, state: peer.state, generation: info.generation });
      else { active.peerId = peer.conn; active.remoteState = peer.state; callStatus.textContent = "Reconectando a chamada…"; }
    }
  }
  if (active.role === "callee" && active.pendingOffer?.generation === info.generation) {
    const offer = active.pendingOffer;
    active.pendingOffer = null;
    receiveOffer(offer);
  }
  rememberCall(active);
  paintStage();
  paintAvailableCall();
}

function receiveCallUpdate(info) {
  if (!info?.id || closedCallIds.has(info.id)) return;
  const previous = availableCalls.get(info.id);
  if (previous && previous.generation > info.generation) info = previous;
  availableCalls.set(info.id, info);
  if (call?.id === info.id && call.role === "callee" && !call.accepted && (!info.from || info.answered)) teardown(false);
  applyCallInfo(info);
  paintAvailableCall();
  if (!call) maybeResumeCall();
}

function maybeResumeCall() {
  if (call || !socket?.connected) return;
  const saved = store.get("localStorage", "potato.callResume");
  const candidates = [...availableCalls.values()].filter((info) => info.joined?.includes(me) && !resumeSuppressed.has(info.id)
    && !resumeSuppressedRooms.has(info.room)
    && (!info.waitingUntil || info.waitingUntil > serverNow()));
  candidates.sort((a, b) => Number(b.id === saved?.id) - Number(a.id === saved?.id) || b.startedAt - a.startedAt);
  const info = candidates.find((item) => !ownParticipant(item) || ownParticipant(item).conn === socket.id
    || (saved?.account === me && saved.id === item.id && saved.tab === callTab));
  if (info) joinExistingCall(info, true);
}

async function joinExistingCall(info, automatic = false, desiredMedia = "") {
  if (call && (call.role === "caller" || call.accepted)) return;
  if (call) teardown(false);
  if (!automatic) {
    resumeSuppressed.delete(info.id);
    resumeSuppressedRooms.delete(info.room);
    store.set("sessionStorage", "potato.replacedCalls", [...resumeSuppressed]);
  }
  const saved = store.get("localStorage", "potato.callResume");
  const active = call = newCall({ id: info.id, room: info.room, media: info.media, role: info.caller === me ? "caller" : "callee",
    name: info.caller === me ? info.callee : info.caller, accepted: true, joining: true, generation: info.generation });
  try {
    if (room !== info.room) await openRoom(info.room);
    if (call !== active) return;
    await acquireMic(active);
    if (call !== active) return;
    if (saved?.account === me && saved.id === info.id && saved.mic === false && active.local.mic) active.local.mic.enabled = false;
    if (desiredMedia === "video" || (!automatic && !info.joined?.includes(me) && info.media === "video") || (saved?.account === me && saved.id === info.id && saved.cam)) await toggleCam();
    if (call !== active) return;
    openCallPanel(automatic ? "Voltando à chamada…" : "Entrando na chamada…");
    const joined = await callRequest(automatic ? "resume" : "join", info.id, { state: myState(), renegotiate: true });
    if (call !== active) return;
    active.joining = false;
    active.conn = socket.id;
    rememberCall(active);
    receiveCallUpdate(joined);
    if (automatic) toast("Você voltou à chamada.", "ok");
  } catch (error) {
    if (call !== active) return;
    resumeSuppressed.add(info.id);
    toast(error.message, "error");
    teardown(false);
  }
}

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

// A faixa fica fora da conversa: permanece acessível no perfil, no cantinho e em outros chats.
function paintCallDock() {
  const active = call && (call.role === "caller" || call.accepted) ? call : null;
  const focused = Boolean(active && tab === "chat" && room === active.room && !active.minimized);
  const docked = Boolean(active && !focused);
  callDock.classList.toggle("hidden", !docked);
  chatView.classList.toggle("has-call-dock", docked);
  chatView.classList.toggle("call-minimized", Boolean(active && !focused));
  chatView.classList.toggle("in-call", focused);
  if (!active) return;
  callDock.classList.toggle("connected", active.connected && peerConnection?.connectionState === "connected");
  paintAvatar($("#call-dock-avatar"), active.name);
  $("#call-dock-name").textContent = active.name;
  $("#call-dock-status").textContent = callStatus.textContent.startsWith("Em chamada com") ? "Em chamada" : callStatus.textContent;
  $("#call-dock-timer").textContent = callTimer.textContent;
  $("#call-dock-open").setAttribute("aria-label", `Voltar à chamada com ${active.name}`);
  setToggle(dockMic, micOn(), "Silenciar microfone", "Ativar microfone");
  dockMic.setAttribute("aria-label", dockMic.title);
}

async function returnToCall() {
  const active = call;
  if (!active) return;
  if (room !== active.room && !await openRoom(active.room)) return;
  if (call !== active) return;
  active.minimized = false;
  showTab("chat");
  setMenu(false);
  paintCallDock();
  $("#call-minimize").focus({ preventScroll: true });
}

$("#call-dock-open").addEventListener("click", returnToCall);
$("#call-dock-mic").addEventListener("click", toggleMic);
$("#call-dock-leave").addEventListener("click", () => teardown(true));
$("#call-minimize").addEventListener("click", () => {
  if (!call) return;
  call.minimized = true;
  chatView.classList.remove("call-expanded");
  setToggle($("#toggle-chat"), true, "Esconder o chat", "Mostrar o chat");
  paintCallDock();
  $("#call-dock-open").focus({ preventScroll: true });
  requestAnimationFrame(() => scrollToLatest());
});

function myState() {
  return { mic: micOn(), cam: Boolean(call?.local.cam), screen: Boolean(call?.local.screen) };
}

// Avisa a outra pessoa o que está ligado (microfone, câmera, transmissão).
function sendState() {
  if (call?.slots) socket?.emit("call-state", { id: call.id, to: call.peerId, generation: call.generation, ...myState() });
}

function receiveCallState(state) {
  if (!call || (state.id && state.id !== call.id)) return;
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
  if (track) element.play().catch(() => {});
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
  const hasCamera = Boolean(local.cam || (remoteState.cam && remote.cam));
  callPanel.classList.toggle("voice-only", !hasCamera && !peerLive);
  $("#call-heading").textContent = peerLive || local.screen ? "Transmissão de tela" : hasCamera ? "Chamada de vídeo" : "Chamada de voz";

  // Só a transmissão recebida aparece: exibir a própria tela cria um espelho infinito.
  stage.classList.toggle("has-stream", peerLive);
  callPanel.classList.toggle("receiving-screen", peerLive);
  if (!peerLive) callPanel.classList.remove("portrait-stream");
  streamTile.classList.toggle("hidden", !peerLive);
  if (peerLive) {
    const tracks = [remote.screen, remote.screenAudio].filter(Boolean);
    const ids = tracks.map((track) => track.id).join();
    if (streamVideo.dataset.tracks !== ids) {
      streamVideo.srcObject = new MediaStream(tracks);
      streamVideo.dataset.tracks = ids;
      streamVideo.play().catch(() => {});
    }
    $("#stream-owner").textContent = `Transmissão de ${call.name}`;
  } else if (streamVideo.srcObject) {
    leavePip();
    streamVideo.srcObject = null;
    delete streamVideo.dataset.tracks;
  }
  myStream.classList.add("hidden");
  setVideo(myStreamVideo, null);
  if (inAndroid) updateRemotePip(peerLive ? remote.screen : remoteState.cam ? remote.cam : null);
  $("#call-pip").classList.toggle("hidden", !inAndroid || (!peerLive && !(remoteState.cam && remote.cam)));
  const pill = $("#live-pill");
  pill.classList.toggle("hidden", !local.screen);
  pill.textContent = local.screen ? `Transmitindo · ${QUALITY_LABEL[call.quality] || "tela"}` : "";

  paintTile(tileMe, { video: local.cam, muted: !micOn(), live: Boolean(local.screen) });
  paintTile(tilePeer, { video: remoteState.cam ? remote.cam : null, muted: !remoteState.mic, live: peerLive });

  setToggle($("#toggle-mic"), micOn(), "Silenciar microfone", "Ativar microfone");
  setToggle($("#toggle-cam"), Boolean(local.cam), "Desligar câmera", "Ligar câmera");
  setToggle($("#toggle-live"), Boolean(local.screen), "Parar transmissão", "Transmitir tela");
  rememberCall();
  syncAndroidCall();
  paintCallDock();
}

function openCallPanel(status) {
  call.minimized = false;
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
  // Uma reentrada rápida cancela a animação de saída anterior antes de reutilizar o painel.
  window.gsap?.killTweensOf(callPanel);
  fx.show(callPanel, { y: -20, scale: 0.97 });
  scrollToLatest();
}

async function createPeer(expectedGeneration = call?.generation) {
  const active = call;
  const settings = await loadRtcConfig();
  if (call !== active || active.generation !== expectedGeneration) throw new Error("Conexão substituída");
  const peer = peerConnection = new RTCPeerConnection(settings.config);
  active.recovery = createRtcRecovery({
    peer, caller: active.role === "caller", loadConfig: loadRtcConfig, remoteReady: flushCandidates,
    send: (message) => socket?.emit("webrtc-restart", { ...message, id: active.id, to: active.peerId, generation: expectedGeneration }),
    status: (text) => { if (call === active) callStatus.textContent = text || `Em chamada com ${active.name}`; },
    failed: () => {
      if (call !== active || peerConnection !== peer) return;
      toast("Não foi possível recuperar a conexão. Verifique a internet e a configuração do servidor TURN.", "error");
      teardown(true);
    }
  });
  peer.onicecandidate = ({ candidate }) => {
    if (candidate && call === active && peerConnection === peer) socket.emit("webrtc-ice", { id: active.id, candidate, to: active.peerId, generation: expectedGeneration });
  };
  peer.ontrack = ({ track, transceiver }) => {
    if (call !== active || peerConnection !== peer) return;
    const slot = SLOTS[peer.getTransceivers().indexOf(transceiver)];
    if (!slot) return;
    call.remote[slot] = track;
    if (slot === "mic") remoteAudio.srcObject = new MediaStream([track]);
    paintStage();
  };
  peer.onconnectionstatechange = () => {
    if (call !== active || peerConnection !== peer) return;
    const state = peer.connectionState;
    if (state === "connected") {
      onConnected();
      if (call) callStatus.textContent = `Em chamada com ${call.name}`;
    }
    if (state === "disconnected") callStatus.textContent = "Conexão instável…";
    if (state === "failed") {
      callStatus.textContent = "Reconectando a chamada…";
    }
  };
  return peer;
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
  clearInterval(call.clock);
  const started = call.since ||= Date.now();
  syncAndroidCall();
  call.clock = setInterval(() => {
    const seconds = Math.floor((Date.now() - started) / 1000);
    callTimer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    paintCallDock();
  }, 1000);
  sendState();
  call.recovery?.configure().catch(() => {});
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
  if (!active || !canStream || active.sharePending) return false;
  active.sharePending = true;
  const quality = QUALITY[key] || QUALITY["1080p"];
  let display;
  if (nativeScreenAvailable() && active.local.screen) stopLive(false);
  try {
    display = nativeScreenAvailable() ? await startNativeScreen(quality, audio) : await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: quality.width }, height: { ideal: quality.height }, frameRate: { ideal: quality.frameRate, max: quality.frameRate } },
      audio,
      systemAudio: audio ? "include" : "exclude",
      surfaceSwitching: "include",
      selfBrowserSurface: "exclude"
    });
  } catch (error) {
    toast(nativeScreenAvailable() ? error.message : inExtension ? mediaDeniedText() : "Transmissão cancelada.");
    return false;
  } finally { active.sharePending = false; }
  if (active !== call) {
    display.getTracks().forEach((track) => track.stop());
    stopNativeScreen();
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
  stopNativeScreen();
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
  if (!peerName || !socket?.connected) {
    sound.play("error");
    return toast(peerName ? "Sem conexão agora. Tente de novo em instantes." : "Dá para ligar quando a outra pessoa criar a conta dela.", "error");
  }
  const available = [...availableCalls.values()].find((info) => info.room === room);
  if (available) return joinExistingCall(available, false, media);
  resumeSuppressedRooms.delete(room);
  const active = call = newCall({ media, role: "caller", name: peerName, room, generation: 0, conn: socket.id });
  // A tela é escolhida primeiro, enquanto o clique ainda vale para o navegador.
  if (media === "screen") {
    const started = await startLive(share.quality, share.audio);
    if (active !== call) return;
    if (!started) return teardown(false);
  }
  if (active !== call) return;
  await acquireMic(active);
  if (media === "video") await toggleCam();
  if (active !== call) return;

  openCallPanel(`Chamando ${active.name}…`);
  sound.loop("ringback");
  // A oferta WebRTC só sai quando alguém atender (sendOffer), direto para o aparelho que atendeu.
  socket.timeout(10000).emit("call", { op: "start", media, state: myState() }, (error, result) => {
    if (active !== call) {
      if (result?.call?.id) socket.emit("call-leave", { id: result.call.id, lease: 0 });
      return;
    }
    if (error || !result?.ok) {
      sound.play("error");
      toast(result?.error || "Não foi possível iniciar a chamada.", "error");
      // Sem resposta, o servidor pode ter aberto a chamada mesmo assim: o desligar fecha ela lá.
      return teardown(Boolean(error));
    }
    active.id = result.call.id;
    rememberCall(active);
    receiveCallUpdate(result.call);
    if (!result.online) callStatus.textContent = `Chamando ${active.name}… (offline: a chamada fica esperando)`;
    // O toque dura um minuto; a sala aguarda entrada por até cinco minutos, controlados no servidor.
    active.timeout = setTimeout(() => {
      if (call !== active || active.peerId) return;
      sound.stopLoop();
      callStatus.textContent = `${active.name} não atendeu · esperando entrar`;
    }, Math.max(0, result.call.ringUntil - serverNow()));
    syncAndroidCall();
  });
}

// Atenderam (from = a conexão que atendeu): a oferta vai direto para ela.
async function sendOffer({ id, from, state, generation = 0 }) {
  const active = call;
  if (active?.role !== "caller" || active.id !== id || active.peerId) return;
  active.generation = generation;
  active.peerId = from;
  if (state) active.remoteState = state;
  clearTimeout(active.timeout);
  sound.stopLoop();
  callStatus.textContent = "Conectando…";
  try {
    const peer = await createPeer(generation);
    active.slots = Object.fromEntries(SLOTS.map((slot) => [slot, peer.addTransceiver(SLOT_KIND[slot], { direction: "sendrecv" })]));
    await Promise.all(SLOTS.map(attach));
    await peer.setLocalDescription(await peer.createOffer());
    if (active !== call || active.generation !== generation || peerConnection !== peer) return;
    socket.emit("webrtc-offer", { id, to: from, description: peer.localDescription, media: active.media, state: myState(), generation });
    paintStage();
  } catch {
    if (active !== call || active.generation !== generation) return;
    sound.play("error");
    toast("Não foi possível iniciar a chamada.", "error");
    teardown(true);
  }
}

// Chamada para você (o aviso call-ring, ou a aberta que veio com o histórico ao conectar): a janela de atender.
// Toca até ringUntil; depois a chamada continua aberta e a janela fica sem tocar ("está te esperando").
function ring(info) {
  if (info?.id && (!availableCalls.has(info.id) || availableCalls.get(info.id).generation <= info.generation)) availableCalls.set(info.id, info);
  if (!info || !info.from || info.callee !== me || info.answered || call?.id === info.id) return;
  // A daqui ficou para trás (o servidor só tem uma chamada aberta por vez): vale a nova.
  if (call) teardown(false);
  const active = call = newCall({ id: info.id, media: info.media, role: "callee", peerId: info.from, name: info.caller, ringUntil: info.ringUntil, room: info.room, generation: info.generation });
  active.remoteState = info.state || { mic: true, cam: info.media === "video", screen: info.media === "screen" };
  paintAvatar($("#incoming-face"), info.caller);
  $("#incoming-kind").textContent = mediaLabel[info.media] || "Chamada";
  paintIncoming(active);
  incoming.classList.remove("hidden");
  // Atender pela notificação do celular (com o app fechado, ou ainda conectando): entra direto.
  if (pendingAccept === info.id) {
    pendingAccept = "";
    return acceptCall();
  }
  fx.incoming(incoming.querySelector(".incoming-card"));
  syncAndroidCall();
  if (!ringing(active)) return;
  playRing(active);
  // No celular quem avisa com a página escondida é a notificação de chamada do app.
  if (document.hidden && !inAndroid && notificationsOn()) {
    try { new Notification(`${info.caller} está ligando`, { body: mediaLabel[info.media], tag: "potato-call", requireInteraction: true }); } catch {}
  }
  active.timeout = setTimeout(() => {
    if (call !== active || active.accepted) return;
    sound.stopLoop();
    paintIncoming(active);
  }, Math.max(0, info.ringUntil - serverNow()));
}

const ringing = (active) => active.ringUntil > serverNow();

// O app do Android com a página escondida não toca por ela: o toque é o da notificação de chamada.
function playRing(active) {
  if (call === active && !active.accepted && ringing(active) && !(inAndroid && document.hidden)) sound.loop("ring");
}

document.addEventListener("visibilitychange", () => {
  if (!inAndroid || call?.role !== "callee" || call.accepted) return;
  if (document.hidden) sound.stopLoop();
  else playRing(call);
});

function paintIncoming(active) {
  const now = ringing(active);
  $("#incoming .eyebrow").textContent = now ? "Chamada recebida" : "Chamada aberta";
  $("#incoming-title").textContent = now ? `${active.name} está ligando` : `${active.name} está te esperando na chamada`;
  $("#accept-label").textContent = now ? "Atender" : "Entrar";
  $("#decline-label").textContent = now ? "Recusar" : "Agora não";
}

async function acceptCall() {
  if (!call || call.role !== "callee" || call.accepted) return;
  const info = availableCalls.get(call.id);
  if (info) return joinExistingCall(info);
}

async function receiveOffer({ id, description, from, state, generation = 0 }) {
  const active = call;
  if (active?.id === id && active.role === "callee" && active.accepted && active.joining) {
    active.pendingOffer = { id, description, from, state, generation };
    return;
  }
  if (active?.role !== "callee" || !active.accepted || active.id !== id || active.offered || active.generation !== generation) return;
  active.offered = true;
  active.peerId = from;
  if (state) active.remoteState = state;
  try {
    const peer = await createPeer(generation);
    await peer.setRemoteDescription(description);
    const transceivers = peer.getTransceivers();
    active.slots = Object.fromEntries(SLOTS.map((slot, index) => [slot, transceivers[index]]).filter(([, transceiver]) => transceiver));
    transceivers.forEach((transceiver) => { transceiver.direction = "sendrecv"; });
    await Promise.all(SLOTS.map(attach));
    await flushCandidates();
    await peer.setLocalDescription(await peer.createAnswer());
    if (active !== call || active.generation !== generation || peerConnection !== peer) return;
    socket.emit("webrtc-answer", { id: active.id, description: peer.localDescription, to: from, state: myState(), generation });
    paintStage();
  } catch {
    if (active !== call || active.generation !== generation) return;
    sound.play("error");
    toast(inExtension ? mediaDeniedText() : "Não foi possível entrar na chamada.", "error");
    teardown(true);
  }
}

function declineCall() {
  if (!call || call.role !== "callee" || call.accepted) return;
  socket?.emit("call", { op: "decline", id: call.id });
  sound.play("hangup");
  teardown(false);
}

// Fim da chamada (o servidor avisa todos os aparelhos). reason: hangup, declined, missed (ninguém entrou) ou dropped
// (a conexão de alguém caiu).
function callEnded({ id, reason, name } = {}) {
  if (id) closedCallIds.add(id);
  availableCalls.delete(id);
  forgetCall(id);
  paintAvailableCall();
  const active = call;
  if (!active || (id && active.id !== id)) return;
  if (active.role === "callee" && !active.accepted) {
    // Recusada em outro aparelho seu: aqui só para de tocar.
    if (reason !== "declined") toast(`Chamada perdida de ${active.name}.`);
  } else if (active.role === "caller" && !active.peerId) {
    toast(reason === "declined" ? `${name || active.name} recusou a chamada.` : reason === "missed" ? `${active.name} não entrou na chamada.` : "A chamada caiu.");
  } else {
    toast(reason === "timeout" ? "A chamada encerrou após 5 minutos de espera." : reason === "dropped" ? "A chamada caiu." : "Chamada encerrada.");
  }
  sound.play("hangup");
  teardown(false);
}

// As chamadas abertas com você segundo o servidor, ao conectar (e a cada reconexão, que pode ter perdido avisos): a
// daqui que acabou nesse meio-tempo some; a que é para você toca (ou espera você entrar).
function syncCall(calls) {
  const previous = new Map(availableCalls);
  availableCalls.clear();
  calls = calls.filter((info) => !closedCallIds.has(info.id)).map((info) => previous.get(info.id)?.generation > info.generation ? previous.get(info.id) : info);
  for (const info of calls) availableCalls.set(info.id, info);
  const info = calls.find((item) => item.id === call?.id);
  if (call?.id && (!info || (call.role === "callee" && !call.accepted && (info.answered || !info.from)))) {
    if (!info) forgetCall(call.id);
    teardown(false);
  }
  if (info) applyCallInfo(info);
  if (pendingAccept && !calls.some((item) => item.id === pendingAccept)) {
    pendingAccept = "";
    toast("Essa chamada já terminou.");
  }
  const requested = calls.find((item) => item.id === pendingAccept);
  if (requested && (!call || (call.id === requested.id && !call.accepted))) {
    pendingAccept = "";
    joinExistingCall(requested);
  }
  maybeResumeCall();
  const waiting = calls.find((item) => item.callee === me && !item.answered && item.from && !item.joined?.includes(me));
  if (!call && waiting) ring(waiting);
  paintAvailableCall();
}

// Chamada na conversa, como no Discord: uma linha só, com o ícone do telefone, o que aconteceu e quanto durou
// ("Ana iniciou uma chamada que durou 9 minutos.", "Você perdeu uma chamada de Ana que durou poucos segundos.").
// No celular vai a versão curta, que cabe numa linha com a hora ("Ana iniciou uma chamada · 9 min", "Chamada perdida
// de Ana"). Enquanto a chamada está aberta esperando você, tem o Entrar.
function callCard(message) {
  const info = message.call;
  const mine = info.caller === me;
  const name = (who) => el("strong", "", who === me ? "Você" : who);
  const open = info.status !== "ended";
  const lost = !mine && (info.result === "missed" || info.result === "declined");
  const line = el("div", `call-line${lost ? " lost" : ""}${open ? " open" : ""}`);
  line.append(icon(lost ? "phone-missed" : "phone"));
  const long = el("span", "call-line-text call-long");
  const short = el("span", "call-line-text call-short");
  const lasted = info.endedAt - (lost ? info.startedAt : info.answeredAt || info.startedAt);
  if (open) {
    const live = info.status === "live";
    long.append(name(info.caller), live ? " está numa chamada." : info.status === "waiting" ? " deixou a chamada disponível por 5 minutos." : " iniciou uma chamada.");
    short.append(name(info.caller), live ? " está numa chamada" : info.status === "waiting" ? " · chamada disponível" : " está ligando");
  } else if (info.result === "declined") {
    long.append(...(mine ? [name(info.callee), " recusou a sua chamada."] : ["Você recusou uma chamada de ", name(info.caller), "."]));
    short.append(...(mine ? [name(info.callee), " recusou a chamada"] : ["Você recusou a chamada"]));
  } else if (lost) {
    long.append("Você perdeu uma chamada de ", name(info.caller), ` que durou ${callDuration(lasted)}.`);
    short.append("Chamada perdida de ", name(info.caller));
  } else {
    long.append(name(info.caller), ` iniciou uma chamada que durou ${callDuration(lasted)}.`);
    if (info.result === "missed") short.append("Chamada não atendida");
    else short.append(name(info.caller), ` iniciou uma chamada · ${callDurationShort(lasted)}`);
  }
  line.append(long, short);
  if (open && !(call?.id === info.id && (call.role === "caller" || call.accepted))) {
    const join = el("button", "call-line-join", "Entrar");
    join.type = "button";
    join.dataset.callAction = "join";
    line.append(join);
  }
  return line;
}

// "poucos segundos", "um minuto", "9 minutos", "uma hora", "2 horas".
function callDuration(ms) {
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  if (minutes < 1) return "poucos segundos";
  if (minutes < 60) return minutes === 1 ? "um minuto" : `${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? "uma hora" : `${hours} horas`;
}

// A mesma, curta (no celular): "40 s", "9 min", "1 h 20 min".
function callDurationShort(ms) {
  const seconds = Math.round(Math.max(0, ms) / 1000);
  if (seconds < 60) return `${Math.max(1, seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes / 60} h`;
}

function callCardAction(action, info) {
  if (action !== "join") return;
  // Entrar: a janela de atender já está aberta para ela, ou o servidor diz se ela ainda está aberta.
  if (call?.id === info.id && (call.role === "caller" || call.accepted)) return;
  socket?.timeout(8000).emit("call", { op: "get", id: info.id }, (error, result) => {
    if (error || result?.call?.id !== info.id) return toast("Essa chamada já terminou.");
    joinExistingCall(result.call);
  });
}

// ---------- chamada no app do Android ----------
// A chamada aberta vai para o app (CallService): ela continua com o app em segundo plano ou a tela desligada, com a
// notificação de chamada (desligar, mudo; tocar volta para cá). O app chama window.potatoCall: atender e recusar (pela
// notificação de chamada recebida), desligar e mudo, ligar de volta (pela de chamada perdida) e background/foreground
// (com o app em segundo plano a câmera não continua: ela desliga e volta sozinha quando o app volta).
let androidCall = "";
let pendingAccept = "";
let pendingDial = "";
// A conversa em que o Ligar de volta liga (a da chamada perdida).
let pendingDialRoom = "";

function syncAndroidCall() {
  if (!inAndroid) return;
  const active = call && (call.role === "caller" || call.accepted) ? call : null;
  const state = active
    ? { type: "call", active: true, id: active.id || "", name: active.name, avatar: avatars.get(active.name) || "", media: active.media, connected: active.connected, since: active.since || 0, mic: micOn(), screen: Boolean(active.local.screen), peerScreen: Boolean(active.remoteState.screen), peerVideo: Boolean((active.remoteState.screen && active.remote.screen) || (active.remoteState.cam && active.remote.cam)) }
    : { type: "call", active: false, ringing: Boolean(call) };
  const json = JSON.stringify(state);
  if (json === androidCall) return;
  androidCall = json;
  try { window.PotatoAndroid?.postMessage(json); } catch {}
}

function pauseCamera(hidden) {
  if (!call) return;
  if (hidden && call.local.cam) {
    call.camPaused = true;
    toggleCam();
  } else if (!hidden && call.camPaused) {
    call.camPaused = false;
    toggleCam();
  }
}

window.potatoCall = (action, value = "", where = "") => {
  if (action === "accept") {
    if (call?.id === value) acceptCall();
    else if (availableCalls.has(value)) joinExistingCall(availableCalls.get(value));
    else pendingAccept = value;
  } else if (action === "decline") {
    if (call?.id === value) declineCall();
  } else if (action === "hangup") {
    if (call?.role === "callee" && !call.accepted) declineCall();
    else if (call) teardown(true);
  } else if (action === "mute") {
    toggleMic();
  } else if (action === "dial") {
    pendingDial = value || "audio";
    pendingDialRoom = where;
    if (socket?.connected) runPendingDial();
  } else if (action === "background" || action === "foreground") {
    pauseCamera(action === "background");
    if (action === "foreground" && peerConnection?.connectionState !== "connected") call?.recovery?.request();
  } else if (action === "network") {
    call?.recovery?.request();
  } else if (action === "pip") {
    document.documentElement.classList.toggle("android-pip", value === true);
  } else if (action === "pip-unavailable") {
    toast("A miniatura fica disponível quando a outra pessoa envia vídeo ou transmite a tela.");
  }
};

function runPendingDial() {
  if (!pendingDial || !peerName) return;
  const media = pendingDial === "video" ? "video" : "audio";
  const where = pendingDialRoom;
  pendingDial = pendingDialRoom = "";
  openRoom(where || room).then((opened) => {
    if (!opened) return;
    showTab("chat");
    startCall(media);
  });
}

// O app do Android abre uma conversa (tocou na notificação de uma mensagem).
window.potatoRoom = (id) => {
  if (me && id) openRoom(id).then((opened) => opened && showTab("chat"));
};

// Endereço vindo das notificações do celular (com o app fechado): #atender=<id> (atender), #ligar=audio:<conversa>
// (ligar de volta) ou #conversa=<id> (abrir a conversa de uma mensagem).
function callFromHash() {
  const [key, value = ""] = location.hash.slice(1).split("=");
  if (!["atender", "ligar", "conversa"].includes(key)) return;
  history.replaceState(null, "", location.pathname + location.search);
  if (key === "atender") pendingAccept = value;
  else if (key === "conversa") room = value;
  else [pendingDial, pendingDialRoom = ""] = value.split(":");
}

async function receiveAnswer({ id, description, from, state, generation = 0 }) {
  if (call?.role !== "caller" || !peerConnection || (id && id !== call.id) || generation !== call.generation || peerConnection.signalingState !== "have-local-offer") return;
  call.peerId = from;
  if (state) call.remoteState = state;
  sound.stopLoop();
  callStatus.textContent = "Conectando…";
  await peerConnection.setRemoteDescription(description);
  await flushCandidates();
  paintStage();
}

async function receiveIce({ candidate, id, from, generation = 0 }) {
  if (!call || (id && id !== call.id) || generation !== call.generation || (from && call.peerId && from !== call.peerId)) return;
  if (!peerConnection?.remoteDescription) pendingCandidates.push(candidate);
  else await peerConnection.addIceCandidate(candidate).catch(() => { if (pendingCandidates.length < 200) pendingCandidates.push(candidate); });
}

async function flushCandidates() {
  const peer = peerConnection;
  for (const candidate of pendingCandidates.splice(0)) {
    if (!peer || peer !== peerConnection) return;
    await peer.addIceCandidate(candidate).catch(() => {});
  }
}

function teardown(notifyPeer) {
  if (notifyPeer && call) {
    rememberCall();
    if (call.id) resumeSuppressed.add(call.id);
    resumeSuppressedRooms.add(call.room);
  }
  stopNativeScreen();
  call?.recovery?.close();
  document.documentElement.classList.remove("android-pip");
  if (inAndroid) updateRemotePip(null);
  if (notifyPeer && call?.id) socket?.emit("call-leave", { to: call.peerId, id: call.id, lease: call.lease ?? 0 });
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
  syncAndroidCall();
  paintAvailableCall();
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
  const unavailable = nativeScreenAvailable() && !nativeScreenAudioAvailable();
  audio.disabled = unavailable;
  audio.title = unavailable ? "O som interno precisa do app atualizado e de Android 10 ou superior." : "";
  if (nativeScreenAvailable()) audio.querySelector("small").textContent = unavailable
    ? "Atualize o app; som interno disponível a partir do Android 10"
    : "Som dos apps que permitem captura; sua voz continua pelo microfone";
  audio.classList.toggle("is-off", unavailable || !shareAudio());
  audio.setAttribute("aria-checked", String(!unavailable && shareAudio()));
}

function onShareKey(event) {
  if (event.key !== "Escape") return;
  event.stopPropagation();
  closeShare();
}

function openShare() {
  if (!canStream) return explainNoShare();
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
$("#call-pip").classList.toggle("hidden", !inAndroid);
$("#call-pip").addEventListener("click", () => window.PotatoAndroid?.postMessage(JSON.stringify({ type: "pip" })));
$("#stream-pip").addEventListener("click", () => {
  if (inAndroid) return window.PotatoAndroid?.postMessage(JSON.stringify({ type: "pip" }));
  const request = document.pictureInPictureElement ? document.exitPictureInPicture() : streamVideo.requestPictureInPicture();
  request.catch(() => toast("Não deu para abrir a janelinha flutuante."));
});
watchShape(tileMe, tileMe.querySelector("video"));
watchShape(tilePeer, tilePeer.querySelector("video"));
watchShape(myStream, myStreamVideo);
watchShape(streamTile, streamVideo);
streamVideo.addEventListener("resize", () => callPanel.classList.toggle("portrait-stream", streamVideo.videoHeight > streamVideo.videoWidth));
window.addEventListener("potato-screen-warning", ({ detail }) => toast(detail));
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
// Fechar/recarregar sai desta conexão, preservando a sala e os dados para reentrar por até cinco minutos.
window.addEventListener("beforeunload", () => {
  if (call?.id && (call.role === "caller" || call.accepted)) {
    rememberCall();
    socket?.emit("call-leave", { to: call.peerId, id: call.id, lease: call.lease ?? 0 });
  }
});
window.addEventListener("online", () => call?.recovery?.request());

// ---------- nosso cantinho ----------
// Uma aba só nossa: o dia de cada um (hora em que acordou, refeições com foto, hábitos, humor, momentos e como foi o
// dia), a agenda dos dois, os sonhos e metas, as cartinhas e os joguinhos. Tudo fica no servidor (ação "us"), e as
// mudanças chegam ao vivo para os dois (aviso "us").

const usView = $("#us-view");
const usScroll = $("#us-scroll");
const US_SECTIONS = ["hoje", "agenda", "sonhos", "cartinhas", "jogos"];
const US_SECTION_KEY = "potato.usSection";
const MEALS = [["cafe", "coffee", "Café da manhã", "Pão, café, fruta…"], ["almoco", "utensils", "Almoço", "Arroz, feijão, bife…"], ["lanche", "cookie", "Lanche", "Bolo, biscoito, açaí…"], ["jantar", "soup", "Jantar", "Sopa, pizza, lanche…"]];
const MEAL_INFO = Object.fromEntries(MEALS.map(([key, iconName, label, hint]) => [key, { icon: iconName, label, hint }]));
// Humor do dia: chave (a mesma lista do MOODS em lib/potato.php), ícone e nome.
const MOODS = [["feliz", "smile", "Feliz"], ["rindo", "laugh", "Rindo à toa"], ["amor", "heart", "Amando"], ["energia", "zap", "Com energia"], ["deboa", "meh", "De boa"], ["sono", "moon", "Com sono"], ["triste", "frown", "Triste"], ["raiva", "angry", "Com raiva"], ["doente", "thermometer", "Doente"]];
const MOOD_INFO = Object.fromEntries(MOODS.map(([key, iconName, label]) => [key, { icon: iconName, label }]));
const PROMPT_LABELS = [["acordar", "sunrise", "Hora de acordar", "Acordar"], ["cafe", "coffee", "Café da manhã", "Café"], ["almoco", "utensils", "Almoço", "Almoço"], ["lanche", "cookie", "Lanche", "Lanche"], ["jantar", "soup", "Jantar", "Jantar"], ["rotina", "list-checks", "Rotina (o que falta)", "Rotina"]];
const PROMPT_ICON = Object.fromEntries(PROMPT_LABELS.map(([key, iconName]) => [key, iconName]));
const PROMPT_DEFAULTS = { acordar: "09:30", cafe: "10:30", almoco: "13:30", lanche: "16:30", jantar: "20:30", rotina: "22:00" };
// Ícones que dá para escolher (as mesmas listas do EVENT_ICONS e do GOAL_ICONS em lib/potato.php).
const EVENT_ICONS = [["calendar", "Compromisso"], ["heart", "Encontro"], ["film", "Cinema"], ["utensils", "Comida"], ["cake", "Aniversário"], ["plane", "Viagem"], ["gift", "Presente"], ["stethoscope", "Saúde"], ["graduation", "Estudo"], ["briefcase", "Trabalho"], ["cart", "Compras"], ["dumbbell", "Treino"]];
const GOAL_ICONS = [["sparkles", "Sonho"], ["palmtree", "Praia"], ["plane", "Viagem"], ["home", "Casa"], ["dog", "Bichinho"], ["gem", "Aliança"], ["car", "Carro"], ["graduation", "Estudo"], ["piggy", "Dinheiro"], ["gamepad", "Jogo"], ["chef", "Cozinha"], ["globe", "Mundo"]];
const REPEAT_LABEL = { none: "Não repete", weekly: "Toda semana", monthly: "Todo mês", yearly: "Todo ano" };
const REMIND_OPTIONS = [["", "Sem lembrete"], [0, "Na hora"], [15, "15 minutos antes"], [30, "30 minutos antes"], [60, "1 hora antes"], [120, "2 horas antes"], [1440, "1 dia antes"]];
const PAPERS = [["creme", "Creme"], ["rosa", "Rosa"], ["azul", "Azul"], ["lilas", "Lilás"], ["verde", "Verde"]];
// Letras da cartinha (mesma lista do servidor; a primeira é o padrão) e quantas fotos e áudios cabem nela.
const LETTER_FONTS = [["classica", "Clássica"], ["mao", "À mão"], ["cursiva", "Cursiva"], ["bilhete", "Bilhetinho"], ["maquina", "Máquina"], ["moderna", "Moderna"]];
const LETTER_PHOTOS = 6;
const LETTER_AUDIOS = 3;
const LETTER_DRAFT_KEY = "potato.letterDraft";
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const savedSection = store.get("localStorage", US_SECTION_KEY);
// O que vem do servidor (ação "load" e os avisos "us"): os dias já abertos (data → { nome: dia }), a agenda, os sonhos
// e metas, as cartinhas (sem o texto inteiro), os hábitos dos dois e os lembretes desta pessoa.
const us = { loaded: false, section: US_SECTIONS.includes(savedSection) ? savedSection : "hoje", day: "", days: new Map(), loadingDay: "", events: [], goals: [], letters: [], habits: {}, prompts: {}, month: "", calDay: "" };
// Novidades da outra pessoa desde a última vez nesta aba (as cartinhas novas contam à parte, até serem abertas).
let usUnseen = 0;

const pad2 = (value) => String(value).padStart(2, "0");
const isoDay = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
// Hoje no fuso do aparelho, pelo relógio do servidor (o do celular pode estar errado).
const todayKey = () => isoDay(new Date(Date.now() + musicClock));
// Meio-dia: contar dias para a frente e para trás nunca erra por causa de horário de verão.
const dayDate = (day) => new Date(`${day}T12:00:00`);
const shiftDay = (day, amount) => {
  const date = dayDate(day);
  date.setDate(date.getDate() + amount);
  return isoDay(date);
};
const nowClock = () => {
  const now = new Date(Date.now() + musicClock);
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
};
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const fullDate = (day) => new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(dayDate(day));
const shortDate = (day) => new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short" }).format(dayDate(day)).replace(".", "");
const who = (name) => (name === me ? "Você" : name);
const upsert = (items, item) => {
  const index = items.findIndex((old) => old.id === item.id);
  if (index >= 0) items[index] = { ...items[index], ...item };
  else items.push(item);
};

// "Hoje", "Ontem", "Amanhã" ou o dia da semana.
function dayName(day) {
  const diff = Math.round((dayDate(day) - dayDate(todayKey())) / 864e5);
  if (diff === 0) return "Hoje";
  if (diff === -1) return "Ontem";
  if (diff === 1) return "Amanhã";
  return capitalize(new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(dayDate(day)));
}

// "1.234,56", "1234.56", "R$ 50" → número (null se não der).
function parseMoney(text) {
  let clean = String(text ?? "").replace(/[^\d,.-]/g, "");
  if (clean.includes(",")) clean = clean.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(clean)) clean = clean.replace(/\./g, "");
  const value = Number.parseFloat(clean);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

// Ícone do sprite num quadradinho colorido (refeições, compromissos, sonhos, cartinhas, jogos…).
function iconBadge(name, className) {
  const node = el("span", className);
  node.append(icon(name));
  return node;
}

// Troca o ícone de um <use> do sprite (títulos e janelas).
const setIcon = (use, name) => use.setAttribute("href", `#i-${name}`);

function emptyNote(text) {
  const node = el("div", "us-empty");
  node.append(potatoArt(), el("span", "", text));
  return node;
}

// Pedido ao servidor (ação "us"). Dando errado, avisa (quiet = sem aviso, para o que roda sozinho) e devolve null.
function usCall(data, { quiet = false } = {}) {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      if (!quiet) toast("Sem conexão agora. Tente de novo em instantes.", "error");
      return resolve(null);
    }
    socket.timeout(15000).emit("us", data, (error, result) => {
      if (!error && result?.ok) return resolve(result);
      if (!quiet) {
        toast(result?.error || "Não deu certo. Tente de novo.", "error");
        sound.play("error");
      }
      resolve(null);
    });
  });
}

// Tudo de uma vez, ao conectar (e de novo a cada reconexão, que pode ter perdido avisos).
async function loadUs() {
  const day = us.day || todayKey();
  const result = await usCall({ op: "load", day }, { quiet: true });
  if (!result) return;
  Object.assign(us, { loaded: true, events: result.events, goals: result.goals, letters: result.letters, habits: result.habits, prompts: result.prompts });
  us.days.clear();
  us.days.set(day, result.days);
  us.day ||= day;
  paintUsBadge();
  if (tab === "us") paintUs();
  loadSchedule();
}

async function loadDay(day) {
  if (us.loadingDay === day) return;
  us.loadingDay = day;
  const result = await usCall({ op: "day", day }, { quiet: true });
  us.loadingDay = "";
  if (!result) return;
  us.days.set(day, result.days);
  if (tab === "us" && us.section === "hoje" && us.day === day) paintToday();
}

// Mudança feita aqui, no outro aparelho ou pela outra pessoa.
function applyUs(change) {
  const theirs = change.by !== me;
  switch (change.kind) {
    case "day": {
      const days = us.days.get(change.item.day);
      if (days) days[change.item.owner] = change.item;
      const meal = change.meal && change.item.meals[change.meal];
      if (theirs && meal && change.item.day === todayKey()) {
        const label = MEAL_INFO[change.meal].label.toLowerCase();
        usNotice(meal.text ? `${change.by} contou o que comeu no ${label}: ${meal.text}` : `${change.by} mandou a foto do ${label}`, MEAL_INFO[change.meal].icon);
      }
      break;
    }
    case "habits":
      us.habits[change.owner] = change.habits;
      break;
    case "prompts":
      loadSchedule();
      return;
    case "event":
      if (change.deleted) us.events = us.events.filter((event) => event.id !== change.id);
      else upsert(us.events, change.item);
      if (theirs && change.created) usNotice(`${change.by} marcou na agenda: ${change.item.title} · ${shortDate(change.item.date)}${change.item.time ? ` às ${change.item.time}` : ""}`, "calendar", { push: true });
      else if (theirs && change.deleted) usNotice(`${change.by} tirou da agenda: ${change.title}`, "calendar");
      loadSchedule();
      break;
    case "goal":
      if (change.deleted) us.goals = us.goals.filter((goal) => goal.id !== change.id);
      else upsert(us.goals, change.item);
      if (!theirs || change.deleted) break;
      if (change.action === "new") usNotice(`${change.by} sonhou alto: ${change.item.title}`, "sparkles");
      else if (change.action === "deposit" && change.amount > 0) usNotice(`${change.by} guardou ${money.format(change.amount)} para “${change.item.title}”`, "piggy");
      else if (change.action === "done" && change.item.done) {
        usNotice(`${change.by} marcou “${change.item.title}” como realizado!`, "sparkles", { push: true });
        fx.confetti();
      }
      break;
    case "letter":
      if (change.deleted) us.letters = us.letters.filter((letter) => letter.id !== change.id);
      else upsert(us.letters, change.item);
      if (theirs && change.action === "new") {
        usNotice(`${change.by} te escreveu uma cartinha!`, "mail", { push: true, count: false });
        fx.confetti(50);
      } else if (theirs && change.action === "read") {
        usNotice(`${change.by} leu a sua cartinha “${change.item.title}”`, "mail", { count: false });
      }
      break;
  }
  paintUsBadge();
  if (tab === "us") paintUs();
}

// Novidade da outra pessoa: aviso na tela, o número na aba (fora dela) e, com o site escondido no computador, a
// notificação (no app do Android, quem avisa é o próprio app).
function usNotice(text, iconName, { push = false, count = true } = {}) {
  toast(text, "info", iconName);
  sound.play("receive");
  if (count && tab !== "us") {
    usUnseen += 1;
    paintUsBadge();
    document.querySelectorAll(".menu-dot:not(.hidden)").forEach((dot) => fx.pop(dot));
  }
  if (!push || !document.hidden || inAndroid || !notificationsOn()) return;
  try {
    const notification = new Notification("Nosso cantinho", { body: text, icon: avatars.get(peerName), tag: "potato-us" });
    notification.onclick = () => {
      window.focus();
      goUs();
      notification.close();
    };
  } catch {}
}

const unreadLetters = () => us.letters.filter((letter) => letter.owner !== me && !letter.readAt).length;
const US_TITLES = { hoje: ["sun", "Rotina do dia"], agenda: ["calendar", "Agenda"], sonhos: ["sparkles", "Sonhos e metas"], cartinhas: ["mail", "Cartinhas"], jogos: ["dice", "Jogos"] };

// Os números do menu: cartinhas novas e partidas esperando a sua jogada. No celular, o botão do menu ganha um
// pontinho quando tem novidade lá dentro (também as da outra pessoa no dia, na agenda e nos sonhos).
function paintUsBadge() {
  const letters = unreadLetters();
  const turns = loaded().filter((message) => message.game && !message.deleted && myTurn(message.game)).length;
  for (const [selector, count] of [[".letters-new", letters], [".games-turn", turns]]) {
    document.querySelectorAll(selector).forEach((badge) => {
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.classList.toggle("hidden", !count);
    });
  }
  usNews = letters + turns + (tab === "us" ? 0 : usUnseen);
  paintMenuDot();
  paintSideAgenda();
}

// No menu, embaixo de "Agenda": o próximo compromisso.
function paintSideAgenda() {
  let next = null;
  for (let offset = 0; offset < 60 && !next; offset += 1) {
    const day = shiftDay(todayKey(), offset);
    const event = eventsOn(day).find((item) => offset > 0 || !item.time || (item.end || item.time) >= nowClock());
    if (event) next = [event, day];
  }
  const when = next && (next[1] === todayKey() ? "Hoje" : next[1] === shiftDay(todayKey(), 1) ? "Amanhã" : shortDate(next[1]));
  $("#side-agenda").textContent = next ? `${when}${next[0].time ? ` ${next[0].time}` : ""} · ${next[0].title}` : "Os compromissos dos dois";
}

// ---- menu: a barra lateral (no celular, uma gaveta que abre pelo botão de menu) ----

function setMenu(open) {
  chatView.classList.toggle("menu-open", open);
  document.querySelectorAll("[data-menu]").forEach((button) => button.setAttribute("aria-expanded", String(open)));
  if (open) sound.play("tap");
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-menu]")) return setMenu(!chatView.classList.contains("menu-open"));
  if (event.target.closest("#menu-backdrop") || event.target.closest(".sidebar [data-tab-target], .sidebar [data-us-open]")) setMenu(false);
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !chatView.classList.contains("menu-open")) return;
  event.stopImmediatePropagation();
  setMenu(false);
}, true);

function openUs() {
  usUnseen = 0;
  paintUsBadge();
  if (!us.loaded) loadUs();
  paintUs();
}

function setUsSection(section) {
  us.section = section;
  store.set("localStorage", US_SECTION_KEY, section);
}

// Abre o Nosso cantinho numa parte (de um aviso, do menu de anexar, de um comando ou do endereço #agenda…).
function goUs(section, { day, calDay } = {}) {
  if (US_SECTIONS.includes(section)) setUsSection(section);
  if (day) us.day = day;
  if (calDay) {
    us.calDay = calDay;
    us.month = calDay.slice(0, 7);
  }
  if (tab === "us") paintUs();
  else showTab("us");
}

function paintUs() {
  const [iconName, title] = US_TITLES[us.section];
  setIcon($("#us-title-icon"), iconName);
  usView.dataset.section = us.section;
  closeEventPop();
  $("#us-title-text").textContent = title;
  usView.querySelectorAll("[data-pane]").forEach((pane) => pane.classList.toggle("hidden", pane.dataset.pane !== us.section));
  paintTabs();
  ({ hoje: paintToday, agenda: paintAgenda, sonhos: paintGoals, cartinhas: paintLetters, jogos: paintGames })[us.section]();
  if (us.section === "jogos") loadScore();
}

// Um item do menu (ou o "Joguinhos" do clipe de anexar): abre aquela parte.
document.addEventListener("click", (event) => {
  const open = event.target.closest("[data-us-open]");
  if (!open) return;
  closeAttach();
  const changed = tab === "us" && open.dataset.usOpen !== us.section;
  goUs(open.dataset.usOpen);
  if (!changed) return;
  usScroll.scrollTop = 0;
  fx.view(usView.querySelector(`[data-pane="${us.section}"]`), 1);
  sound.play("tap");
});

// No Nosso cantinho, Esc volta para a conversa (a não ser que uma janela esteja aberta: aí o Esc é dela).
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || tab !== "us" || document.querySelector(".modal:not(.hidden), .viewer:not(.hidden)")) return;
  event.stopPropagation();
  showTab("chat");
}, true);

// ---- hoje: o dia de cada um ----

const myDay = () => us.days.get(us.day)?.[me] || null;

function paintToday() {
  us.day ||= todayKey();
  $("#day-label").textContent = dayName(us.day);
  $("#day-date").textContent = fullDate(us.day);
  $("#day-next").disabled = us.day >= todayKey();
  const days = us.days.get(us.day);
  if (days) {
    const names = Object.keys(days).sort((a, b) => (a === me ? -1 : b === me ? 1 : 0));
    $("#day-cards").replaceChildren(...names.map((name) => dayCard(days[name])));
  } else {
    $("#day-cards").replaceChildren(emptyNote(socket?.connected ? "Carregando…" : "Sem conexão agora."));
    loadDay(us.day);
  }
  paintPromptsState();
}

// O cartão de uma pessoa. No seu, cada linha abre o formulário dela; no da outra pessoa, só dá para ver (e ampliar as fotos).
function dayCard(data) {
  const mine = data.owner === me;
  const card = el("article", `day-card${mine ? " mine" : ""}`);
  const head = el("header", "day-head");
  const face = el("span", "avatar");
  paintAvatar(face, data.owner);
  const name = el("div", "day-who");
  const since = data.updatedAt ? `atualizado ${dayName(isoDay(new Date(data.updatedAt))).toLowerCase() === "hoje" ? "" : `${shortDate(isoDay(new Date(data.updatedAt)))} `}às ${time(data.updatedAt)}` : mine ? "Conte como está sendo o seu dia" : "Ainda não contou nada";
  name.append(el("strong", "", mine ? "Você" : data.owner), el("small", "", since));
  const feeling = MOOD_INFO[data.mood];
  const mood = el(mine ? "button" : "span", `mood${feeling ? "" : " is-empty"}`);
  mood.append(icon(feeling?.icon || "smile"));
  if (feeling) mood.dataset.mood = data.mood;
  mood.title = feeling ? feeling.label : "Como você está?";
  if (mine) {
    mood.type = "button";
    mood.dataset.dayEdit = "mood";
    mood.setAttribute("aria-label", feeling ? `Humor: ${feeling.label}. Trocar` : "Contar como você está");
  } else if (!feeling) mood.classList.add("hidden");
  head.append(face, name, mood);
  card.append(head);

  const rows = el("div", "day-rows");
  rows.append(dayRow({ edit: "wake", iconName: "sunrise", tone: "acordar", label: "Acordou", value: data.wake ? `às ${data.wake}` : "", empty: mine ? "Que horas você acordou?" : "—", mine }));
  for (const [key, iconName, label] of MEALS) {
    const meal = data.meals?.[key];
    rows.append(dayRow({ edit: "meal", meal: key, iconName, tone: key, label, value: meal?.text || (meal?.photo ? "Foto" : ""), empty: mine ? "Contar…" : "—", mine, photo: meal?.photo, at: meal?.at }));
  }
  card.append(rows, habitsBox(data, mine), momentsBox(data, mine));

  const note = el(mine ? "button" : "div", `day-note${data.note ? "" : " is-empty"}`);
  if (mine) {
    note.type = "button";
    note.dataset.dayEdit = "note";
  }
  const noteLabel = el("small");
  noteLabel.append(icon("book-open"), "Como foi o dia");
  note.append(noteLabel, el("p", "", data.note || (mine ? "Escrever…" : "—")));
  card.append(note);
  return card;
}

function dayRow({ edit, meal, iconName, tone, label, value, empty, mine, photo, at }) {
  const row = el(mine ? "button" : "div", `day-row${value ? "" : " is-empty"}`);
  if (mine) {
    row.type = "button";
    row.dataset.dayEdit = edit;
    if (meal) row.dataset.meal = meal;
  }
  const text = el("span", "row-text");
  text.append(el("small", "", at ? `${label} · ${time(at)}` : label), el("span", "row-value", value || empty));
  row.append(iconBadge(iconName, `row-icon tone-${tone}`), text);
  if (photo) {
    const image = el("img", "row-photo");
    image.src = photo.url;
    image.alt = `Foto: ${label}`;
    image.loading = "lazy";
    image.dataset.photo = photo.url;
    row.append(image);
  } else if (mine) {
    row.append(icon(value ? "pencil" : "plus", "icon row-go"));
  }
  return row;
}

function habitsBox(data, mine) {
  const habits = us.habits[data.owner] || [];
  const box = el("div", "day-box habits");
  const head = el("div", "box-head");
  head.append(iconBadge("list-checks", "row-icon tone-rotina"), el("strong", "", "Rotina"));
  if (habits.length) {
    const done = habits.filter((habit) => data.done.includes(habit.id)).length;
    const count = el("span", `habits-count${done === habits.length ? " full" : ""}`, `${done}/${habits.length}`);
    count.style.setProperty("--p", done / habits.length);
    head.append(count);
  }
  if (mine) {
    const edit = el("button", "text-button box-edit", habits.length ? "Editar" : "Montar");
    edit.type = "button";
    edit.dataset.dayEdit = "habits";
    head.append(edit);
  }
  box.append(head);
  if (!habits.length) {
    box.append(el("p", "box-empty", mine ? "Monte a sua rotina: beber água, academia, estudar, tomar o remédio…" : `${data.owner} ainda não montou a rotina.`));
    return box;
  }
  const list = el("div", "habit-list");
  for (const habit of habits) {
    const on = data.done.includes(habit.id);
    const chip = el(mine ? "button" : "span", `habit${on ? " done" : ""}`);
    if (mine) {
      chip.type = "button";
      chip.dataset.habit = habit.id;
      chip.setAttribute("aria-pressed", String(on));
    }
    chip.append(icon(on ? "check-circle" : "circle", "icon habit-check"), el("span", "", habit.text));
    list.append(chip);
  }
  box.append(list);
  return box;
}

function momentsBox(data, mine) {
  const box = el("div", "day-box moments");
  const head = el("div", "box-head");
  head.append(iconBadge("camera", "row-icon tone-momentos"), el("strong", "", "Momentos do dia"));
  box.append(head);
  if (!data.moments.length && !mine) {
    box.append(el("p", "box-empty", "Sem fotos ainda."));
    return box;
  }
  const strip = el("div", "moment-strip");
  data.moments.forEach((moment, index) => {
    const figure = el("figure", "moment");
    const image = el("img");
    image.src = moment.photo.url;
    image.alt = moment.text || "Momento do dia";
    image.loading = "lazy";
    image.dataset.photo = moment.photo.url;
    figure.append(image);
    if (moment.text) figure.append(el("figcaption", "", moment.text));
    if (mine) {
      const remove = el("button", "moment-remove");
      remove.type = "button";
      remove.dataset.momentRemove = String(index);
      remove.title = "Tirar a foto";
      remove.setAttribute("aria-label", "Tirar a foto");
      remove.append(icon("x"));
      figure.append(remove);
    }
    strip.append(figure);
  });
  if (mine && data.moments.length < 8) {
    const add = el("button", "moment add");
    add.type = "button";
    add.dataset.dayEdit = "moment";
    add.append(icon("camera"), el("span", "", "Foto"));
    strip.append(add);
  }
  box.append(strip);
  return box;
}

$("#day-cards").addEventListener("click", (event) => {
  const photo = event.target.closest("[data-photo]");
  if (photo) return openViewer({ url: photo.dataset.photo, name: "foto.jpg" });
  if (!event.target.closest(".day-card.mine")) return;
  const habit = event.target.closest("[data-habit]");
  if (habit) return toggleHabit(habit.dataset.habit);
  const remove = event.target.closest("[data-moment-remove]");
  if (remove) return removeMoment(Number(remove.dataset.momentRemove));
  const edit = event.target.closest("[data-day-edit]");
  if (!edit) return;
  sound.play("tap");
  ({ wake: editWake, meal: () => editMeal(edit.dataset.meal), mood: editMood, note: editNote, habits: editHabits, moment: addMoment })[edit.dataset.dayEdit]?.();
});

$("#day-prev").addEventListener("click", () => {
  us.day = shiftDay(us.day, -1);
  paintToday();
  sound.play("tap");
});

$("#day-next").addEventListener("click", () => {
  if (us.day >= todayKey()) return;
  us.day = shiftDay(us.day, 1);
  paintToday();
  sound.play("tap");
});

// Muda só o que veio (wake, meal, done, mood, note ou moments) no dia aberto; a outra pessoa vê na hora.
async function saveDay(patch) {
  const day = us.day;
  const result = await usCall({ op: "day:save", day, ...patch });
  if (!result) {
    loadDay(day);
    return null;
  }
  const days = us.days.get(day);
  if (days) days[me] = result.item;
  if (tab === "us" && us.section === "hoje") paintToday();
  return result.item;
}

// Foto do Nosso cantinho: reduzida como as do chat e enviada pelo mesmo caminho (api.php?action=upload).
async function uploadPhoto(file) {
  if (!socket) throw new Error("Sem conexão agora.");
  const { blob } = await preparePhoto(file);
  if (fileMax && blob.size > fileMax) throw new Error(`Foto grande demais (máximo de ${formatSize(fileMax)}).`);
  const uploaded = await uploadBlob(blob, "foto.jpg", "A foto não subiu. Tente de novo.");
  if (uploaded.kind !== "image") throw new Error("Escolha uma foto (JPG, PNG, WEBP ou GIF).");
  return uploaded;
}

// Áudio de cartinha (gravado ou escolhido): sobe inteiro, pelo mesmo caminho.
async function uploadAudio(blob) {
  if (!socket) throw new Error("Sem conexão agora.");
  if (fileMax && blob.size > fileMax) throw new Error(`Áudio grande demais (máximo de ${formatSize(fileMax)}).`);
  const uploaded = await uploadBlob(blob, "audio", "O áudio não subiu. Tente de novo.");
  if (uploaded.kind !== "audio" && uploaded.kind !== "video") throw new Error("Esse formato de áudio não deu. Use MP3, M4A, OGG ou WAV.");
  return uploaded;
}

async function uploadBlob(blob, name, failure) {
  const response = await fetch(apiUrl("upload"), {
    method: "POST",
    headers: { "Content-Type": blob.type || "application/octet-stream", "X-Potato-Token": socket.auth.token, "X-Potato-Name": encodeURIComponent(blob.name || name) },
    body: blob
  }).catch(() => null);
  const result = await response?.json().catch(() => null);
  if (!response?.ok || !result?.ok) throw new Error(result?.error || failure);
  return result.file;
}

async function toggleHabit(id) {
  const day = myDay();
  if (!day) return;
  const done = day.done.includes(id) ? day.done.filter((item) => item !== id) : [...day.done, id];
  const habits = us.habits[me] || [];
  // Marca na hora, sem esperar o servidor.
  us.days.get(us.day)[me] = { ...day, done };
  paintToday();
  sound.play(done.length > day.done.length ? "react" : "tap");
  const saved = await saveDay({ done });
  if (saved && done.length > day.done.length && habits.every((habit) => saved.done.includes(habit.id))) {
    toast("Rotina completinha!", "ok", "list-checks");
    fx.confetti(60);
  }
}

function editWake() {
  const day = myDay();
  openSheet({
    title: "Que horas você acordou?",
    icon: "sunrise",
    fields: [{ name: "wake", type: "time", label: "Acordei às", value: day?.wake || (us.day === todayKey() ? nowClock() : "07:00") }],
    onSubmit: async ({ wake }) => Boolean(await saveDay({ wake })),
    onDelete: day?.wake ? async () => Boolean(await saveDay({ wake: null })) : null,
    deleteLabel: "Limpar"
  });
}

function editMeal(key) {
  const info = MEAL_INFO[key];
  const meal = myDay()?.meals?.[key];
  openSheet({
    title: info.label,
    icon: info.icon,
    fields: [
      { name: "text", type: "text", label: "O que foi?", value: meal?.text, placeholder: info.hint, max: 300 },
      { name: "photo", type: "photo", label: "Foto do prato", value: meal?.photo }
    ],
    onSubmit: async ({ text, photo }) => {
      if (!text && !photo) throw new Error("Conte o que foi ou ponha uma foto.");
      const ref = photo?.file ? await uploadPhoto(photo.file) : photo;
      const saved = await saveDay({ meal: { name: key, text, photo: ref ? { key: ref.key } : null } });
      if (saved) sound.play("sparkle");
      return Boolean(saved);
    },
    onDelete: meal ? async () => Boolean(await saveDay({ meal: { name: key } })) : null
  });
}

function editMood() {
  const day = myDay();
  openSheet({
    title: "Como você está?",
    icon: MOOD_INFO[day?.mood]?.icon || "smile",
    submit: null,
    fields: [{ name: "mood", type: "chips", instant: true, value: day?.mood || null, options: MOODS.map(([key, iconName, label]) => [key, label, `mood-${key}`, iconName]) }],
    onSubmit: async ({ mood }) => Boolean(await saveDay({ mood })),
    onDelete: day?.mood ? async () => Boolean(await saveDay({ mood: null })) : null,
    deleteLabel: "Limpar"
  });
}

function editNote() {
  openSheet({
    title: "Como foi o dia?",
    icon: "book-open",
    fields: [{ name: "note", type: "textarea", value: myDay()?.note, placeholder: "Conta um pouquinho…", max: 2000, rows: 5 }],
    onSubmit: async ({ note }) => Boolean(await saveDay({ note }))
  });
}

function editHabits() {
  openSheet({
    title: "Sua rotina",
    icon: "list-checks",
    fields: [
      { name: "about", type: "info", text: "As coisinhas que você quer fazer todo dia. Toque em cada uma quando fizer: a outra pessoa vê o seu progresso." },
      { name: "habits", type: "list", value: us.habits[me] || [], placeholder: "Beber água, academia, estudar…", limit: 12, max: 60, add: "Adicionar" }
    ],
    onSubmit: async ({ habits }) => {
      const result = await usCall({ op: "habits", habits });
      if (!result) return false;
      us.habits[me] = result.habits;
      paintToday();
      return true;
    }
  });
}

function addMoment() {
  openSheet({
    title: "Momento do dia",
    icon: "camera",
    fields: [
      { name: "photo", type: "photo", label: "Foto", value: null, pickNow: true },
      { name: "text", type: "text", label: "Legenda", placeholder: "O que estava rolando?", max: 200 }
    ],
    onSubmit: async ({ photo, text }) => {
      if (!photo?.file) throw new Error("Escolha uma foto.");
      const ref = await uploadPhoto(photo.file);
      const moments = (myDay()?.moments || []).map((moment) => ({ photo: { key: moment.photo.key }, text: moment.text }));
      return Boolean(await saveDay({ moments: [...moments, { photo: { key: ref.key }, text }] }));
    }
  });
}

async function removeMoment(index) {
  if (!await confirmDialog({ title: "Tirar essa foto?", text: "Ela sai do seu dia para os dois.", confirm: "Tirar" })) return;
  const moments = (myDay()?.moments || []).filter((moment, position) => position !== index).map((moment) => ({ photo: { key: moment.photo.key }, text: moment.text }));
  saveDay({ moments });
}

function paintPromptsState() {
  const on = PROMPT_LABELS.filter(([key]) => us.prompts[key]).map(([key, , , short]) => `${short} ${us.prompts[key]}`);
  $("#prompts-state").textContent = on.length ? on.join(" · ") : "Desligados";
}

$("#prompts-open").addEventListener("click", () => openSheet({
  title: "Lembretes da rotina",
  icon: "bell",
  fields: [
    { name: "about", type: "info", text: inAndroid ? "Na hora marcada chega uma notificação perguntando, e dá para responder nela mesma, sem abrir o app. Só pergunta o que você ainda não contou." : "Na hora marcada, o site pergunta aqui mesmo (no app do celular, chega uma notificação que dá para responder sem abrir o app). Só pergunta o que você ainda não contou." },
    { name: "prompts", type: "prompt", value: us.prompts }
  ],
  onSubmit: async ({ prompts }) => {
    const result = await usCall({ op: "prompts", prompts });
    if (!result) return false;
    us.prompts = result.prompts;
    paintPromptsState();
    loadSchedule();
    toast("Lembretes salvos", "ok", "bell");
    return true;
  }
}));

// ---- agenda dos dois ----

// O compromisso acontece nesse dia? Toda semana, todo mês (dia 31 cai no último dia dos meses curtos) ou todo ano.
// (Mesma regra do event_on em lib/potato.php.)
function occursOn(event, day) {
  if (day === event.date) return true;
  if (!event.repeat || event.repeat === "none" || day < event.date) return false;
  const date = dayDate(day);
  const start = dayDate(event.date);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  if (event.repeat === "weekly") return date.getDay() === start.getDay();
  if (event.repeat === "monthly") return date.getDate() === Math.min(start.getDate(), last);
  return event.repeat === "yearly" && date.getMonth() === start.getMonth() && date.getDate() === Math.min(start.getDate(), last);
}

// No mesmo dia: primeiro o que é o dia inteiro, depois pela hora.
const eventsOn = (day) => us.events.filter((event) => occursOn(event, day)).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
const eventHours = (event) => (event.time ? `${event.time}${event.end ? ` – ${event.end}` : ""}` : "Dia inteiro");
const clockMinutes = (clock) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
const minutesClock = (minutes) => `${pad2(Math.floor(minutes / 60) % 24)}:${pad2(minutes % 60)}`;
// A semana começa no domingo, como no calendário da parede.
const weekStart = (day) => shiftDay(day, -dayDate(day).getDay());
const CAL_VIEWS = ["day", "week", "month", "list"];
const CAL_VIEW_KEY = "potato.calView";
const CAL_HIDDEN_KEY = "potato.calHidden";
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const HOUR_HEIGHT = 48;
// Cada agenda tem a sua cor, a mesma para os dois: a dos dois e a de cada pessoa (na ordem das contas).
const BOTH_COLOR = "#e8608a";
const PERSON_COLORS = ["#4c8bf5", "#33b679"];
const calColor = (who) => (who === "ambos" ? BOTH_COLOR : PERSON_COLORS[Math.max(0, presenceList.findIndex((user) => user.name === who))] || PERSON_COLORS[0]);
const savedView = store.get("localStorage", CAL_VIEW_KEY);
let calView = CAL_VIEWS.includes(savedView) ? savedView : matchMedia("(max-width: 760px)").matches ? "list" : "month";
// Agendas escondidas (desmarcadas na lista "Agendas"), só neste aparelho.
const hiddenCals = new Set(store.get("localStorage", CAL_HIDDEN_KEY) || []);
const shownOn = (day) => eventsOn(day).filter((event) => !hiddenCals.has(event.who));
// Mês aberto no mini calendário (anda sozinho pelas setinhas dele).
let miniMonth = "";
const monthName = (date, options = { month: "long", year: "numeric" }) => capitalize(new Intl.DateTimeFormat("pt-BR", options).format(date));

function paintAgenda() {
  us.calDay ||= todayKey();
  us.month ||= us.calDay.slice(0, 7);
  usView.querySelectorAll("[data-cal-view]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.calView === calView)));
  $("#cal-body").dataset.view = calView;
  ({ day: () => paintTimeGrid(1), week: () => paintTimeGrid(7), month: paintMonth, list: paintList })[calView]();
  paintMiniCal();
  paintLegend();
  paintUpcoming();
  paintSideAgenda();
}

function setCalView(view) {
  calView = view;
  store.set("localStorage", CAL_VIEW_KEY, view);
  closeEventPop();
  paintAgenda();
  fx.view($("#cal-body"), 1);
  sound.play("tap");
}

// Mostra um dia (no dia, na semana, no mês ou na lista que estiver aberta).
function goCalDay(day) {
  us.calDay = day;
  us.month = day.slice(0, 7);
  miniMonth = us.month;
  paintAgenda();
}

// ---- mês ----

// O mês inteiro em semanas; em cada dia, os compromissos: os do dia inteiro numa faixa colorida, os com hora com a
// bolinha da cor da agenda. Mais de três: "+2 mais", que abre o dia.
function paintMonth() {
  const [year, month] = us.month.split("-").map(Number);
  const first = new Date(year, month - 1, 1, 12);
  $("#cal-month").textContent = monthName(first);
  const start = shiftDay(isoDay(first), -first.getDay());
  const weeks = Math.ceil((first.getDay() + new Date(year, month, 0).getDate()) / 7);
  const grid = el("div", "month-grid");
  grid.style.setProperty("--weeks", weeks);
  grid.append(...WEEKDAYS.map((name) => el("span", "month-weekday", name)));
  for (let index = 0; index < weeks * 7; index += 1) {
    const day = shiftDay(start, index);
    const date = dayDate(day);
    const events = shownOn(day);
    const cell = el("div", "month-cell");
    cell.dataset.day = day;
    cell.classList.toggle("other", day.slice(0, 7) !== us.month);
    cell.classList.toggle("today", day === todayKey());
    cell.classList.toggle("selected", day === us.calDay);
    const number = el("button", "month-number", date.getDate() === 1 ? `1 de ${new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(date).replace(".", "")}` : String(date.getDate()));
    number.type = "button";
    number.dataset.goDay = day;
    number.setAttribute("aria-label", `${fullDate(day)}${events.length ? `, ${events.length} ${events.length === 1 ? "compromisso" : "compromissos"}` : ""}. Abrir o dia`);
    const list = el("div", "month-events");
    const room = events.length > 3 ? 2 : 3;
    for (const event of events.slice(0, room)) list.append(calChip(event, day));
    if (events.length > room) {
      const more = el("button", "month-more", `+${events.length - room} mais`);
      more.type = "button";
      more.dataset.goDay = day;
      list.append(more);
    }
    cell.append(number, list);
    grid.append(cell);
  }
  $("#cal-body").replaceChildren(grid);
}

function calChip(event, day) {
  const chip = el("button", `cal-chip${event.time ? "" : " all-day"}`);
  chip.type = "button";
  chip.dataset.event = event.id;
  chip.dataset.day = day;
  chip.style.setProperty("--ev", calColor(event.who));
  chip.title = `${eventHours(event)} · ${event.title}`;
  if (event.time) chip.append(el("i", "chip-dot"), el("span", "chip-time", event.time));
  chip.append(el("span", "chip-title", event.title));
  return chip;
}

// Já passou? (Os próximos, ao lado do calendário, começam do que ainda não passou.)
function isPast(event, day) {
  if (day !== todayKey()) return day < todayKey();
  return Boolean(event.time) && clockMinutes(event.end || minutesClock(clockMinutes(event.time) + 60)) <= clockMinutes(nowClock());
}

// ---- dia e semana ----

// Os dias lado a lado com a grade das 24 horas: cada compromisso é um bloco do tamanho que dura (sem hora de acabar,
// uma hora); os que se cruzam dividem a coluna. Hoje tem a linha vermelha da hora atual. Tocar num horário vazio marca ali.
function paintTimeGrid(count) {
  const first = count === 7 ? weekStart(us.calDay) : us.calDay;
  const days = Array.from({ length: count }, (_, index) => shiftDay(first, index));
  $("#cal-month").textContent = count === 1 ? capitalize(fullDate(us.calDay)) : weekTitle(days[0], days[6]);
  const grid = el("div", `time-grid days-${count}`);
  grid.style.setProperty("--days", count);
  const offset = -new Date().getTimezoneOffset() / 60;
  grid.append(el("span", "tg-corner", `GMT${offset < 0 ? "-" : "+"}${pad2(Math.abs(offset))}`));
  for (const day of days) {
    const head = el("button", `tg-day${day === todayKey() ? " today" : ""}${day < todayKey() ? " past" : ""}`);
    head.type = "button";
    head.dataset.goDay = day;
    head.setAttribute("aria-label", `${fullDate(day)}. Abrir o dia`);
    head.append(el("small", "", WEEKDAYS[dayDate(day).getDay()]), el("strong", "", String(dayDate(day).getDate())));
    grid.append(head);
  }
  grid.append(el("span", "tg-label", "dia inteiro"));
  for (const day of days) {
    const cell = el("div", "tg-allday");
    cell.dataset.day = day;
    for (const event of shownOn(day).filter((item) => !item.time)) cell.append(calChip(event, day));
    grid.append(cell);
  }
  const hours = el("div", "tg-hours");
  for (let hour = 0; hour < 24; hour += 1) hours.append(el("span", "", hour ? `${pad2(hour)}:00` : ""));
  grid.append(hours);
  for (const day of days) {
    const column = el("div", `tg-column${day === todayKey() ? " today" : ""}`);
    column.dataset.day = day;
    for (const { event, start, end, lane, lanes } of layoutDay(shownOn(day).filter((item) => item.time))) {
      const block = el("button", `tg-event${end - start < 45 ? " short" : ""}`);
      block.type = "button";
      block.dataset.event = event.id;
      block.dataset.day = day;
      block.style.setProperty("--ev", calColor(event.who));
      block.style.top = `${start / 60 * HOUR_HEIGHT}px`;
      block.style.height = `${Math.max(20, (end - start) / 60 * HOUR_HEIGHT - 2)}px`;
      const share = 100 / lanes;
      const width = lane < lanes - 1 ? Math.min(100 - lane * share, share * 1.7) : share;
      block.style.left = `calc(${lane * share}% + 1px)`;
      block.style.width = `calc(${width}% - ${lanes > 1 ? 3 : 8}px)`;
      block.style.zIndex = String(1 + lane);
      block.title = `${eventHours(event)} · ${event.title}${event.place ? ` · ${event.place}` : ""}`;
      block.append(el("strong", "", event.title), el("small", "", `${eventHours(event)}${event.place ? ` · ${event.place}` : ""}`));
      column.append(block);
    }
    if (day === todayKey()) {
      const line = el("i", "tg-now");
      line.style.top = `${clockMinutes(nowClock()) / 60 * HOUR_HEIGHT}px`;
      column.append(line);
    }
    grid.append(column);
  }
  const scroll = el("div", "tg-scroll");
  scroll.append(grid);
  $("#cal-body").replaceChildren(scroll);
  // Começa perto da hora atual (ou das 7h30).
  const focus = days.includes(todayKey()) ? clockMinutes(nowClock()) / 60 - 2 : 7.5;
  scroll.scrollTop = Math.max(0, focus * HOUR_HEIGHT);
  // No celular, a semana não cabe: rola para o lado até o dia escolhido.
  const chosen = [...grid.querySelectorAll(".tg-day")].find((head) => head.dataset.goDay === us.calDay);
  if (chosen && scroll.scrollWidth > scroll.clientWidth) {
    const left = chosen.getBoundingClientRect().left - scroll.getBoundingClientRect().left + scroll.scrollLeft;
    scroll.scrollLeft = Math.max(0, left - 56 - (scroll.clientWidth - 56 - chosen.offsetWidth) / 2);
  }
}

function weekTitle(first, last) {
  const a = dayDate(first);
  const b = dayDate(last);
  // No celular, o curtinho ("18 – 24 out"): o completo não cabe ao lado das setas.
  if (matchMedia("(max-width: 760px)").matches) {
    const short = (date) => new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(date).replace(".", "");
    return a.getMonth() === b.getMonth() ? `${a.getDate()} – ${b.getDate()} ${short(b)}` : `${a.getDate()} ${short(a)} – ${b.getDate()} ${short(b)}`;
  }
  if (a.getMonth() === b.getMonth()) return `${a.getDate()} – ${b.getDate()} de ${new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(b)}`;
  const short = (date) => `${date.getDate()} de ${monthName(date, { month: "short" }).replace(".", "").toLowerCase()}`;
  return `${short(a)} – ${short(b)} de ${b.getFullYear()}`;
}

// Compromissos com hora no mesmo dia: os que se cruzam ficam em faixas lado a lado (lane de lanes).
function layoutDay(events) {
  const items = events.map((event) => {
    const start = clockMinutes(event.time);
    return { event, start, end: Math.min(24 * 60, Math.max(start + 30, event.end ? clockMinutes(event.end) : start + 60)) };
  }).sort((a, b) => a.start - b.start);
  const placed = [];
  let group = [];
  let groupEnd = -1;
  const close = () => {
    const lanes = [];
    for (const item of group) {
      let lane = lanes.findIndex((end) => end <= item.start);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = item.end;
      item.lane = lane;
    }
    for (const item of group) item.lanes = lanes.length;
    placed.push(...group);
    group = [];
  };
  for (const item of items) {
    if (item.start >= groupEnd) close();
    group.push(item);
    groupEnd = Math.max(groupEnd, item.end);
  }
  close();
  return placed;
}

// ---- lista ----

// Os próximos dois meses, dia por dia (só os dias com compromisso), como a "programação" dos calendários.
function paintList() {
  const start = us.calDay;
  $("#cal-month").textContent = monthName(dayDate(start));
  const wrap = el("div", "cal-list");
  for (let offset = 0; offset < 62; offset += 1) {
    const day = shiftDay(start, offset);
    const events = shownOn(day);
    if (!events.length) continue;
    const date = dayDate(day);
    const group = el("div", `list-day${day === todayKey() ? " today" : ""}`);
    const label = el("button", "list-date");
    label.type = "button";
    label.dataset.goDay = day;
    label.append(el("strong", "", String(date.getDate())), el("small", "", `${monthName(date, { month: "short" }).replace(".", "")}, ${WEEKDAYS[date.getDay()].toLowerCase()}`));
    const items = el("div", "list-events");
    for (const event of events) {
      const row = el("button", "list-event");
      row.type = "button";
      row.dataset.event = event.id;
      row.dataset.day = day;
      row.style.setProperty("--ev", calColor(event.who));
      const text = el("span", "list-what");
      text.append(el("strong", "", event.title));
      if (event.place) text.append(el("small", "", event.place));
      row.append(el("i", "chip-dot"), el("span", "list-time", eventHours(event)), text);
      if (event.repeat !== "none") row.append(icon("repeat", "icon list-flag"));
      items.append(row);
    }
    group.append(label, items);
    wrap.append(group);
  }
  if (!wrap.children.length) wrap.append(emptyNote("Nada marcado nos próximos dois meses."));
  $("#cal-body").replaceChildren(wrap);
}

// ---- ao lado: mini calendário, agendas e próximos ----

function paintMiniCal() {
  miniMonth ||= us.calDay.slice(0, 7);
  const [year, month] = miniMonth.split("-").map(Number);
  const first = new Date(year, month - 1, 1, 12);
  const start = shiftDay(isoDay(first), -first.getDay());
  const week = calView === "week" ? weekStart(us.calDay) : "";
  const head = el("div", "mini-head");
  const arrow = (step, name, label) => {
    const button = el("button", "mini-arrow");
    button.type = "button";
    button.dataset.mini = String(step);
    button.setAttribute("aria-label", label);
    button.append(icon(name));
    return button;
  };
  head.append(el("strong", "", monthName(first)), arrow(-1, "chevron-left", "Mês anterior"), arrow(1, "chevron-right", "Próximo mês"));
  const grid = el("div", "mini-grid");
  grid.append(...["D", "S", "T", "Q", "Q", "S", "S"].map((letter) => el("span", "mini-weekday", letter)));
  for (let index = 0; index < 42; index += 1) {
    const day = shiftDay(start, index);
    const button = el("button", "mini-day", String(dayDate(day).getDate()));
    button.type = "button";
    button.dataset.pickDay = day;
    button.classList.toggle("other", day.slice(0, 7) !== miniMonth);
    button.classList.toggle("today", day === todayKey());
    button.classList.toggle("selected", day === us.calDay);
    button.classList.toggle("in-week", Boolean(week) && day >= week && day <= shiftDay(week, 6));
    button.classList.toggle("has", shownOn(day).length > 0);
    button.setAttribute("aria-label", fullDate(day));
    grid.append(button);
  }
  $("#mini-cal").replaceChildren(head, grid);
}

// As agendas e as cores delas: ao lado do calendário e, no celular, numa fileira em cima dele. Tocar mostra ou esconde.
function paintLegend() {
  const cals = [["ambos", "Dos dois"], ...presenceList.map((user) => [user.name, user.name === me ? `${user.name} (você)` : user.name])];
  for (const box of [$("#cal-legend"), $("#cal-legend-top")]) box.replaceChildren(...cals.map(([key, label]) => {
    const row = el("button", "legend-row");
    row.type = "button";
    row.dataset.cal = key;
    row.setAttribute("aria-pressed", String(!hiddenCals.has(key)));
    row.style.setProperty("--ev", calColor(key));
    const box = el("span", "legend-box");
    box.append(icon("check"));
    row.append(box, el("span", "", label));
    return row;
  }));
}

function paintUpcoming() {
  const upcoming = [];
  for (let offset = 0; offset < 120 && upcoming.length < 6; offset += 1) {
    const day = shiftDay(todayKey(), offset);
    for (const event of shownOn(day)) if (upcoming.length < 6 && !isPast(event, day)) upcoming.push([event, day]);
  }
  $("#cal-next-list").replaceChildren(...(upcoming.length ? upcoming.map(([event, day]) => {
    const row = el("button", "up-row");
    row.type = "button";
    row.dataset.event = event.id;
    row.dataset.day = day;
    row.style.setProperty("--ev", calColor(event.who));
    const when = day === todayKey() ? "Hoje" : day === shiftDay(todayKey(), 1) ? "Amanhã" : capitalize(new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "numeric", month: "short" }).format(dayDate(day)).replace(/\./g, ""));
    row.append(el("strong", "", event.title), el("small", "", `${when} · ${eventHours(event)}`));
    return row;
  }) : [el("p", "up-empty", "Nada marcado por enquanto.")]));
}

// ---- detalhes do compromisso ----

const eventPop = $("#event-pop");
// Compromisso aberto no cartãozinho ({ event, day }).
let popped = null;

function openEventPop(event, day, anchor) {
  popped = { event, day };
  eventPop.style.setProperty("--ev", calColor(event.who));
  setIcon($("#pop-icon"), event.icon || "calendar");
  $("#pop-title").textContent = event.title;
  $("#pop-when").textContent = `${capitalize(fullDate(day))} · ${eventHours(event)}`;
  const detail = (iconName, text) => {
    const item = el("li");
    item.append(icon(iconName), el("span", "", text));
    return item;
  };
  const details = [detail("users", event.who === "ambos" ? "Agenda dos dois" : event.who === me ? "Sua agenda" : `Agenda de ${event.who}`)];
  if (event.place) details.push(detail("map-pin", event.place));
  if (event.repeat !== "none") details.push(detail("repeat", REPEAT_LABEL[event.repeat]));
  if (event.remind !== null) details.push(detail("bell", REMIND_OPTIONS.find(([value]) => value === event.remind)?.[1] || "Com lembrete"));
  if (event.note) details.push(detail("book-open", event.note));
  $("#pop-details").replaceChildren(...details);
  eventPop.classList.remove("hidden");
  // No computador, ao lado do compromisso (cabendo na tela); no celular, sobe de baixo (styles.css).
  if (!matchMedia("(max-width: 760px)").matches) {
    const box = anchor.getBoundingClientRect();
    const width = eventPop.offsetWidth;
    const height = eventPop.offsetHeight;
    const left = box.right + 12 + width < innerWidth ? box.right + 12 : Math.max(12, box.left - 12 - width);
    eventPop.style.left = `${left}px`;
    eventPop.style.top = `${Math.min(innerHeight - height - 12, Math.max(12, box.top + box.height / 2 - height / 2))}px`;
  }
  fx.show(eventPop, { y: 10, scale: 0.96 });
  document.addEventListener("keydown", onPopKey, true);
}

function closeEventPop() {
  if (!popped) return;
  popped = null;
  eventPop.classList.add("hidden");
  eventPop.style.left = eventPop.style.top = "";
  document.removeEventListener("keydown", onPopKey, true);
}

function onPopKey(event) {
  if (event.key !== "Escape") return;
  event.stopPropagation();
  closeEventPop();
}

eventPop.addEventListener("click", async (event) => {
  const action = event.target.closest("[data-pop]")?.dataset.pop;
  if (!action || !popped) return;
  const { event: item, day } = popped;
  closeEventPop();
  if (action === "edit") editEvent(item, day);
  else if (action === "delete") {
    if (!await confirmDialog({ title: "Apagar o compromisso?", text: item.repeat === "none" ? "Ele some da agenda dos dois." : "Ele some da agenda dos dois, em todas as vezes que repete.", confirm: "Apagar" })) return;
    if (!await usCall({ op: "event:delete", id: item.id })) return;
    us.events = us.events.filter((entry) => entry.id !== item.id);
    paintAgenda();
    loadSchedule();
    toast("Compromisso apagado", "ok", "calendar");
  }
});

document.addEventListener("pointerdown", (event) => {
  if (popped && !event.target.closest("#event-pop, [data-event], #confirm")) closeEventPop();
}, true);

function editEvent(event = null, day = us.calDay || todayKey(), time = "19:00", end = "") {
  const people = presenceList.map((user) => user.name);
  openSheet({
    title: event ? "Compromisso" : "Novo compromisso",
    icon: event?.icon || "calendar",
    fields: [
      { name: "icon", type: "chips", iconOnly: true, value: event?.icon || "calendar", options: EVENT_ICONS.map(([name, label]) => [name, label, "", name]) },
      { name: "title", type: "text", label: "O que é?", value: event?.title, placeholder: "Cinema, jantar, consulta…", max: 120 },
      { name: "date", type: "date", label: "Dia", value: event?.date || day },
      { name: "time", type: "time", label: "Começa", value: event ? event.time : time, optional: "Dia inteiro", fallback: "19:00" },
      { name: "end", type: "time", label: "Termina", value: event ? event.end : end, optional: "Sem hora", fallback: "21:00" },
      { name: "place", type: "text", label: "Onde", value: event?.place, placeholder: "Opcional", max: 120 },
      { name: "who", type: "select", label: "Agenda", value: event?.who || "ambos", options: [["ambos", "Dos dois"], ...people.map((name) => [name, name === me ? "Minha" : `De ${name}`])] },
      { name: "repeat", type: "select", label: "Repetir", value: event?.repeat || "none", options: Object.entries(REPEAT_LABEL) },
      { name: "remind", type: "select", label: "Lembrete", numeric: true, value: event ? event.remind ?? "" : 60, options: REMIND_OPTIONS },
      { name: "note", type: "textarea", label: "Anotação", value: event?.note, placeholder: "Opcional", max: 1000, rows: 2 }
    ],
    onSubmit: async (values) => {
      if (!values.title) throw new Error("Dê um nome para o compromisso.");
      if (!values.date) throw new Error("Escolha o dia.");
      if (values.time && values.end && values.end <= values.time) throw new Error("A hora de terminar tem que ser depois da de começar.");
      const result = await usCall({ op: "event:save", id: event?.id, ...values });
      if (!result) return false;
      upsert(us.events, result.item);
      goCalDay(result.item.date);
      loadSchedule();
      if (!event) {
        toast("Marcado na agenda dos dois", "ok", "calendar");
        sound.play("sparkle");
      }
      return true;
    },
    onDelete: event ? async () => {
      if (!await confirmDialog({ title: "Apagar o compromisso?", text: "Ele some da agenda dos dois.", confirm: "Apagar" })) return false;
      if (!await usCall({ op: "event:delete", id: event.id })) return false;
      us.events = us.events.filter((item) => item.id !== event.id);
      paintAgenda();
      loadSchedule();
      return true;
    } : null
  });
}

// Tocar num compromisso abre os detalhes; no número do dia (ou no "+2 mais"), abre o dia; num horário vazio da semana
// ou do dia, marca ali; num dia do mês, escolhe o dia (tocar de novo marca nele).
$("#cal-body").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-event]");
  const item = chip && us.events.find((entry) => entry.id === chip.dataset.event);
  if (item) return openEventPop(item, chip.dataset.day, chip);
  const go = event.target.closest("[data-go-day]");
  if (go) {
    goCalDay(go.dataset.goDay);
    return setCalView("day");
  }
  const column = event.target.closest(".tg-column");
  if (column) {
    const minutes = Math.max(0, Math.floor((event.clientY - column.getBoundingClientRect().top) / HOUR_HEIGHT * 2) * 30);
    return editEvent(null, column.dataset.day, minutesClock(Math.min(minutes, 23 * 60)), minutesClock(Math.min(minutes + 60, 23 * 60 + 59)));
  }
  const cell = event.target.closest("[data-day]");
  if (!cell) return;
  if (cell.dataset.day === us.calDay) return editEvent(null, cell.dataset.day);
  goCalDay(cell.dataset.day);
  sound.play("tap");
});

for (const [id, step] of [["#cal-prev", -1], ["#cal-next", 1]]) {
  $(id).addEventListener("click", () => {
    if (calView === "month") {
      const [year, month] = us.month.split("-").map(Number);
      const date = new Date(year, month - 1 + step, 1, 12);
      us.month = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
      us.calDay = us.calDay.slice(0, 7) === us.month ? us.calDay : `${us.month}-01`;
      miniMonth = us.month;
      paintAgenda();
    } else {
      goCalDay(shiftDay(us.calDay, step * { day: 1, week: 7, list: 30 }[calView]));
    }
    sound.play("tap");
  });
}

$("#cal-today").addEventListener("click", () => {
  goCalDay(todayKey());
  sound.play("tap");
});

usView.querySelector(".cal-views").addEventListener("click", (event) => {
  const button = event.target.closest("[data-cal-view]");
  if (button && button.dataset.calView !== calView) setCalView(button.dataset.calView);
});

$("#mini-cal").addEventListener("click", (event) => {
  const arrow = event.target.closest("[data-mini]");
  if (arrow) {
    const [year, month] = miniMonth.split("-").map(Number);
    const date = new Date(year, month - 1 + Number(arrow.dataset.mini), 1, 12);
    miniMonth = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
    return paintMiniCal();
  }
  const day = event.target.closest("[data-pick-day]")?.dataset.pickDay;
  if (!day) return;
  goCalDay(day);
  sound.play("tap");
});

function toggleCal(event) {
  const row = event.target.closest("[data-cal]");
  if (!row) return;
  if (hiddenCals.has(row.dataset.cal)) hiddenCals.delete(row.dataset.cal);
  else hiddenCals.add(row.dataset.cal);
  store.set("localStorage", CAL_HIDDEN_KEY, [...hiddenCals]);
  paintAgenda();
  sound.play("tap");
}
$("#cal-legend").addEventListener("click", toggleCal);
$("#cal-legend-top").addEventListener("click", toggleCal);

$("#cal-next-list").addEventListener("click", (event) => {
  const row = event.target.closest("[data-event]");
  const item = row && us.events.find((entry) => entry.id === row.dataset.event);
  if (item) openEventPop(item, row.dataset.day, row);
});

for (const id of ["#event-add", "#event-fab"]) $(id).addEventListener("click", () => editEvent(null, us.calDay));

// ---- sonhos e metas ----

function paintGoals() {
  const open = us.goals.filter((goal) => !goal.done).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const done = us.goals.filter((goal) => goal.done).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
  $("#goal-list").replaceChildren(...(open.length ? open.map(goalCard) : [emptyNote("Nenhum sonho ainda. Qual vai ser o primeiro?")]));
  $("#goal-done").replaceChildren(...done.map(goalCard));
  $("#goal-done-title").classList.toggle("hidden", !done.length);
}

function goalCard(goal) {
  const card = el("article", `goal-card${goal.done ? " done" : ""}`);
  card.dataset.goal = goal.id;
  const head = el("header", "goal-head");
  const title = el("div", "goal-title");
  const subtitle = goal.done ? `Realizado em ${longDate(goal.doneAt)}` : goal.due ? `Até ${longDate(`${goal.due}T12:00:00`)}` : `Desde ${longDate(goal.createdAt)}`;
  title.append(el("strong", "", goal.title), el("small", "", subtitle));
  const edit = el("button", "nav-round small");
  edit.type = "button";
  edit.dataset.goalAction = "edit";
  edit.title = "Editar";
  edit.setAttribute("aria-label", `Editar ${goal.title}`);
  edit.append(icon("pencil"));
  head.append(iconBadge(goal.icon || "sparkles", "goal-emoji"), title, edit);
  card.append(head);
  if (goal.note) card.append(el("p", "goal-note", goal.note));
  if (goal.target || goal.saved) {
    const box = el("div", "goal-money");
    const ratio = goal.target ? Math.min(1, goal.saved / goal.target) : 0;
    const line = el("div", "goal-money-line");
    line.append(el("strong", "", money.format(goal.saved)), el("span", "", goal.target ? `de ${money.format(goal.target)}` : "guardados"));
    if (goal.target) line.append(el("b", "", `${Math.floor(ratio * 100)}%`));
    box.append(line);
    if (goal.target) {
      const bar = el("span", "goal-bar");
      bar.style.setProperty("--p", ratio);
      bar.append(el("i"));
      box.append(bar);
    }
    const last = goal.deposits?.[0];
    if (last) box.append(el("small", "goal-last", `${who(last.by)} ${last.amount < 0 ? "tirou" : "guardou"} ${money.format(Math.abs(last.amount))} · ${shortDate(isoDay(new Date(last.at)))}`));
    card.append(box);
  }
  if (goal.steps?.length) {
    const steps = el("div", "goal-steps");
    steps.append(el("small", "goal-steps-count", `Passos · ${goal.steps.filter((step) => step.done).length}/${goal.steps.length}`));
    for (const step of goal.steps) {
      const item = el("button", `goal-step${step.done ? " done" : ""}`);
      item.type = "button";
      item.dataset.step = step.id;
      item.setAttribute("aria-pressed", String(step.done));
      item.disabled = goal.done;
      item.append(el("span", "step-box"), el("span", "", step.text));
      steps.append(item);
    }
    card.append(steps);
  }
  const actions = el("div", "goal-actions");
  const action = (label, name, className, iconName) => {
    const button = el("button", className);
    button.type = "button";
    button.dataset.goalAction = name;
    if (iconName) button.append(icon(iconName));
    button.append(label);
    return button;
  };
  if (goal.done) actions.append(action("Ainda não realizamos", "undo", "text-button"));
  else actions.append(action("Guardar", "deposit", "pill ghost small", "piggy"), action("Realizamos!", "done", "pill gold small", "check"));
  card.append(actions);
  return card;
}

function editGoal(goal = null) {
  openSheet({
    title: goal ? "Sonho ou meta" : "Novo sonho ou meta",
    icon: goal?.icon || "sparkles",
    fields: [
      { name: "icon", type: "chips", iconOnly: true, value: goal?.icon || "sparkles", options: GOAL_ICONS.map(([name, label]) => [name, label, "", name]) },
      { name: "title", type: "text", label: "O que é?", value: goal?.title, placeholder: "Viagem para a praia, nossa casinha…", max: 120 },
      { name: "target", type: "money", label: "Quanto juntar", value: goal?.target, placeholder: "Opcional (ex.: 1.500,00)" },
      { name: "due", type: "date", label: "Até quando", value: goal?.due, hint: "Opcional" },
      { name: "steps", type: "list", label: "Passos", value: goal?.steps || [], placeholder: "Escolher o lugar, reservar…", limit: 20, max: 120, add: "Adicionar passo" },
      { name: "note", type: "textarea", label: "Anotação", value: goal?.note, placeholder: "Opcional", max: 1000, rows: 2 }
    ],
    onSubmit: async (values) => {
      if (!values.title) throw new Error("Dê um nome para o sonho.");
      const result = await usCall({ op: "goal:save", id: goal?.id, ...values, due: values.due || null });
      if (!result) return false;
      upsert(us.goals, result.item);
      paintGoals();
      if (!goal) {
        toast("Sonho anotado!", "ok", "sparkles");
        sound.play("sparkle");
      }
      return true;
    },
    onDelete: goal ? async () => {
      if (!await confirmDialog({ title: "Apagar esse sonho?", text: "Ele some para os dois, com o que foi guardado nele.", confirm: "Apagar" })) return false;
      if (!await usCall({ op: "goal:delete", id: goal.id })) return false;
      us.goals = us.goals.filter((item) => item.id !== goal.id);
      paintGoals();
      return true;
    } : null
  });
}

function depositGoal(goal) {
  openSheet({
    title: goal.title,
    icon: "piggy",
    fields: [
      { name: "way", type: "chips", value: "in", options: [["in", "Guardar", "", "piggy"], ["out", "Tirar", "", "arrow-left"]] },
      { name: "amount", type: "money", label: "Quanto", placeholder: "R$ 0,00", focus: true }
    ],
    onSubmit: async ({ way, amount }) => {
      if (!amount || amount <= 0) throw new Error("Diga quanto.");
      const result = await usCall({ op: "goal:deposit", id: goal.id, amount: way === "out" ? -amount : amount });
      if (!result) return false;
      const before = goal.saved;
      upsert(us.goals, result.item);
      paintGoals();
      if (way === "in" && result.item.target && before < result.item.target && result.item.saved >= result.item.target) {
        toast("Objetivo alcançado!", "ok", "sparkles");
        fx.confetti();
      } else if (way === "in") {
        toast(`${money.format(amount)} guardados`, "ok", "piggy");
        sound.play("sparkle");
      }
      return true;
    }
  });
}

async function finishGoal(goal, done) {
  const result = await usCall({ op: "goal:done", id: goal.id, done });
  if (!result) return;
  upsert(us.goals, result.item);
  paintGoals();
  if (!done) return;
  toast(`Realizado: ${goal.title}!`, "ok", "sparkles");
  sound.play("sparkle");
  fx.confetti();
}

async function toggleStep(goal, id) {
  const step = goal.steps.find((item) => item.id === id);
  if (!step) return;
  step.done = !step.done;
  paintGoals();
  sound.play(step.done ? "react" : "tap");
  const result = await usCall({ op: "goal:step", id: goal.id, step: id, done: step.done });
  if (result) upsert(us.goals, result.item);
  paintGoals();
}

usView.querySelector('[data-pane="sonhos"]').addEventListener("click", (event) => {
  if (event.target.closest("#goal-add")) return editGoal();
  const card = event.target.closest("[data-goal]");
  const goal = card && us.goals.find((item) => item.id === card.dataset.goal);
  if (!goal) return;
  const step = event.target.closest("[data-step]");
  if (step) return toggleStep(goal, step.dataset.step);
  const action = event.target.closest("[data-goal-action]")?.dataset.goalAction;
  if (action === "edit") editGoal(goal);
  else if (action === "deposit") depositGoal(goal);
  else if (action === "done" || action === "undo") finishGoal(goal, action === "done");
});

// ---- cartinhas ----

const letterView = $("#letter-view");
// Cartinha aberta agora (com o texto inteiro, depois que ele chega).
let letterOpen = null;

function paintLetters() {
  const letters = [...us.letters].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  $("#letter-list").replaceChildren(...(letters.length ? letters.map(letterCard) : [emptyNote("Nenhuma cartinha ainda. Que tal escrever a primeira?")]));
}

function letterCard(letter) {
  const mine = letter.owner === me;
  const fresh = !mine && !letter.readAt;
  const card = el("button", `letter-card paper-${letter.paper} font-${letter.font || LETTER_FONTS[0][0]}${fresh ? " fresh" : ""}`);
  card.type = "button";
  card.dataset.letter = letter.id;
  const text = el("span", "letter-text");
  text.append(el("small", "", `${mine ? `Para ${letter.to || "o seu amor"}` : `De ${letter.owner}`} · ${shortDate(isoDay(new Date(letter.createdAt)))}`), el("strong", "", letter.title), el("span", "letter-preview", letter.preview));
  // Quantas fotos e áudios vão dentro.
  const photos = letter.photos?.length || 0;
  const audios = letter.audios?.length || 0;
  if (photos || audios) {
    const media = el("span", "letter-media");
    const count = (iconName, text) => {
      const node = el("span");
      node.append(icon(iconName), text);
      return node;
    };
    if (photos) media.append(count("image", `${photos} ${photos === 1 ? "foto" : "fotos"}`));
    if (audios) media.append(count("audio-lines", `${audios} ${audios === 1 ? "áudio" : "áudios"}`));
    text.append(media);
  }
  card.append(iconBadge(fresh ? "mail" : mine ? "send" : "heart", "letter-seal"), text);
  const flag = fresh ? "Nova!" : mine ? (letter.readAt ? "Lida" : "Ainda não lida") : "";
  if (flag) card.append(el("span", `letter-flag${fresh ? " new" : ""}`, flag));
  return card;
}

function onLetterKey(event) {
  if (event.key !== "Escape") return;
  event.stopPropagation();
  closeLetter();
}

async function openLetter(id) {
  const meta = us.letters.find((letter) => letter.id === id);
  if (!meta) return;
  const fresh = meta.owner !== me && !meta.readAt;
  paintLetter({ ...meta, body: null });
  letterView.classList.remove("hidden");
  $("#envelope").className = `envelope paper-${meta.paper}`;
  fx.letter($("#envelope"), $("#letter-paper"));
  document.addEventListener("keydown", onLetterKey, true);
  sound.play("whoosh");
  const result = await usCall({ op: "letter:open", id });
  if (!result || letterOpen?.id !== id) return;
  upsert(us.letters, { id, readAt: result.item.readAt });
  paintLetter(result.item);
  if (!fresh) return;
  sound.play("sparkle");
  paintUsBadge();
  paintLetters();
}

function paintLetter(letter) {
  letterOpen = letter;
  const mine = letter.owner === me;
  $("#letter-paper").className = `letter-paper paper-${letter.paper} font-${letter.font || LETTER_FONTS[0][0]}`;
  // Os áudios ficam logo embaixo do título (dá para ouvir enquanto lê) e as fotos, como polaroides, depois do texto.
  const playing = playback.key;
  $("#letter-audios").replaceChildren(...(letter.audios || []).map((audio) => letterVoice(audio, `letter:${audio.key}`)));
  if (playing.startsWith("letter:")) paintVoice(playing);
  $("#letter-photos").replaceChildren(...(letter.photos || []).map((photo) => {
    const button = el("button", "letter-photo");
    button.type = "button";
    button.dataset.photo = photo.url;
    button.title = "Ver a foto";
    const image = el("img");
    image.src = photo.url;
    image.alt = "Foto da cartinha";
    image.loading = "lazy";
    button.append(image);
    return button;
  }));
  $("#letter-to").textContent = letter.to === me ? "Para você" : `Para ${letter.to || "o seu amor"}`;
  $("#letter-title").textContent = letter.title;
  $("#letter-body").textContent = letter.body ?? "Abrindo a cartinha…";
  $("#letter-body").classList.toggle("loading", letter.body == null);
  $("#letter-sign").textContent = `Com amor, ${letter.owner}`;
  const read = mine ? (letter.readAt ? ` · lida em ${longDate(letter.readAt)} às ${time(letter.readAt)}` : " · ainda não lida") : "";
  $("#letter-state").textContent = `${longDate(letter.createdAt)}${letter.edited ? " · editada" : ""}${read}`;
  $("#letter-tools").classList.toggle("hidden", !mine || letter.body == null);
}

function closeLetter() {
  if (playback.key.startsWith("letter:")) stopVoice();
  letterOpen = null;
  letterView.classList.add("hidden");
  document.removeEventListener("keydown", onLetterKey, true);
}

function writeLetter(letter = null) {
  const draft = letter ? null : store.get("localStorage", LETTER_DRAFT_KEY);
  const paper = letter?.paper || draft?.paper || "creme";
  const font = letter?.font || draft?.font || LETTER_FONTS[0][0];
  // O campo do texto já mostra o papel e a letra escolhidos.
  const restyle = (prefix) => (value) => swapClass(sheetForm.querySelector(".letter-input"), prefix, value);
  openSheet({
    title: letter ? "Editar cartinha" : `Cartinha para ${peerName || "o seu amor"}`,
    icon: "mail",
    wide: true,
    submit: letter ? "Salvar" : "Enviar",
    fields: [
      { name: "title", type: "text", label: "Título", value: letter?.title ?? draft?.title, placeholder: "Para o meu amor", max: 120 },
      { name: "paper", type: "chips", label: "Papel", value: paper, options: PAPERS.map(([value, label]) => [value, label, `paper-${value}`]), onPick: restyle("paper-") },
      { name: "font", type: "chips", label: "Letra", value: font, options: LETTER_FONTS.map(([value, label]) => [value, label, `font-chip font-${value}`]), onPick: restyle("font-") },
      { name: "body", type: "textarea", value: letter?.body ?? draft?.body, placeholder: "Escreva com o coração…", max: 20000, rows: 12, className: `letter-input paper-${paper} font-${font}` },
      { name: "photos", type: "photos", label: "Fotos", value: letter?.photos, limit: LETTER_PHOTOS },
      { name: "audios", type: "audios", label: "Áudios", value: letter?.audios, limit: LETTER_AUDIOS, hint: "Uma mensagem de voz ou uma música (MP3, M4A, OGG ou WAV)." }
    ],
    // O rascunho (sem as fotos e os áudios, que ainda não subiram) fica guardado neste aparelho até a cartinha ser enviada.
    onChange: letter ? null : ({ photos, audios, ...values }) => store.set("localStorage", LETTER_DRAFT_KEY, values),
    onSubmit: async ({ photos, audios, ...values }) => {
      if (sheetForm.querySelector('[data-field="audios"]')?.rec) throw new Error("Pare a gravação antes de enviar.");
      if (!values.body && !photos.length && !audios.length) throw new Error("Escreva alguma coisa na cartinha.");
      // As fotos e os áudios novos sobem antes, um de cada vez (se o envio falhar, o que já subiu não sobe de novo).
      for (const photo of photos) {
        if (!photo.file) continue;
        photo.key = (await uploadPhoto(photo.file)).key;
        delete photo.file;
      }
      for (const audio of audios) {
        if (!audio.blob) continue;
        audio.key = (await uploadAudio(audio.blob)).key;
        delete audio.blob;
      }
      const result = await usCall({
        op: "letter:save",
        id: letter?.id,
        ...values,
        photos: photos.map(({ key }) => ({ key })),
        audios: audios.map(({ key, duration, peaks, voice }) => ({ key, duration, peaks, voice }))
      });
      if (!result) return false;
      if (!letter) store.remove("localStorage", LETTER_DRAFT_KEY);
      const { body, ...meta } = result.item;
      upsert(us.letters, { ...meta, preview: body.replace(/\s+/g, " ").slice(0, 140) });
      paintLetters();
      if (!letter) {
        toast(`Cartinha enviada para ${peerName || "o seu amor"}`, "ok", "mail");
        fx.confetti(40);
        sound.play("sparkle");
      }
      return true;
    }
  });
}

// Troca a classe de um prefixo (paper-…, font-…) por outra.
function swapClass(node, prefix, value) {
  if (!node) return;
  node.classList.remove(...[...node.classList].filter((name) => name.startsWith(prefix)));
  node.classList.add(prefix + value);
}

// Player de um áudio da cartinha: o mesmo das mensagens de voz, com o nome em cima (música: o nome do arquivo).
function letterVoice(audio, key) {
  const box = el("div", "letter-voice");
  const name = el("span", "letter-voice-name");
  name.append(icon(audio.voice ? "mic" : "music"), el("span", "", audio.voice ? "Mensagem de voz" : audio.name.replace(/\.[a-z0-9]{2,4}$/i, "")));
  box.append(name, voiceView({ id: null, clientId: key, file: { url: audio.url, preview: audio.blob ? audio.url : null, voice: { duration: audio.duration, peaks: audio.peaks || [] } } }));
  return box;
}

// Duração e forma de onda de um áudio escolhido no aparelho (como as dos gravados), medidas aqui mesmo. Sem conseguir
// decodificar, vale só a duração (a onda fica lisa).
async function measureAudio(blob) {
  try {
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const data = await blob.arrayBuffer();
    // Em 8 kHz e num canal só: basta para a onda, sem gastar memória com uma música inteira.
    const decoded = await new Promise((resolve, reject) => new Offline(1, 1, 8000).decodeAudioData(data, resolve, reject));
    const samples = decoded.getChannelData(0);
    const step = Math.max(1, Math.floor(samples.length / 400));
    const levels = [];
    for (let start = 0; start < samples.length; start += step) {
      const end = Math.min(samples.length, start + step);
      let sum = 0;
      for (let index = start; index < end; index += 1) sum += samples[index] ** 2;
      levels.push(voiceLevel(Math.sqrt(sum / (end - start))));
    }
    return { duration: Math.round(decoded.duration * 10) / 10, peaks: voicePeaks(levels) };
  } catch {
    const url = URL.createObjectURL(blob);
    const duration = await new Promise((resolve) => {
      const probe = new Audio();
      probe.preload = "metadata";
      probe.addEventListener("loadedmetadata", () => resolve(probe.duration), { once: true });
      probe.addEventListener("error", () => resolve(0), { once: true });
      probe.src = url;
    });
    URL.revokeObjectURL(url);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("Não deu para ler esse áudio.");
    return { duration: Math.round(duration * 10) / 10, peaks: [] };
  }
}

// Gravar um áudio para a cartinha: o mesmo formato, qualidade e redução de ruído das mensagens de voz, numa faixa dentro
// do formulário. Parar guarda o áudio na lista; cancelar joga fora.
async function startLetterRecording(wrap, field) {
  if (wrap.rec || rec) return;
  if (call) return toast("Durante a chamada não dá para gravar áudio.");
  stopVoice();
  const session = wrap.rec = { chunks: [], levels: [], peak: 0 };
  paintAudiosField(wrap, field);
  sound.play("record");
  if (noiseOn() && window.AudioWorkletNode) {
    session.context = new AudioContext({ sampleRate: 48000 });
    loadNoiseKit().catch(() => {});
  }
  try {
    session.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
  } catch (error) {
    releaseMicStream(session);
    if (wrap.rec === session) {
      wrap.rec = null;
      paintAudiosField(wrap, field);
    }
    toast(inExtension ? "O painel lateral não consegue usar o microfone. Abra nosso chat numa aba para gravar."
      : error.name === "NotAllowedError" ? "Libere o microfone para o chat nas configurações do navegador."
      : "Não deu para usar o microfone.", "error");
    return sound.play("error");
  }
  let stream = session.stream;
  if (session.context) {
    try {
      const clean = await cleanMic(stream, session.context);
      stream = clean.stream;
      session.denoise = clean.denoise;
    } catch (error) {
      console.warn("Redução de ruído indisponível; gravando sem ela.", error);
      session.context.close().catch(() => {});
      session.context = null;
    }
  }
  // Cancelou (ou fechou a janela) enquanto o navegador pedia a permissão.
  if (wrap.rec !== session) return releaseMicStream(session);
  const type = VOICE_TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  try {
    session.recorder = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: VOICE_BITRATE } : { audioBitsPerSecond: VOICE_BITRATE });
  } catch {
    wrap.rec = null;
    releaseMicStream(session);
    paintAudiosField(wrap, field);
    return toast("Este navegador não conseguiu gravar o áudio.", "error");
  }
  session.meter = sound.meter(stream);
  session.recorder.addEventListener("dataavailable", (event) => { if (event.data.size) session.chunks.push(event.data); });
  session.recorder.start(1000);
  session.started = session.lastBar = performance.now();
  // Uma barra da onda a cada 100 ms (com o nível mais alto do trecho), como nas mensagens de voz.
  session.timer = setInterval(() => {
    const now = performance.now();
    session.peak = Math.max(session.peak, voiceLevel(session.meter()));
    if (now - session.lastBar >= 100) {
      for (; now - session.lastBar >= 100; session.lastBar += 100) session.levels.push(session.peak);
      session.peak = 0;
    }
    const seconds = (now - session.started) / 1000;
    const clock = wrap.querySelector(".letter-rec-time");
    if (clock) clock.textContent = clockTime(seconds);
    if (seconds >= VOICE_MAX) stopLetterRecording(wrap, field, true);
  }, 30);
}

// Para a gravação da cartinha. keep = guardar na lista (se tiver pelo menos VOICE_MIN segundos); field = null quando a
// janela fechou (aí só solta o microfone).
function stopLetterRecording(wrap, field, keep) {
  const session = wrap.rec;
  if (!session) return;
  wrap.rec = null;
  clearInterval(session.timer);
  const recorder = session.recorder;
  if (field) paintAudiosField(wrap, field);
  // Ainda esperando a permissão: o startLetterRecording solta o microfone quando ela chegar.
  if (!recorder) return;
  const seconds = (performance.now() - session.started) / 1000;
  recorder.addEventListener("stop", () => {
    releaseMicStream(session);
    if (!keep || !field) return;
    if (seconds < VOICE_MIN) return toast("Áudio curto demais.");
    const type = recorder.mimeType || session.chunks[0]?.type || "audio/webm";
    const blob = new File(session.chunks, voiceFileName(type), { type });
    wrap.audios.push({ blob, url: URL.createObjectURL(blob), name: blob.name, voice: true, duration: Math.round(seconds * 10) / 10, peaks: voicePeaks(session.levels) });
    paintAudiosField(wrap, field);
    sound.play("sparkle");
  }, { once: true });
  if (recorder.state === "inactive") recorder.dispatchEvent(new Event("stop"));
  else recorder.stop();
}

usView.querySelector('[data-pane="cartinhas"]').addEventListener("click", (event) => {
  if (event.target.closest("#letter-add")) return writeLetter();
  const card = event.target.closest("[data-letter]");
  if (card) openLetter(card.dataset.letter);
});

letterView.addEventListener("click", async (event) => {
  if (event.target === letterView || event.target.closest("#letter-close")) return closeLetter();
  const photo = event.target.closest("[data-photo]");
  if (photo) return openViewer({ url: photo.dataset.photo, name: "foto.jpg" });
  const play = event.target.closest('[data-voice="play"]')?.closest(".voice");
  if (play?.msg) return toggleVoice(play.msg);
  const letter = letterOpen;
  if (!letter) return;
  if (event.target.closest("#letter-edit")) {
    closeLetter();
    writeLetter(letter);
  } else if (event.target.closest("#letter-delete")) {
    if (!await confirmDialog({ title: "Apagar a cartinha?", text: "Ela some para os dois. Não dá para desfazer.", confirm: "Apagar" })) return;
    if (!await usCall({ op: "letter:delete", id: letter.id })) return;
    us.letters = us.letters.filter((item) => item.id !== letter.id);
    closeLetter();
    paintLetters();
    toast("Cartinha apagada", "ok");
  }
});

// ---- formulário (uma janela para tudo) ----
// Cada campo: { name, type, label, value, … }. Tipos: text, money, date, time (optional = o rótulo do "sem hora"),
// textarea, select (options [valor, rótulo]; numeric = valores numéricos), chips (options [valor, rótulo, classe,
// ícone]; iconOnly = só o ícone; instant = escolher já salva; onPick = avisa a escolha na hora), photo, photos (várias,
// até limit), audios (gravados ou escolhidos, até limit), list (itens com texto, e emoji com withEmoji), prompt
// (horário de cada lembrete, com liga/desliga) e info (um texto). onSubmit recebe os valores e fecha a janela, a
// não ser que devolva false; um erro vira aviso. onDelete aparece como o botão Apagar; cancel = o rótulo do botão de fechar.
const sheet = $("#us-sheet");
const sheetForm = $("#sheet-form");
let sheetState = null;
let sheetTimer = 0;

function openSheet({ title, icon: iconName = "sparkles", fields, submit = "Salvar", cancel = "Cancelar", onSubmit, onDelete = null, deleteLabel = "Apagar", wide = false, onChange = null }) {
  sheetState = { fields, onSubmit, onDelete, onChange, busy: false };
  $("#sheet-title").textContent = title;
  setIcon($("#sheet-icon use"), iconName);
  $("#sheet-submit").textContent = submit || "";
  $("#sheet-submit").classList.toggle("hidden", !submit);
  $("#sheet-cancel").textContent = cancel;
  $("#sheet-delete").textContent = deleteLabel;
  $("#sheet-delete").classList.toggle("hidden", !onDelete);
  sheetForm.classList.toggle("wide", wide);
  sheetForm.classList.remove("busy");
  $("#sheet-body").replaceChildren(...fields.map(fieldNode));
  sheet.classList.remove("hidden");
  $("#sheet-body").scrollTop = 0;
  fx.incoming(sheetForm);
  document.addEventListener("keydown", onSheetKey, true);
  const focus = sheetForm.querySelector("[data-autofocus]") || (matchMedia("(pointer: fine)").matches && sheetForm.querySelector(".field-input:not([type=date]):not([type=time]):not(select)"));
  focus?.focus();
}

function closeSheet() {
  if (!sheetState) return;
  clearTimeout(sheetTimer);
  // Gravando ou ouvindo um áudio da cartinha: o microfone é solto e o áudio para.
  sheetForm.querySelectorAll(".type-audios").forEach((wrap) => stopLetterRecording(wrap, null, false));
  if (playback.key.startsWith("draft:")) stopVoice();
  sheetState = null;
  sheet.classList.add("hidden");
  document.removeEventListener("keydown", onSheetKey, true);
}

function onSheetKey(event) {
  if (event.key === "Escape") {
    event.stopPropagation();
    closeSheet();
  } else if (event.key === "Enter" && event.target.matches(".list-text")) {
    // Enter num item da lista cria o próximo (em vez de salvar).
    event.preventDefault();
    sheetForm.querySelector(`[data-list-add="${event.target.closest("[data-field]").dataset.field}"]`)?.click();
  }
}

function fieldNode(field) {
  const wrap = el("div", `field-row type-${field.type}`);
  wrap.dataset.field = field.name;
  if (field.label) wrap.append(el("span", "field-label", field.label));
  const input = (tag, type) => {
    const node = el(tag, `field-input${field.className ? ` ${field.className}` : ""}`);
    if (type) node.type = type;
    node.name = field.name;
    if (field.placeholder) node.placeholder = field.placeholder;
    if (field.max) node.maxLength = field.max;
    if (field.focus) node.dataset.autofocus = "";
    if (field.label) node.setAttribute("aria-label", field.label);
    return node;
  };
  switch (field.type) {
    case "info":
      wrap.append(el("p", "field-info", field.text));
      break;
    // Linhas de leitura (ícone, rótulo e valor), com a mensagem em cima: os dados da mensagem.
    case "facts": {
      if (field.quote) wrap.append(el("p", "facts-quote", field.quote));
      const rows = el("div", "facts");
      for (const [iconName, label, value, className] of field.rows) {
        const row = el("div", `fact${className ? ` ${className}` : ""}`);
        const text = el("span", "fact-text");
        text.append(el("strong", "", label), el("small", "", value));
        row.append(iconBadge(iconName, "fact-icon"), text);
        rows.append(row);
      }
      wrap.append(rows);
      break;
    }
    case "text":
    case "date": {
      const node = input("input", field.type);
      node.value = field.value || "";
      if (field.type === "text") node.autocomplete = "off";
      wrap.append(node);
      break;
    }
    case "money": {
      const node = input("input", "text");
      node.inputMode = "decimal";
      node.autocomplete = "off";
      node.value = field.value ? String(field.value).replace(".", ",") : "";
      wrap.append(node);
      break;
    }
    case "time": {
      const node = input("input", "time");
      node.value = field.value || "";
      wrap.append(node);
      if (field.optional) {
        // Sem hora (o dia todo): o campo fica desligado.
        const toggle = el("button", `field-toggle${field.value ? "" : " on"}`, field.optional);
        toggle.type = "button";
        toggle.dataset.toggle = "";
        toggle.setAttribute("aria-pressed", String(!field.value));
        node.disabled = !field.value;
        wrap.append(toggle);
      }
      break;
    }
    case "textarea": {
      const node = input("textarea");
      node.rows = field.rows || 4;
      node.value = field.value || "";
      wrap.append(node);
      break;
    }
    case "select": {
      const node = input("select");
      for (const [value, label] of field.options) {
        const option = el("option", "", label);
        option.value = String(value);
        option.selected = String(field.value ?? "") === String(value);
        node.append(option);
      }
      wrap.append(node);
      break;
    }
    case "chips": {
      const row = el("div", `chips${field.iconOnly ? " icon-only" : ""}`);
      wrap.dataset.value = JSON.stringify(field.value ?? null);
      for (const [value, label, className, iconName] of field.options) {
        const chip = el("button", `chip-option${className ? ` ${className}` : ""}`);
        if (iconName) chip.append(icon(iconName));
        if (!field.iconOnly) chip.append(label);
        chip.title = label;
        chip.setAttribute("aria-label", label);
        chip.type = "button";
        chip.dataset.chip = JSON.stringify(value);
        chip.setAttribute("aria-pressed", String(value === field.value));
        row.append(chip);
      }
      wrap.append(row);
      break;
    }
    case "photo": {
      wrap.photo = field.value || null;
      const file = el("input");
      file.type = "file";
      file.accept = "image/*";
      file.hidden = true;
      file.addEventListener("change", () => {
        const [chosen] = file.files;
        file.value = "";
        if (!chosen) return;
        if (!chosen.type.startsWith("image/")) return toast("Escolha uma foto.", "error");
        wrap.photo = { file: chosen, url: URL.createObjectURL(chosen) };
        paintPhotoField(wrap);
      });
      wrap.append(el("div", "photo-field"), file);
      paintPhotoField(wrap);
      // Abre a escolha da foto direto (o toque que abriu a janela ainda vale como gesto da pessoa).
      if (field.pickNow) queueMicrotask(() => file.click());
      break;
    }
    case "photos": {
      wrap.photos = [...(field.value || [])];
      const file = el("input");
      file.type = "file";
      file.accept = "image/*";
      file.multiple = true;
      file.hidden = true;
      file.addEventListener("change", () => {
        const chosen = [...file.files].filter((item) => item.type.startsWith("image/"));
        file.value = "";
        const room = field.limit - wrap.photos.length;
        if (chosen.length > room) toast(`Cabem até ${field.limit} fotos.`);
        wrap.photos.push(...chosen.slice(0, Math.max(0, room)).map((item) => ({ file: item, url: URL.createObjectURL(item) })));
        paintPhotosField(wrap, field);
        sheetChanged();
      });
      wrap.append(el("div", "photos-field"), file);
      paintPhotosField(wrap, field);
      break;
    }
    case "audios": {
      wrap.audios = [...(field.value || [])];
      const file = el("input");
      file.type = "file";
      file.accept = "audio/*";
      file.hidden = true;
      file.addEventListener("change", async () => {
        const [chosen] = file.files;
        file.value = "";
        if (!chosen) return;
        if (fileMax && chosen.size > fileMax) return toast(`Áudio grande demais (máximo de ${formatSize(fileMax)}).`, "error");
        try {
          wrap.audios.push({ blob: chosen, url: URL.createObjectURL(chosen), name: chosen.name, voice: false, ...await measureAudio(chosen) });
        } catch (error) {
          return toast(error.message, "error");
        }
        if (wrap.isConnected) paintAudiosField(wrap, field);
      });
      wrap.append(el("div", "audios-field"), file);
      paintAudiosField(wrap, field);
      break;
    }
    case "list": {
      const list = el("div", "list-edit");
      const items = field.value?.length ? field.value : [{}];
      for (const item of items) list.append(listRow(field, item));
      const add = el("button", "text-button list-add");
      add.type = "button";
      add.dataset.listAdd = field.name;
      add.append(icon("plus"), field.add || "Adicionar");
      wrap.append(list, add);
      break;
    }
    case "prompt": {
      const list = el("div", "prompt-list");
      for (const [key, iconName, label] of PROMPT_LABELS) {
        const value = field.value?.[key];
        const row = el("div", `prompt-row${value ? "" : " is-off"}`);
        row.dataset.key = key;
        const clock = el("input", "field-input");
        clock.type = "time";
        clock.value = value || PROMPT_DEFAULTS[key];
        clock.setAttribute("aria-label", `Horário: ${label}`);
        const toggle = el("button", "prompt-switch");
        toggle.type = "button";
        toggle.dataset.promptSwitch = "";
        toggle.setAttribute("role", "switch");
        toggle.setAttribute("aria-checked", String(Boolean(value)));
        toggle.setAttribute("aria-label", label);
        toggle.append(el("span", "switch"));
        row.append(iconBadge(iconName, `row-icon tone-${key}`), el("span", "prompt-label", label), clock, toggle);
        list.append(row);
      }
      wrap.append(list);
      break;
    }
  }
  if (field.hint) wrap.append(el("small", "field-hint", field.hint));
  return wrap;
}

function listRow(field, item = {}) {
  const row = el("div", "list-row");
  row.item = { id: item.id, done: item.done };
  if (field.withEmoji) {
    const emoji = el("input", "list-emoji");
    emoji.value = item.emoji || field.defaultEmoji;
    emoji.maxLength = 8;
    emoji.setAttribute("aria-label", "Emoji");
    row.append(emoji);
  }
  const text = el("input", "list-text");
  text.value = item.text || "";
  text.placeholder = field.placeholder || "";
  text.maxLength = field.max || 60;
  text.enterKeyHint = "next";
  text.setAttribute("aria-label", field.label || "Item");
  const remove = el("button", "list-remove");
  remove.type = "button";
  remove.dataset.listRemove = "";
  remove.title = "Tirar";
  remove.setAttribute("aria-label", "Tirar");
  remove.append(icon("x"));
  row.append(text, remove);
  return row;
}

function paintPhotoField(wrap) {
  const box = wrap.querySelector(".photo-field");
  const photo = wrap.photo;
  box.replaceChildren();
  if (photo) {
    const image = el("img");
    image.src = photo.url;
    image.alt = "";
    box.append(image);
  }
  const actions = el("div", "photo-field-actions");
  const pick = el("button", "pill ghost small");
  pick.type = "button";
  pick.dataset.photoPick = "";
  pick.append(icon("camera"), photo ? "Trocar foto" : "Pôr uma foto");
  actions.append(pick);
  if (photo) {
    const clear = el("button", "text-button", "Tirar");
    clear.type = "button";
    clear.dataset.photoClear = "";
    actions.append(clear);
  }
  box.append(actions);
}

function paintPhotosField(wrap, field) {
  const box = wrap.querySelector(".photos-field");
  box.replaceChildren(...wrap.photos.map((photo, index) => {
    const figure = el("figure", "photos-thumb");
    const image = el("img");
    image.src = photo.url;
    image.alt = "";
    const remove = el("button", "moment-remove");
    remove.type = "button";
    remove.dataset.photosRemove = String(index);
    remove.title = "Tirar a foto";
    remove.setAttribute("aria-label", "Tirar a foto");
    remove.append(icon("x"));
    figure.append(image, remove);
    return figure;
  }));
  if (wrap.photos.length < field.limit) {
    const add = el("button", "moment add photos-add");
    add.type = "button";
    add.dataset.photosAdd = "";
    add.append(icon("camera"), el("span", "", "Foto"));
    box.append(add);
  }
}

// Os áudios da cartinha (cada um com o player e o tirar) e, embaixo, gravar ou escolher; gravando, a faixa da gravação.
function paintAudiosField(wrap, field) {
  const box = wrap.querySelector(".audios-field");
  const playing = playback.key;
  box.replaceChildren(...wrap.audios.map((audio, index) => {
    const row = el("div", "letter-audio-row");
    const remove = el("button", "list-remove");
    remove.type = "button";
    remove.dataset.audiosRemove = String(index);
    remove.title = "Tirar o áudio";
    remove.setAttribute("aria-label", "Tirar o áudio");
    remove.append(icon("x"));
    row.append(letterVoice(audio, `draft:${audio.key || audio.url}`), remove);
    return row;
  }));
  if (playing.startsWith("draft:")) paintVoice(playing);
  if (wrap.rec) {
    const live = el("div", "letter-rec");
    const stop = el("button", "pill gold small");
    stop.type = "button";
    stop.dataset.audiosStop = "";
    stop.append(icon("stop"), "Parar");
    const cancel = el("button", "text-button", "Cancelar");
    cancel.type = "button";
    cancel.dataset.audiosCancel = "";
    live.append(el("i", "rec-dot"), el("span", "letter-rec-time", "0:00"), cancel, stop);
    box.append(live);
  } else if (wrap.audios.length < field.limit) {
    const actions = el("div", "audios-actions");
    if (canRecord) {
      const record = el("button", "pill ghost small");
      record.type = "button";
      record.dataset.audiosRecord = "";
      record.append(icon("mic"), "Gravar");
      actions.append(record);
    }
    const pick = el("button", "pill ghost small");
    pick.type = "button";
    pick.dataset.audiosPick = "";
    pick.append(icon("music"), "Escolher áudio");
    actions.append(pick);
    box.append(actions);
  }
}

function readSheet() {
  const values = {};
  for (const field of sheetState.fields) {
    const wrap = sheetForm.querySelector(`[data-field="${field.name}"]`);
    switch (field.type) {
      case "text":
      case "date":
      case "textarea":
        values[field.name] = wrap.querySelector(".field-input").value.trim();
        break;
      case "money":
        values[field.name] = parseMoney(wrap.querySelector(".field-input").value);
        break;
      case "time": {
        const node = wrap.querySelector(".field-input");
        values[field.name] = node.disabled ? null : node.value || null;
        break;
      }
      case "select": {
        const raw = wrap.querySelector(".field-input").value;
        values[field.name] = field.numeric ? (raw === "" ? null : Number(raw)) : raw;
        break;
      }
      case "chips":
        values[field.name] = JSON.parse(wrap.dataset.value || "null");
        break;
      case "photo":
        values[field.name] = wrap.photo || null;
        break;
      case "photos":
        values[field.name] = wrap.photos;
        break;
      case "audios":
        values[field.name] = wrap.audios;
        break;
      case "list":
        values[field.name] = [...wrap.querySelectorAll(".list-row")].map((row) => ({
          ...row.item,
          text: row.querySelector(".list-text").value.trim(),
          ...(field.withEmoji ? { emoji: row.querySelector(".list-emoji").value.trim() || field.defaultEmoji } : {})
        })).filter((item) => item.text);
        break;
      case "prompt":
        values[field.name] = Object.fromEntries([...wrap.querySelectorAll(".prompt-row")].map((row) => [row.dataset.key, row.classList.contains("is-off") ? null : row.querySelector("input").value || null]));
        break;
    }
  }
  return values;
}

sheetForm.addEventListener("click", (event) => {
  if (event.target.closest("[data-sheet-close]")) return closeSheet();
  const wrap = event.target.closest("[data-field]");
  const chip = event.target.closest("[data-chip]");
  if (chip) {
    wrap.dataset.value = chip.dataset.chip;
    wrap.querySelectorAll("[data-chip]").forEach((node) => node.setAttribute("aria-pressed", String(node === chip)));
    fx.press(chip);
    sound.play("tap");
    const field = sheetState.fields.find((item) => item.name === wrap.dataset.field);
    field?.onPick?.(JSON.parse(chip.dataset.chip));
    if (field?.instant) sheetForm.requestSubmit();
    else sheetChanged();
    return;
  }
  if (event.target.closest("[data-toggle]")) {
    const toggle = event.target.closest("[data-toggle]");
    const node = wrap.querySelector(".field-input");
    const allDay = !toggle.classList.contains("on");
    toggle.classList.toggle("on", allDay);
    toggle.setAttribute("aria-pressed", String(allDay));
    node.disabled = allDay;
    if (!allDay) {
      node.value ||= sheetState.fields.find((field) => field.name === wrap.dataset.field)?.fallback || "19:00";
      node.focus();
    }
    return;
  }
  const add = event.target.closest("[data-list-add]");
  if (add) {
    const field = sheetState.fields.find((item) => item.name === add.dataset.listAdd);
    const list = wrap.querySelector(".list-edit");
    if (list.children.length >= field.limit) return toast(`No máximo ${field.limit}.`);
    const row = listRow(field);
    list.append(row);
    row.querySelector(".list-text").focus();
    return;
  }
  if (event.target.closest("[data-list-remove]")) return event.target.closest(".list-row").remove();
  if (event.target.closest("[data-photo-pick]")) return wrap.querySelector("input[type=file]").click();
  if (event.target.closest("[data-photo-clear]")) {
    wrap.photo = null;
    return paintPhotoField(wrap);
  }
  const fieldOf = () => sheetState.fields.find((item) => item.name === wrap.dataset.field);
  if (event.target.closest("[data-photos-add], [data-audios-pick]")) return wrap.querySelector("input[type=file]").click();
  const photoOut = event.target.closest("[data-photos-remove]");
  if (photoOut) {
    wrap.photos.splice(Number(photoOut.dataset.photosRemove), 1);
    return paintPhotosField(wrap, fieldOf());
  }
  const audioOut = event.target.closest("[data-audios-remove]");
  if (audioOut) {
    if (playback.key.startsWith("draft:")) stopVoice();
    wrap.audios.splice(Number(audioOut.dataset.audiosRemove), 1);
    return paintAudiosField(wrap, fieldOf());
  }
  if (event.target.closest("[data-audios-record]")) return startLetterRecording(wrap, fieldOf());
  if (event.target.closest("[data-audios-stop]")) return stopLetterRecording(wrap, fieldOf(), true);
  if (event.target.closest("[data-audios-cancel]")) {
    sound.play("discard");
    return stopLetterRecording(wrap, fieldOf(), false);
  }
  // Ouvir um áudio da cartinha antes de enviar.
  const play = event.target.closest('[data-voice="play"]')?.closest(".voice");
  if (play?.msg) return toggleVoice(play.msg);
  const promptSwitch = event.target.closest("[data-prompt-switch]");
  if (promptSwitch) {
    const row = promptSwitch.closest(".prompt-row");
    const off = !row.classList.contains("is-off");
    row.classList.toggle("is-off", off);
    promptSwitch.setAttribute("aria-checked", String(!off));
    sound.play("tap");
    return;
  }
  if (event.target.closest("#sheet-delete") && sheetState?.onDelete) runSheet(sheetState.onDelete);
});

sheet.addEventListener("click", (event) => {
  if (event.target === sheet) closeSheet();
});

function sheetChanged() {
  if (!sheetState?.onChange) return;
  clearTimeout(sheetTimer);
  sheetTimer = setTimeout(() => sheetState?.onChange?.(readSheet()), 400);
}

sheetForm.addEventListener("input", sheetChanged);

// Salvar (ou apagar): a janela fica ocupada até o servidor responder; erro vira aviso e ela continua aberta.
async function runSheet(action) {
  if (!sheetState || sheetState.busy) return;
  const state = sheetState;
  state.busy = true;
  sheetForm.classList.add("busy");
  try {
    const close = await action(readSheet());
    if (close !== false && sheetState === state) closeSheet();
  } catch (error) {
    toast(error.message || "Não deu certo.", "error");
    sound.play("error");
  } finally {
    state.busy = false;
    sheetForm.classList.remove("busy");
  }
}

sheetForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (sheetState) runSheet(sheetState.onSubmit);
});

// ---- lembretes ----
// A lista das próximas 48 horas vem do servidor (us_schedule): a rotina (acordar, refeições, hábitos) e os
// compromissos. Com o site na tela e alguém mexendo nele, o lembrete aparece aqui, com o campo para responder; com
// o app do Android em segundo plano, quem avisa é o app (com o responder na própria notificação). Só o primeiro
// aparelho que pedir (claim) mostra cada lembrete, e o da rotina não aparece se já foi respondido.
const nudge = $("#nudge");
let schedule = [];
let scheduleTimer = 0;
let nudgeItem = null;
let lastInput = Date.now();
const claimed = new Set();

for (const type of ["pointerdown", "keydown"]) addEventListener(type, () => { lastInput = Date.now(); }, { capture: true, passive: true });

async function loadSchedule() {
  clearTimeout(scheduleTimer);
  scheduleTimer = setTimeout(loadSchedule, 30 * 60000);
  const result = await usCall({ op: "schedule", tz: -new Date().getTimezoneOffset() }, { quiet: true });
  if (result) schedule = result.items;
}

async function checkReminders() {
  // Ninguém mexendo há 5 minutos: deixa para o celular avisar.
  if (!socket?.connected || document.hidden || nudgeItem || Date.now() - lastInput > 5 * 60000) return;
  const now = Date.now() + musicClock;
  const due = schedule.find((item) => item.at <= now && now - item.at < 2 * 3600000 && !claimed.has(item.key));
  if (!due) return;
  claimed.add(due.key);
  const result = await usCall({ op: "claim", key: due.key }, { quiet: true });
  if (result?.fire) showNudge({ ...due, text: result.text || due.text });
}

setInterval(checkReminders, 20000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) setTimeout(checkReminders, 1500); });

function showNudge(item) {
  nudgeItem = item;
  setIcon($("#nudge-icon"), item.kind === "event" ? "calendar" : PROMPT_ICON[item.field] || "bell");
  $("#nudge-title").textContent = item.title;
  $("#nudge-text").textContent = item.text;
  $("#nudge-form").classList.toggle("hidden", !item.reply);
  $("#nudge-done").classList.toggle("hidden", item.field !== "rotina");
  $("#nudge-open").textContent = item.kind === "event" ? "Ver na agenda" : "Abrir";
  const input = $("#nudge-input");
  input.value = "";
  input.placeholder = item.field === "acordar" ? "Ex.: 7:30 (vazio = agora)" : "Conta aqui…";
  fx.show(nudge, { y: -16, scale: 0.96 });
  sound.play("receive");
  if (item.reply && matchMedia("(pointer: fine)").matches) input.focus();
}

function closeNudge() {
  if (!nudgeItem) return;
  nudgeItem = null;
  fx.hide(nudge, { y: -16 });
}

async function answerNudge(text) {
  const item = nudgeItem;
  if (!item) return;
  const result = await usCall({ op: "reply", day: item.day, field: item.field, text, clock: nowClock() });
  if (!result) return;
  const days = us.days.get(item.day);
  if (days) days[me] = result.item;
  if (tab === "us" && us.section === "hoje") paintToday();
  closeNudge();
  toast("Anotado!", "ok");
  sound.play("sparkle");
}

$("#nudge-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("#nudge-input").value.trim();
  if (!text && nudgeItem?.field !== "acordar") return $("#nudge-input").focus();
  answerNudge(text);
});
$("#nudge-done").addEventListener("click", () => answerNudge(""));
$("#nudge-close").addEventListener("click", closeNudge);
$("#nudge-open").addEventListener("click", () => {
  const item = nudgeItem;
  closeNudge();
  if (item?.kind === "event") goUs("agenda", { calDay: item.day });
  else if (item) goUs("hoje", { day: item.day });
});

// Endereço com #hoje, #agenda, #sonhos, #cartinhas ou #jogos (ou #cantinho): abre direto lá. O app do Android usa
// ao tocar numa notificação do Nosso cantinho (com o app já aberto, chama window.potatoOpen).
function openFromHash() {
  const section = location.hash.slice(1);
  if (section !== "cantinho" && !US_SECTIONS.includes(section)) return;
  history.replaceState(null, "", location.pathname + location.search);
  goUs(section);
}

window.potatoOpen = (section) => {
  if (me) goUs(section);
};

// ---------- joguinhos ----------
// Cada partida é uma mensagem com game (veja "joguinhos" em lib/potato.php). Cartas (verdade ou desafio, quem é mais
// provável, isso ou aquilo, perguntinha) se jogam no próprio cartão da conversa; os de tabuleiro (velha, dama,
// memória e stop) na mesinha, que abre por cima e acompanha as jogadas ao vivo.

const GAME_NAMES = { vd: "Verdade ou desafio", quem: "Quem é mais provável?", isso: "Isso ou aquilo", pergunta: "Perguntinha", velha: "Jogo da velha", dama: "Dama", memoria: "Jogo da memória", stop: "Stop" };
const GAME_ICONS = { vd: "dice", quem: "users", isso: "split", pergunta: "question", velha: "hash", dama: "crown", memoria: "brain", stop: "hand" };
const BOARD_GAMES = ["velha", "dama", "memoria", "stop"];
const GAME_PICKS_KEY = "potato.gamePicks";
const STOP_DRAFT_KEY = "potato.stopDraft";
// O que você escolheu em cada jogo de votar ou responder (o servidor só mostra quando os dois tiverem ido).
const gamePicks = new Map(Object.entries(store.get("localStorage", GAME_PICKS_KEY) || {}));
// Resposta da perguntinha sendo escrita (o cartão é refeito a cada novidade e não pode perder o texto).
const gameDrafts = new Map();
const otherPlayer = () => presenceList.find((user) => user.name !== me)?.name || "a outra pessoa";

function rememberPick(id, value) {
  gamePicks.set(id, value);
  store.set("localStorage", GAME_PICKS_KEY, Object.fromEntries([...gamePicks].slice(-100)));
}

// A partida ainda está valendo? (Tabuleiro sem vencedor; carta sem escolha, votos ou respostas de todos.)
const gameOpen = (game) => (BOARD_GAMES.includes(game.type) ? !game.winner : game.type === "vd" ? !game.choice : !game.done);

function gameWaiting(game) {
  if (BOARD_GAMES.includes(game.type)) return boardStatus(game);
  if (game.type === "vd") return game.for === me ? "Sua vez de escolher!" : `Esperando ${game.for} escolher…`;
  return game.players.includes(me) ? `Esperando ${otherPlayer()}…` : "Sua vez!";
}

// A partida está esperando você? A sua vez no tabuleiro; no stop, a rodada com campos seus para preencher; nas
// cartas, a sua escolha, o seu voto ou a sua resposta.
function myTurn(game) {
  if (!gameOpen(game)) return false;
  if (game.type === "stop") return game.phase === "playing" && (game.filled[me] ?? 0) < game.categories.length;
  if (BOARD_GAMES.includes(game.type)) return game.turn === me;
  if (game.type === "vd") return game.for === me;
  return !game.players.includes(me);
}

// A seção de jogos: o placar, só as partidas esperando você (das mensagens já carregadas) e os jogos para começar.
function paintGames() {
  $('[data-game-hint="vd"]').textContent = `${peerName || "A outra pessoa"} escolhe: verdade ou desafio. Perguntas e desafios fofinhos.`;
  const waiting = loaded().filter((message) => message.game && !message.deleted && myTurn(message.game)).reverse();
  $("#game-live-wrap").classList.toggle("hidden", !waiting.length);
  $("#game-live").replaceChildren(...waiting.map((message) => {
    const row = el("button", "event-row game-row");
    row.type = "button";
    row.dataset.openGame = message.id;
    const text = el("span", "event-text");
    text.append(el("strong", "", GAME_NAMES[message.game.type]), el("small", "", `${gameWaiting(message.game)} · ${message.sender === me ? "você começou" : `${message.sender} começou`}`));
    row.append(iconBadge(GAME_ICONS[message.game.type], `event-emoji game-${message.game.type}`), text, el("span", "event-date", "Jogar"));
    return row;
  }));
  paintScore();
}

// Placar (contado no servidor, de todas as partidas de tabuleiro que já acabaram): chega ao abrir os jogos e quando
// uma partida acaba. { velha: { wins: { nome: n }, ties: n }, … }
let gameScore = null;
let shownScore = "";

function loadScore() {
  if (!socket?.connected) return;
  socket.timeout(15000).emit("game", { op: "score" }, (error, result) => {
    if (error || !result?.ok) return;
    gameScore = result.score;
    if (tab === "us" && us.section === "jogos") paintScore();
  });
}

const countOf = (count, one, many) => `${count} ${count === 1 ? one : many}`;

// Você à esquerda, a outra pessoa à direita: as vitórias grandes no meio, as derrotas embaixo de cada um, quem está
// na frente (com a coroa) e, no pé, os empates e jogo por jogo.
function paintScore() {
  const card = $("#game-score");
  card.classList.toggle("hidden", !gameScore || !peerName);
  if (!gameScore || !peerName) return;
  const games = BOARD_GAMES.filter((type) => gameScore[type]);
  const wins = (name, types = games) => types.reduce((sum, type) => sum + (gameScore[type].wins[name] || 0), 0);
  const mine = wins(me);
  const theirs = wins(peerName);
  const ties = games.reduce((sum, type) => sum + gameScore[type].ties, 0);
  const lead = mine > theirs ? me : theirs > mine ? peerName : null;

  const head = el("div", "score-head");
  head.append(el("strong", "", "Placar"), el("span", `score-lead${lead === me ? " mine" : ""}`,
    !games.length ? "Nenhuma partida terminou ainda" : lead === me ? "Você está na frente!" : lead ? `${lead} está na frente` : "Empatados!"));
  const side = (name, lost) => {
    const box = el("div", `score-side${name === lead ? " lead" : ""}`);
    const face = el("span", "avatar score-face");
    paintAvatar(face, name);
    if (name === lead) {
      const crown = el("span", "score-crown");
      crown.append(icon("crown"));
      face.append(crown);
    }
    box.append(face, el("strong", "score-name", who(name)), el("small", "", countOf(lost, "derrota", "derrotas")));
    return box;
  };
  const middle = el("div", "score-mid");
  const numbers = el("div", "score-nums");
  numbers.append(el("b", mine > theirs ? "ahead" : "", String(mine)), el("span", "score-x", "×"), el("b", theirs > mine ? "ahead" : "", String(theirs)));
  middle.append(numbers, el("small", "", "vitórias"));
  const main = el("div", "score-main");
  main.append(side(me, theirs), middle, side(peerName, mine));
  card.replaceChildren(head, main);

  if (games.length) {
    const foot = el("div", "score-games");
    if (ties) foot.append(el("span", "score-game ties", countOf(ties, "empate", "empates")));
    for (const type of games) {
      const chip = el("span", "score-game");
      chip.append(iconBadge(GAME_ICONS[type], `game-mark game-${type}`), el("span", "", GAME_NAMES[type]), el("b", "", `${wins(me, [type])} × ${wins(peerName, [type])}`));
      if (gameScore[type].ties) chip.append(el("small", "", countOf(gameScore[type].ties, "empate", "empates")));
      foot.append(chip);
    }
    card.append(foot);
  }
  // Mudou desde a última vez (uma partida acabou): os números pulam.
  const key = JSON.stringify([mine, theirs, ties]);
  if (shownScore && key !== shownScore) fx.pop(numbers);
  shownScore = key;
}

usView.querySelector('[data-pane="jogos"]').addEventListener("click", (event) => {
  const start = event.target.closest("[data-game-new]");
  if (start) return startGame(start.dataset.gameNew);
  const open = event.target.closest("[data-open-game]");
  if (open) openTable(open.dataset.openGame);
});

// Nova partida: a mesinha abre aqui mesmo, e o convite vai para a conversa (é lá que a outra pessoa fica sabendo).
function startGame(type) {
  if (!socket?.connected) return toast("Sem conexão agora. Tente de novo em instantes.", "error");
  sound.play("tap");
  socket.timeout(15000).emit("game", { op: "new", type }, (error, result) => {
    if (error || !result?.ok) {
      toast(result?.error || "O joguinho não começou. Tente de novo.", "error");
      sound.play("error");
      return;
    }
    receive(result.message, true);
    openTable(result.message.id);
    if (tab === "us" && us.section === "jogos") paintGames();
  });
}

// Uma jogada (op do game_act em lib/potato.php). A mensagem atualizada volta na resposta e também chega pelo aviso.
function gameMove(message, op, extra = {}, done) {
  if (!socket?.connected) {
    // A casa já tinha sido marcada como "jogando": o tabuleiro volta a responder.
    table.busy = false;
    if (table.id === message.id) paintTable();
    return toast("Sem conexão agora. Tente de novo em instantes.", "error");
  }
  socket.timeout(10000).emit("game", { op, id: message.id, ...extra }, (error, result) => {
    table.busy = false;
    if (error || !result?.ok) {
      toast(result?.error || "Não deu certo. Tente de novo.", "error");
      sound.play("error");
      if (table.id === message.id) paintTable();
      return;
    }
    if (result.mine !== undefined && result.mine !== null) rememberPick(message.id, result.mine);
    updateMessage(result.message);
    done?.(result.message);
  });
}

// A partida aberta não veio com o histórico (já acabou, ou é antiga): o servidor diz como ela está (ou que foi apagada).
function refreshGame(id) {
  socket?.timeout(10000).emit("game", { op: "get", id }, (error, result) => {
    if (error) return;
    if (result?.ok) return updateMessage(result.message);
    games.delete(id);
    byId.delete(id);
    if (table.id === id) paintTable();
  });
}

function gameButton(label, action, value, className = "game-ctl", iconName = "") {
  const node = el("button", className);
  if (iconName) node.append(icon(iconName));
  node.append(label);
  node.type = "button";
  node.dataset.game = action;
  if (value !== undefined) node.dataset.value = JSON.stringify(value);
  return node;
}

// O cartão da partida na conversa.
function gameCard(message) {
  const game = message.game;
  const box = el("div", "game");
  box.dataset.type = game.type;
  box.append(el("span", "game-cover"));
  const head = el("div", "game-head");
  const name = el("span", "game-name");
  name.append(iconBadge(GAME_ICONS[game.type] || "dice", `game-mark game-${game.type}`), GAME_NAMES[game.type] || "Joguinho");
  head.append(name, el("small", "", message.sender === me ? "você começou" : `${message.sender} começou`));
  box.append(head);
  if (BOARD_GAMES.includes(game.type)) boardSummary(message, box);
  else if (game.type === "vd") truthOrDare(message, box);
  else if (game.type === "pergunta") questionCard(message, box);
  else voteCard(message, box);
  return box;
}

function truthOrDare(message, box) {
  const game = message.game;
  const row = el("div", "game-options");
  if (!game.choice) {
    box.append(el("p", "game-prompt", game.for === me ? "Verdade ou desafio?" : `Verdade ou desafio, ${game.for}?`));
    if (game.for === me) row.append(gameButton("Verdade", "pick", "verdade", "game-ctl game-option", "question"), gameButton("Desafio", "pick", "desafio", "game-ctl game-option", "flame"));
    else box.append(el("p", "game-wait", `Esperando ${game.for} escolher…`));
  } else {
    const chip = el("span", `game-chip ${game.choice}`);
    chip.append(icon(game.choice === "verdade" ? "question" : "flame"), game.choice === "verdade" ? "Verdade" : "Desafio");
    box.append(chip, el("p", "game-prompt big", game.prompt));
    if (game.for === me) row.append(gameButton("Responder", "reply", undefined, "game-ctl game-option", "reply"), gameButton("Sua vez", "again", undefined, "game-ctl game-option", "dice"));
    else box.append(el("p", "game-wait", `Agora é com ${game.for}`));
  }
  if (row.children.length) box.append(row);
}

// Quem é mais provável (um dos dois, cada um com a sua foto grande) e isso ou aquilo (uma das duas opções).
function voteCard(message, box) {
  const game = message.game;
  const quem = game.type === "quem";
  if (game.prompt) box.append(el("p", "game-prompt", game.prompt));
  const values = quem ? game.names : [0, 1];
  const voted = game.players.includes(me);
  const mine = game.done ? game.votes[me] : gamePicks.get(message.id);
  const row = el("div", `game-options${quem ? " who" : ""}${voted && !game.done ? " voted" : ""}`);
  for (const value of values) {
    const picks = game.done ? Object.entries(game.votes).filter(([, vote]) => vote === value).map(([name]) => name) : [];
    let option;
    if (quem) {
      // A foto (ou a inicial), com o visto em cima quando é o seu voto; no fim, quem votou nela, com as carinhas.
      option = el("button", `game-ctl game-option who-pick${picks.length === 2 ? " agreed" : ""}`);
      option.type = "button";
      option.dataset.game = "vote";
      option.dataset.value = JSON.stringify(value);
      const face = el("span", "avatar who-face");
      paintAvatar(face, value);
      const mark = el("span", "who-check");
      mark.append(icon("check"));
      face.append(mark);
      option.append(face, el("strong", "who-name", who(value)));
      if (picks.length) {
        const votes = el("small", "game-votes who-votes");
        for (const name of picks) {
          const voter = el("span", "avatar");
          paintAvatar(voter, name);
          votes.append(voter);
        }
        votes.append(picks.length === 2 ? "os dois" : who(picks[0]));
        option.append(votes);
      }
    } else {
      option = gameButton(game.options[value], "vote", value, "game-ctl game-option");
      if (picks.length) option.append(el("small", "game-votes", picks.map(who).join(" e ")));
    }
    option.disabled = voted || game.done;
    option.classList.toggle("picked", mine === value);
    row.append(option);
  }
  box.append(row);
  if (game.done) {
    const same = new Set(Object.values(game.votes).map(String)).size === 1;
    box.append(el("p", `game-result${same ? " match" : ""}`, same ? (game.type === "quem" ? "Vocês concordaram!" : "Combinaram!") : game.type === "quem" ? "Discordaram…" : "Gostos diferentes"));
  } else if (voted) {
    box.append(el("p", "game-wait", `Você já votou · esperando ${otherPlayer()}…`));
  } else if (game.players.length) {
    box.append(el("p", "game-wait", `${otherPlayer()} já votou. Sua vez!`));
  }
}

function questionCard(message, box) {
  const game = message.game;
  box.append(el("p", "game-prompt", game.prompt));
  if (game.done) {
    const answers = el("div", "game-answers");
    for (const [name, text] of Object.entries(game.answers).sort(([a]) => (a === me ? -1 : 1))) {
      const item = el("div", `game-answer${name === me ? " mine" : ""}`);
      item.append(el("small", "", who(name)), el("p", "", text));
      answers.append(item);
    }
    box.append(answers);
  } else if (game.players.includes(me)) {
    box.append(el("p", "game-wait", `Sua resposta está guardada · esperando ${otherPlayer()}…`));
  } else {
    if (game.players.length) box.append(el("p", "game-wait", `${otherPlayer()} já respondeu. Sua vez!`));
    const form = el("div", "game-form");
    const input = el("textarea", "game-ctl game-input");
    input.rows = 2;
    input.maxLength = 500;
    input.placeholder = "Sua resposta…";
    input.value = gameDrafts.get(message.id) || "";
    input.dataset.gameInput = message.id;
    form.append(input, gameButton("Responder", "answer", undefined, "game-ctl game-send"));
    box.append(form);
  }
}

// Jogo de tabuleiro na conversa: de quem é a vez (ou quem ganhou), o placar e o botão para abrir a mesinha.
function boardSummary(message, box) {
  const game = message.game;
  const yourTurn = !game.winner && game.type !== "stop" && game.turn === me;
  box.append(el("p", `game-status${yourTurn ? " your-turn" : ""}`, boardStatus(game)));
  if (game.type === "memoria" || game.type === "stop") {
    const scores = game.type === "memoria" ? game.scores : game.totals;
    box.append(el("p", "game-score", game.seats.map((name) => `${who(name)} ${scores[name] ?? 0}`).join("  ×  ")));
  }
  if (game.type === "velha") {
    const mini = el("div", "mini-velha");
    game.board.forEach((mark, cell) => {
      const square = el("span", game.line?.includes(cell) ? "win" : "");
      if (mark) square.append(velhaMark(mark));
      mini.append(square);
    });
    box.append(mini);
  }
  const row = el("div", "game-options");
  const playing = game.seats.includes(me);
  row.append(gameButton(game.winner || !playing ? "Ver" : yourTurn || game.type === "stop" ? "Jogar" : "Abrir", "open", undefined, "game-ctl game-option main"));
  if (game.winner && playing) row.append(gameButton("Revanche", "again", undefined, "game-ctl game-option", "rotate-ccw"));
  box.append(row);
}

const stopper = (name) => (name === me ? "você pediu" : `${name} pediu`);

function boardStatus(game) {
  if (game.winner) {
    const result = game.winner === "empate" ? "Deu empate!" : game.winner === me ? "Você venceu!" : `${game.winner} venceu!`;
    return game.resigned ? `${result} (${who(game.resigned)} desistiu)` : result;
  }
  if (game.type === "stop") return game.phase === "review" ? `Rodada ${game.round} · ${stopper(game.last.stoppedBy)} STOP!` : `Rodada ${game.round} · letra ${game.letter}`;
  if (game.type === "dama" && game.chain !== null) return game.turn === me ? "Continue comendo!" : `${game.turn} está comendo…`;
  return game.turn === me ? "Sua vez!" : `Vez de ${game.turn}…`;
}

function playGame(message, action, raw, article) {
  const value = raw === undefined ? undefined : JSON.parse(raw);
  if (action === "open") return openTable(message.id);
  if (action === "reply") return startReply(message);
  if (action === "again") return startGame(message.game.type);
  if (action === "pick") return gameMove(message, "pick", { choice: value });
  if (action === "vote") return gameMove(message, "vote", { value });
  if (action === "answer") {
    const input = article.querySelector("[data-game-input]");
    const text = input.value.trim();
    if (!text) return input.focus();
    gameMove(message, "answer", { text }, () => gameDrafts.delete(message.id));
  }
}

// O que mudou numa partida que chegou atualizada: fim, vez de quem, stop pedido.
function gameNotice(before, after, message) {
  if (!before || !after) return;
  if (BOARD_GAMES.includes(after.type)) {
    if (!before.winner && after.winner) {
      toast(`${GAME_NAMES[after.type]}: ${boardStatus(after)}`, after.winner === me ? "ok" : "info", "dice");
      if (after.winner === me) fx.confetti();
      sound.play(after.winner === me ? "sparkle" : "tap");
    } else if (after.type === "stop" && before.phase === "playing" && after.phase === "review" && after.last.stoppedBy !== me) {
      toast(`STOP! ${after.last.stoppedBy} parou a rodada`, "info", "hand");
      sound.play("sparkle");
    } else if (after.type !== "stop" && before.turn !== me && after.turn === me && table.id !== message.id) {
      toast(`Sua vez: ${GAME_NAMES[after.type]}`, "info", "dice");
      sound.play("receive");
    }
    return;
  }
  if (!before.done && after.done) {
    const same = after.votes ? new Set(Object.values(after.votes).map(String)).size === 1 : false;
    toast(after.type === "pergunta" ? "As respostas da perguntinha chegaram!" : same ? "Resultado: combinaram!" : "O resultado do joguinho chegou", "info", GAME_ICONS[after.type]);
    if (same) fx.confetti(40);
  } else if (after.type === "vd" && !before.choice && after.choice && after.for !== me) {
    toast(`${after.for} escolheu ${after.choice}!`, "info", after.choice === "verdade" ? "question" : "flame");
  }
}

// Resposta da perguntinha (no cartão da conversa ou na mesinha): o texto é guardado a cada letra; Enter (sem Shift) envia.
function onGameInput(event) {
  if (event.target.matches("[data-game-input]")) gameDrafts.set(event.target.dataset.gameInput, event.target.value);
}
function onGameEnter(event) {
  if (!event.target.matches("[data-game-input]") || event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  event.target.closest(".game-form").querySelector("[data-game]").click();
}
messagesEl.addEventListener("input", onGameInput);
messagesEl.addEventListener("keydown", onGameEnter);

// ---- mesinha de jogo ----
// Abre por cima de tudo, pela seção de jogos ou pelo convite na conversa. Os de tabuleiro (velha, dama, memória e
// stop) têm o tabuleiro e os dois jogadores; os de carta, a mesma carta da conversa.

const tableEl = $("#game-table");
// Partida aberta (id da mensagem), a peça escolhida na dama e a rodada do stop já montada (os campos não são refeitos a
// cada novidade). O resto é o que estava na tela na última vez, para animar só o que mudou: as cartas da memória
// viradas e com dono, o par errado, as marcas da velha e a linha da vitória, a escolha do verdade ou desafio.
const table = { id: "", selected: null, built: "", busy: false };
// Na dama, drawn = o tabuleiro desenhado (a mesma jogada chegando de novo não o refaz, para não cortar a animação) e
// ply = a última jogada animada (null = acabou de abrir: nada anima).
const tableFresh = () => ({ shown: [], matched: [], missKey: "", board: null, line: null, choice: null, done: false, dealt: false, drawn: "", ply: null });
let stopTimer = 0;

function onTableKey(event) {
  if (event.key !== "Escape" || !document.querySelector("#confirm.hidden")) return;
  event.stopPropagation();
  closeTable();
}

function openTable(id) {
  if (!byId.get(id)?.game) return;
  Object.assign(table, { id, selected: null, built: "", busy: false }, tableFresh());
  paintTable();
  tableEl.classList.remove("hidden");
  fx.incoming(tableEl.querySelector(".table-card"));
  document.addEventListener("keydown", onTableKey, true);
}

function closeTable() {
  if (!table.id) return;
  const message = byId.get(table.id);
  // Stop: o que já foi escrito vai junto ao fechar.
  if (message?.game?.type === "stop" && message.game.phase === "playing") saveStop(message);
  table.id = "";
  tableEl.classList.add("hidden");
  document.removeEventListener("keydown", onTableKey, true);
}

function paintTable() {
  const message = byId.get(table.id);
  if (!message?.game || message.deleted) return closeTable();
  const game = message.game;
  const board = BOARD_GAMES.includes(game.type);
  setIcon($("#table-icon use"), GAME_ICONS[game.type]);
  $("#table-title").textContent = GAME_NAMES[game.type];
  const status = $("#table-status");
  status.textContent = board ? boardStatus(game) : cardStatus(game);
  status.classList.toggle("your-turn", myTurn(game));
  tableEl.querySelector(".table-card").dataset.type = game.type;
  if (board) {
    paintPlayers(game);
    ({ velha: paintVelha, dama: paintDama, memoria: paintMemory, stop: paintStop })[game.type](message);
  } else {
    // Carta: uma carta de verdade na mesa, com a ilustração do jogo. Chega girando; no verdade ou desafio, vira quando
    // a escolha é feita; o resultado pula quando os dois tiverem ido.
    $("#table-players").replaceChildren();
    const card = el("div", "play-card");
    card.dataset.type = game.type;
    const box = el("div", "game in-table");
    box.dataset.type = game.type;
    if (game.type === "vd") truthOrDare(message, box);
    else if (game.type === "pergunta") questionCard(message, box);
    else voteCard(message, box);
    card.append(el("span", "play-cover"), box);
    $("#table-board").replaceChildren(card);
    if (!table.dealt) fx.dealCard(card);
    else if (game.type === "vd" && game.choice && !table.choice) fx.revealCard(card);
    else if (game.done && !table.done) fx.pop(box.querySelector(".game-result, .game-answers"));
    Object.assign(table, { dealt: true, choice: game.choice ?? null, done: Boolean(game.done) });
  }
  paintTableActions(game);
}

function cardStatus(game) {
  if (gameOpen(game)) return gameWaiting(game);
  if (game.type === "vd") return game.for === me ? `Você escolheu ${game.choice}!` : `${game.for} escolheu ${game.choice}!`;
  if (game.type === "pergunta") return "As respostas chegaram!";
  return new Set(Object.values(game.votes).map(String)).size === 1 ? "Combinaram!" : "Deu resultado";
}

function paintPlayers(game) {
  $("#table-players").replaceChildren(...game.seats.map((name, seat) => {
    const chip = el("div", `player${!game.winner && game.type !== "stop" && game.turn === name ? " turn" : ""}${name === me ? " me" : ""}`);
    const face = el("span", "avatar");
    paintAvatar(face, name);
    const detail = game.type === "velha" ? (seat === 0 ? "joga com X" : "joga com O")
      : game.type === "dama" ? (seat === 0 ? "brancas" : "pretas")
      : game.type === "memoria" ? `${game.scores[name] ?? 0} ${game.scores[name] === 1 ? "par" : "pares"}`
      : `${game.totals[name] ?? 0} pontos`;
    const text = el("span", "player-text");
    text.append(el("strong", "", who(name)), el("small", "", detail));
    chip.append(face, text);
    if (game.type === "dama") chip.append(el("span", `stone mini ${seat === 0 ? "w" : "b"}`));
    if (game.type === "stop" && game.phase === "playing") chip.append(el("b", "player-fill", `${game.filled[name] ?? 0}/${game.categories.length}`));
    return chip;
  }));
}

function svgNode(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

// Um X (dois traços) ou um O (um círculo) desenhado em SVG, para o GSAP traçar como se fosse à mão.
function velhaMark(mark, className = "mark") {
  const svg = svgNode("svg", { viewBox: "0 0 100 100", class: `${className} ${mark === "X" ? "x" : "o"}`, "aria-hidden": "true" });
  if (mark === "X") svg.append(svgNode("path", { d: "M27 27 73 73" }), svgNode("path", { d: "M73 27 27 73" }));
  else svg.append(svgNode("path", { d: "M50 23a27 27 0 1 1-.1 0" }));
  return svg;
}

// Jogo da velha: o tabuleiro riscado à mão; cada X e O é traçado quando aparece, e a linha da vitória risca as três
// casas. Na sua vez, passar por uma casa vazia mostra a sua marca bem clarinha. Embaixo, o placar da série.
function paintVelha(message) {
  const game = message.game;
  const mine = game.seats.indexOf(me) === 1 ? "O" : "X";
  const canPlay = !game.winner && game.turn === me && !table.busy;
  const board = el("div", `velha-board${canPlay ? " playable" : ""}`);
  const lines = svgNode("svg", { viewBox: "0 0 300 300", class: "velha-lines", "aria-hidden": "true" });
  for (const d of ["M100 14c-3 90-2 182 2 272", "M201 12c-2 92-3 182 1 274", "M14 101c90-4 182-3 272 2", "M12 200c92-3 182-4 274 1"]) lines.append(svgNode("path", { d }));
  board.append(lines);
  const fresh = [];
  game.board.forEach((mark, cell) => {
    const square = el("button", `velha-cell${game.line?.includes(cell) ? " win" : ""}`);
    square.type = "button";
    square.dataset.cell = String(cell);
    square.disabled = !canPlay || Boolean(mark);
    square.setAttribute("aria-label", `Casa ${cell + 1}${mark ? `: ${mark}` : ", vazia"}`);
    if (mark) {
      const drawn = velhaMark(mark);
      square.append(drawn);
      if (!table.board || table.board[cell] !== mark) fresh.push(...drawn.querySelectorAll("path"));
    } else if (canPlay) {
      square.append(velhaMark(mine, "mark ghost"));
    }
    board.append(square);
  });
  let strike = null;
  if (game.line) {
    const point = (cell) => [50 + (cell % 3) * 100, 50 + Math.floor(cell / 3) * 100];
    const [x1, y1] = point(game.line[0]);
    const [x2, y2] = point(game.line[2]);
    const length = Math.hypot(x2 - x1, y2 - y1);
    const [dx, dy] = [(x2 - x1) / length * 36, (y2 - y1) / length * 36];
    const svg = svgNode("svg", { viewBox: "0 0 300 300", class: "velha-strike", "aria-hidden": "true" });
    strike = svgNode("path", { d: `M${x1 - dx} ${y1 - dy}L${x2 + dx} ${y2 + dy}` });
    svg.append(strike);
    board.append(svg);
  }
  $("#table-board").replaceChildren(board, velhaSeries(game));
  const first = !table.board;
  fx.draw(fresh, first ? { duration: 0.3, stagger: 0.06 } : {});
  if (strike && (first || !table.line)) fx.draw([strike], { duration: 0.5, delay: first ? fresh.length * 0.06 + 0.15 : 0.4 });
  table.board = [...game.board];
  table.line = game.line;
}

// Placar da série: as partidas de jogo da velha entre vocês que estão na conversa carregada.
function velhaSeries(game) {
  const score = {};
  for (const message of loaded()) {
    const winner = message.game?.type === "velha" && !message.deleted ? message.game.winner : null;
    if (winner) score[winner] = (score[winner] || 0) + 1;
  }
  const [a, b] = game.seats;
  const line = el("p", "velha-series");
  line.append(el("span", "", "Série"), el("strong", "", `${who(a)} ${score[a] || 0} × ${score[b] || 0} ${who(b)}`));
  if (score.empate) line.append(el("span", "", `${score.empate} ${score.empate === 1 ? "empate" : "empates"}`));
  return line;
}

// Dama: quem joga com as pretas vê o tabuleiro do lado dele. As jogadas que valem vêm do servidor (moves).
function paintDama(message) {
  const game = message.game;
  const flip = game.seats.indexOf(me) === 1;
  const moves = game.turn === me && !game.winner && !table.busy ? game.moves : [];
  const movable = new Set(moves.map(([from]) => from));
  if (game.chain !== null && game.turn === me) table.selected = game.chain;
  if (!movable.has(table.selected)) table.selected = movable.size === 1 ? [...movable][0] : null;
  const targets = new Set(moves.filter(([from]) => from === table.selected).map(([, to]) => to));
  const drawn = JSON.stringify([game.board, game.ply ?? 0, game.turn, game.winner, table.selected, moves]);
  if (table.drawn === drawn) return;
  table.drawn = drawn;
  const grid = el("div", "dama-board");
  for (let position = 0; position < 64; position += 1) {
    const index = flip ? 63 - position : position;
    const dark = (Math.floor(index / 8) + (index % 8)) % 2 === 1;
    if (!dark) {
      grid.append(el("span", "sq light"));
      continue;
    }
    const square = el("button", "sq dark");
    square.type = "button";
    square.dataset.square = String(index);
    const piece = game.board[index];
    if (piece) {
      const stone = el("span", `stone ${piece.toLowerCase()}${piece !== piece.toLowerCase() ? " king" : ""}`);
      if (piece !== piece.toLowerCase()) stone.append(icon("crown"));
      square.append(stone);
    }
    square.classList.toggle("can", movable.has(index));
    square.classList.toggle("selected", table.selected === index);
    square.classList.toggle("target", targets.has(index));
    square.classList.toggle("last", Boolean(game.last?.includes(index)));
    square.disabled = !movable.has(index) && !targets.has(index);
    square.setAttribute("aria-label", piece ? `${piece.toLowerCase() === "w" ? "Branca" : "Preta"}${piece !== piece.toLowerCase() ? " (dama)" : ""}` : targets.has(index) ? "Mover para cá" : "Casa vazia");
    grid.append(square);
  }
  $("#table-board").replaceChildren(grid);
  // Jogada nova (sua ou da outra pessoa): a pedra sai da casa de onde veio e, comendo, pula por cima da outra, que sai
  // do tabuleiro.
  const ply = game.ply ?? 0;
  if (table.ply !== null && ply > table.ply && game.last) {
    const [from, to] = game.last;
    const square = (index) => grid.querySelector(`[data-square="${index}"]`);
    let ghost = null;
    if (game.taken) {
      const king = game.taken.piece !== game.taken.piece.toLowerCase();
      ghost = el("span", `stone eaten ${game.taken.piece.toLowerCase()}${king ? " king" : ""}`);
      if (king) ghost.append(icon("crown"));
      square(game.taken.at)?.append(ghost);
    }
    fx.damaMove(square(to)?.querySelector(".stone"), square(from), ghost, () => sound.play("clack"), () => sound.play("capture"));
  }
  table.ply = ply;
}

function pickSquare(message, index) {
  const game = message.game;
  if (game.turn !== me || game.winner || table.busy) return;
  const move = game.moves.find(([from, to]) => from === table.selected && to === index);
  if (move) {
    table.busy = true;
    sound.play("tap");
    return gameMove(message, "move", { from: move[0], to: move[1] });
  }
  if (game.moves.some(([from]) => from === index) && game.chain === null) {
    table.selected = index;
    sound.play("tap");
    paintTable();
  }
}

// Memória: as cartas chegam distribuídas, viram em 3D (GSAP), o par certo pula e o errado treme e vira de volta.
function paintMemory(message) {
  const game = message.game;
  const canPlay = !game.winner && game.turn === me && !table.busy;
  const grid = el("div", "memory-board");
  const flipped = [];
  const paired = [];
  const missedInners = [];
  game.cards.forEach((face, index) => {
    const owner = game.matched[index];
    const missed = game.missed?.includes(index);
    const card = el("button", `memory-card${face ? " up" : ""}${owner ? ` matched ${owner === me ? "mine" : "theirs"}` : ""}${missed ? " missed" : ""}`);
    card.type = "button";
    card.dataset.card = String(index);
    card.disabled = !canPlay || Boolean(face && !missed);
    card.setAttribute("aria-label", face && !missed ? `Carta ${index + 1}: ${face}` : `Carta ${index + 1}, virada para baixo`);
    const inner = el("span", "memory-inner");
    const back = el("span", "memory-back");
    back.append(potatoArt());
    const front = el("span", `memory-face${face ? ` face-${face}` : ""}`);
    if (face) front.append(icon(face));
    inner.append(back, front);
    card.append(inner);
    grid.append(card);
    if (face && !table.shown[index]) flipped.push(inner);
    if (owner && !table.matched[index]) paired.push(card);
    if (missed) missedInners.push(inner);
  });
  $("#table-board").replaceChildren(grid);
  const first = !table.shown.length;
  if (first) fx.deal([...grid.children]);
  else flipped.forEach((inner) => fx.flip(inner));
  if (!first) fx.match(paired);
  const missKey = game.missed?.join() || "";
  if (missKey && missKey !== table.missKey) fx.miss(missedInners);
  Object.assign(table, { shown: game.cards.map(Boolean), matched: [...game.matched], missKey });
}

// Stop: os campos são montados uma vez por rodada (as novidades do outro só mudam o placar em cima).
function stopDraft(message) {
  const key = `${message.id}:${message.game.round}`;
  const saved = store.get("localStorage", STOP_DRAFT_KEY);
  return saved?.key === key ? saved.answers : {};
}

function paintStop(message) {
  const game = message.game;
  const key = `${message.id}:${game.round}:${game.phase}`;
  if (table.built === key) return paintStopButton(message);
  table.built = key;
  const board = $("#table-board");
  if (game.phase === "playing" && game.seats.includes(me)) {
    const draft = stopDraft(message);
    const wrap = el("div", "stop-board");
    const letter = el("div", "stop-letter");
    letter.append(el("small", "", `Rodada ${game.round}`), el("strong", "", game.letter));
    const form = el("form", "stop-form");
    form.noValidate = true;
    for (const category of game.categories) {
      const label = el("label", "stop-field");
      const input = el("input");
      input.name = category;
      input.value = draft[category] || "";
      input.maxLength = 40;
      input.autocomplete = "off";
      input.autocapitalize = "words";
      input.placeholder = `${game.letter}…`;
      input.enterKeyHint = "next";
      label.append(el("span", "", category), input);
      form.append(label);
    }
    const stop = el("button", "stop-button");
    stop.append(icon("hand"), "STOP!");
    stop.type = "submit";
    form.append(stop);
    wrap.append(letter, form);
    board.replaceChildren(wrap);
    paintStopButton(message);
    return;
  }
  const last = game.last;
  if (!last) return board.replaceChildren(emptyNote(game.winner ? "Jogo encerrado." : "Esperando a rodada…"));
  const order = [...game.seats].sort((a) => (a === me ? -1 : 1));
  const review = el("div", "stop-review");
  review.append(el("p", "stop-round", `Rodada ${last.round} · letra ${last.letter} · ${stopper(last.stoppedBy)} STOP`));
  const grid = el("div", "stop-grid");
  grid.append(el("span", "stop-head"), ...order.map((name) => el("span", "stop-head", who(name))));
  for (const category of game.categories) {
    grid.append(el("span", "stop-category", category));
    for (const name of order) {
      const points = last.points[name][category];
      const cell = el("span", `stop-answer p${points}`);
      cell.append(el("span", "", last.answers[name][category] || "—"), el("b", "", `+${points}`));
      grid.append(cell);
    }
  }
  grid.append(el("span", "stop-category", "Rodada"), ...order.map((name) => el("strong", "stop-total", `+${Object.values(last.points[name]).reduce((sum, value) => sum + value, 0)}`)));
  review.append(grid, el("p", "field-hint", "10 pontos por palavra com a letra certa, 5 se os dois escreveram a mesma."));
  board.replaceChildren(review);
  store.remove("localStorage", STOP_DRAFT_KEY);
}

function stopAnswers() {
  return Object.fromEntries([...tableEl.querySelectorAll(".stop-form input")].map((input) => [input.name, input.value.trim()]));
}

function paintStopButton(message) {
  const button = tableEl.querySelector(".stop-button");
  if (!button) return;
  const full = Object.values(stopAnswers()).every(Boolean);
  button.disabled = !full || table.busy;
  button.title = full ? "Acabar a rodada para os dois" : "Preencha tudo para pedir STOP";
  if (!message.game.seats.includes(me)) button.disabled = true;
}

// O que foi escrito vai para o servidor aos poucos (a outra pessoa vê só quantos campos já foram); stop = acabou!
function saveStop(message, stop = false) {
  clearTimeout(stopTimer);
  const answers = stopAnswers();
  if (!Object.keys(answers).length || !socket?.connected) return;
  if (stop) table.busy = true;
  socket.timeout(10000).emit("game", { op: "fill", id: message.id, answers, stop }, (error, result) => {
    table.busy = false;
    if (result?.ok) return updateMessage(result.message);
    if (stop) {
      toast(result?.error || "Não deu certo. Tente de novo.", "error");
      sound.play("error");
      paintStopButton(message);
    }
  });
}

tableEl.addEventListener("input", (event) => {
  const message = byId.get(table.id);
  if (!message || !event.target.closest(".stop-form")) return;
  store.set("localStorage", STOP_DRAFT_KEY, { key: `${message.id}:${message.game.round}`, answers: stopAnswers() });
  paintStopButton(message);
  clearTimeout(stopTimer);
  stopTimer = setTimeout(() => saveStop(message), 900);
});

tableEl.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !event.target.matches(".stop-form input")) return;
  event.preventDefault();
  const inputs = [...tableEl.querySelectorAll(".stop-form input")];
  const next = inputs[inputs.indexOf(event.target) + 1];
  if (next) next.focus();
  else tableEl.querySelector(".stop-form").requestSubmit();
});

tableEl.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = byId.get(table.id);
  const button = tableEl.querySelector(".stop-button");
  if (!message || !button || button.disabled) return;
  fx.press(button);
  saveStop(message, true);
});

tableEl.addEventListener("input", onGameInput);
tableEl.addEventListener("keydown", onGameEnter);

function paintTableActions(game) {
  const actions = [];
  const button = (label, action, className) => {
    const node = el("button", className, label);
    node.type = "button";
    node.dataset.tableAction = action;
    return node;
  };
  if (!BOARD_GAMES.includes(game.type)) {
    if (!gameOpen(game)) actions.push(button("Outra carta", "again", "pill gold small"));
    actions.push(button("Ver na conversa", "chat", "pill ghost small"));
    return $("#table-actions").replaceChildren(...actions);
  }
  const playing = game.seats.includes(me);
  if (game.winner && playing) actions.push(button("Revanche", "again", "pill gold small"));
  else if (game.type === "stop" && playing) {
    if (game.phase === "review") actions.push(button("Próxima rodada ▶", "next", "pill gold small"));
    actions.push(button("Encerrar o jogo", "end", "text-button"));
  } else if (playing && !game.winner) actions.push(button("Desistir", "resign", "text-button"));
  actions.push(button("Ver na conversa", "chat", "pill ghost small"));
  $("#table-actions").replaceChildren(...actions);
}

tableEl.addEventListener("click", async (event) => {
  if (event.target === tableEl || event.target.closest("#table-close")) return closeTable();
  const message = byId.get(table.id);
  if (!message?.game) return;
  const game = message.game;
  // Carta (verdade ou desafio, votos, perguntinha): as mesmas jogadas do cartão da conversa. Responder a um
  // verdade ou desafio é na conversa.
  const play = event.target.closest("[data-game]");
  if (play) {
    if (play.dataset.game === "reply") {
      closeTable();
      showTab("chat");
    } else if (play.dataset.game === "again") {
      closeTable();
    }
    return playGame(message, play.dataset.game, play.dataset.value, tableEl);
  }
  const cell = event.target.closest("[data-cell]");
  if (cell && !table.busy) {
    table.busy = true;
    sound.play("tap");
    paintTable();
    return gameMove(message, "move", { cell: Number(cell.dataset.cell) });
  }
  const square = event.target.closest("[data-square]");
  if (square) return pickSquare(message, Number(square.dataset.square));
  const card = event.target.closest("[data-card]");
  if (card && !table.busy) {
    table.busy = true;
    sound.play("tap");
    return gameMove(message, "flip", { index: Number(card.dataset.card) });
  }
  const action = event.target.closest("[data-table-action]")?.dataset.tableAction;
  if (action === "again") {
    closeTable();
    startGame(game.type);
  } else if (action === "chat") {
    closeTable();
    showTab("chat");
    focusMessage(message.id);
  } else if (action === "next") {
    gameMove(message, "next");
  } else if (action === "end") {
    if (await confirmDialog({ title: "Encerrar o stop?", text: "Quem tiver mais pontos agora ganha.", confirm: "Encerrar" })) gameMove(message, "end");
  } else if (action === "resign") {
    if (await confirmDialog({ title: "Desistir da partida?", text: `${otherPlayer()} ganha essa.`, confirm: "Desistir" })) gameMove(message, "resign");
  }
});

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
