// Batata Watch Party na Netflix e na HBO Max: o player desta aba segue a sala (play, pause e o segundo),
// e o que a pessoa faz aqui (pausar, continuar, pular) vale para os dois. Cada um usa a própria conta.

const service = location.hostname.includes("netflix") ? "netflix" : "max";
let room = null; // { state, offset } vindo do serviço de fundo
let ours = 0; // quando foi a última mudança feita por nós (para não devolver para a sala)
let countdownTimer = 0;

const video = () => [...document.querySelectorAll("video")].find((item) => item.duration > 0) || document.querySelector("video");
const active = () => room?.state?.now?.source === service;
const serverNow = () => Date.now() + (room?.offset || 0);
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
  if (!active()) return;
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
  if (!active() || Date.now() - ours < 1500) return;
  const element = video();
  if (!element) return;
  if (op === "pause" && !room.state.playing) return;
  if (op === "resume" && room.state.playing) return;
  if (op === "seek" && Math.abs(element.currentTime - sharedAt()) < 2.5) return;
  chrome.runtime.sendMessage({ type: "potato-watch-action", op, position: element.currentTime, duration: element.duration }).catch(() => {});
}

function bind(element) {
  if (element.dataset.potato) return;
  element.dataset.potato = "1";
  element.addEventListener("play", () => report("resume"));
  element.addEventListener("pause", () => report("pause"));
  element.addEventListener("seeked", () => report("seek"));
  apply();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "potato-watch") return;
  room = message;
  apply();
});

chrome.runtime.sendMessage({ type: "potato-watch-hello" }).then((saved) => {
  if (saved) room = saved;
  apply();
}).catch(() => {});

// O player da Netflix troca o <video> ao mudar de episódio: fica de olho.
new MutationObserver(() => {
  const element = video();
  if (element) bind(element);
}).observe(document.documentElement, { childList: true, subtree: true });

setInterval(apply, 4000);
