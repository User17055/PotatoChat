// Batata Watch Party na Netflix e na HBO Max: o player desta aba segue a sala (play, pause e o segundo),
// e o que a pessoa faz aqui (pausar, continuar, pular) vale para os dois. Cada um usa a própria conta.
// Como no Rave: quem abriu a Netflix pelo catálogo da sala escolhe aqui mesmo; no play, a sala começa para os dois
// com esse título, e a aba da Netflix da outra pessoa vai junto (no próximo episódio também).

const service = location.hostname.includes("netflix") ? "netflix" : "max";
const serviceName = service === "netflix" ? "Netflix" : "HBO Max";
let room = null; // { state, offset } vindo do serviço de fundo
let ours = 0; // quando foi a última mudança feita por nós (para não devolver para a sala)
let countdownTimer = 0;
let announced = ""; // o que esta aba já avisou (título + sessão + quem estava escolhendo)
let followed = ""; // a sessão da sala que esta aba já seguiu
let leaving = false; // indo para o título da sala: esta página já está de saída e não avisa mais nada

const video = () => [...document.querySelectorAll("video")].find((item) => item.duration > 0) || document.querySelector("video");
const serverNow = () => Date.now() + (room?.offset || 0);
// O título pelo endereço: na Netflix, /watch/123; na HBO Max, /video/watch/<id>/<id>.
const titleId = (url) => (String(url || "").match(/\/watch\/([^?#]+)/) || [])[1] || "";
const playingUrl = () => {
  const id = titleId(location.pathname);
  if (!id) return "";
  return service === "netflix" ? `https://www.netflix.com/watch/${id.split("/")[0]}` : `${location.origin}/video/watch/${id}`;
};
// A sala está neste serviço. Num título certo, só a aba desse título segue (a sessão sem título vale para qualquer um).
const active = () => {
  const now = room?.state?.now;
  return now?.source === service && (!titleId(now.url) || titleId(now.url) === titleId(location.pathname));
};
// Em que segundo a sala está (antes do fim da contagem, parado no mesmo segundo).
const sharedAt = () => {
  const { state } = room;
  return state.playing ? state.position + Math.max(0, serverNow() - state.updatedAt) / 1000 : state.position;
};

// Na Netflix, mexer direto no <video> trava o player: os comandos vão para o player dela (netflix-main.js).
function command(name, seconds) {
  ours = Date.now();
  if (service === "netflix") return window.postMessage({ potato: name, ms: Math.round((seconds || 0) * 1000) }, location.origin);
  const element = video();
  if (!element) return;
  if (name === "seek") element.currentTime = seconds;
  else if (name === "play") element.play().catch(() => {});
  else element.pause();
}

function apply() {
  clearTimeout(countdownTimer);
  if (leaving || !active()) return;
  const element = video();
  if (!element) return;
  const target = sharedAt();
  if (Math.abs(element.currentTime - target) > 2.5) command("seek", target);
  // Contagem: espera até o momento combinado para dar o play.
  const wait = room.state.updatedAt - serverNow();
  if (room.state.playing && wait > 0) {
    if (!element.paused) command("pause");
    countdownTimer = setTimeout(apply, wait);
    return;
  }
  if (room.state.playing && element.paused) command("play");
  else if (!room.state.playing && !element.paused) command("pause");
}

function report(op) {
  if (leaving || !active() || Date.now() - ours < 1500) return;
  const element = video();
  if (!element) return;
  if (op === "pause" && !room.state.playing) return;
  if (op === "resume" && room.state.playing) return;
  if (op === "seek" && Math.abs(element.currentTime - sharedAt()) < 2.5) return;
  chrome.runtime.sendMessage({ type: "potato-watch-action", op, position: element.currentTime, duration: element.duration }).catch(() => {});
}

// O nome do que está passando, para a sala mostrar: o do player (Netflix: série e episódio) ou o da aba.
function pageTitle() {
  const shown = document.querySelector('[data-uia="video-title"]');
  const parts = shown ? [...shown.children].map((node) => node.textContent.trim()).filter(Boolean).slice(0, 2) : [];
  const fromTab = document.title.replace(/\s*[|–—-]\s*(Netflix|HBO Max|Max)\s*$/i, "").replace(/^(Assistir|Watch)\s+/i, "").trim();
  const title = parts.join(" · ") || shown?.textContent.trim() || (/^(netflix|hbo max|max)?$/i.test(fromTab) ? "" : fromTab);
  return (title || serviceName).slice(0, 120);
}

// Deu o play num título aqui: avisa o serviço de fundo, que decide se a sala começa (ou troca) para os dois.
// Espera um pouco o nome aparecer no player.
function announce() {
  const url = playingUrl();
  const element = video();
  // Sem sessão deste serviço na sala, avisa de novo a cada 15 s: se um aviso se perder, a sala começa no próximo.
  // Com sessão, não: um título velho tocando aqui não pode ficar puxando a sala.
  const retry = room?.state?.now?.source === service ? "" : Math.floor(Date.now() / 15000);
  const key = `${url}|${room?.state?.now?.uid || ""}|${JSON.stringify(room?.state?.browsing || null)}|${retry}`;
  if (leaving || !url || !element || element.paused || announced === key) return;
  announced = key;
  let tries = 0;
  const send = () => {
    const title = pageTitle();
    if (title === serviceName && tries++ < 6) return setTimeout(send, 500);
    chrome.runtime.sendMessage({ type: "potato-watch-playing", service, url, title, position: element.currentTime }).catch(() => {});
  };
  send();
}

// A sala começou ou trocou de título (a outra pessoa escolheu, ou passou para o próximo episódio): esta aba vai
// junto, uma vez por sessão. A sessão sem título (começada no celular) não mexe aqui. Indo, esta página para de
// avisar: o título velho dela ainda tocando não pode puxar a sala de volta.
function follow() {
  const now = room?.state?.now;
  if (now?.source !== service || !titleId(now.url) || followed === now.uid) return false;
  followed = now.uid;
  if (titleId(now.url) === titleId(location.pathname)) return false;
  leaving = true;
  location.assign(now.url);
  return true;
}

function bind(element) {
  if (element.dataset.potato) return;
  element.dataset.potato = "1";
  // O player daqui começa sozinho ao abrir: nos primeiros segundos quem manda é a sala, e esse play não vale para
  // os dois (com a sala pausada, ela continua pausada).
  ours = Date.now() + 1500;
  element.addEventListener("play", () => {
    report("resume");
    announce();
  });
  element.addEventListener("pause", () => report("pause"));
  element.addEventListener("seeked", () => report("seek"));
  apply();
}

function update(saved) {
  if (saved) room = saved;
  if (leaving || follow()) return;
  apply();
  announce();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "potato-watch") update(message);
});

chrome.runtime.sendMessage({ type: "potato-watch-hello" }).then(update).catch(() => {});

// O player da Netflix troca o <video> ao mudar de episódio: fica de olho (e pega o que já estiver na página).
const watchVideo = () => {
  const element = video();
  if (element) bind(element);
};
new MutationObserver(watchVideo).observe(document.documentElement, { childList: true, subtree: true });
watchVideo();

setInterval(() => {
  watchVideo();
  apply();
  announce();
}, 4000);
