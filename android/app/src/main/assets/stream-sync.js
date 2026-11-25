// Batata Watch Party no app do Android (StreamOverlay.kt): roda na própria página da Netflix ou da HBO Max, no navegador
// do app, com a conta de cada um. O player daqui segue a sala (play, pause e o segundo), e o que a pessoa faz aqui
// (pausar, continuar, pular, escolher um título) vale para os dois. É a mesma lógica da extensão do Chrome
// (versao-php/extensao/watch-content.js e netflix-main.js); as mensagens vão pelo app (PotatoStream) até o site, que
// fala com a sala.
(() => {
  if (window.__potatoStreamReady) return;
  window.__potatoStreamReady = true;
  const service = location.hostname.includes("netflix") ? "netflix" : "max";
  const serviceName = service === "netflix" ? "Netflix" : "HBO Max";
  const post = (value) => { try { window.PotatoStream.postMessage(JSON.stringify(value)); } catch (_) {} };
  // A sala, como o site manda: { now: { source, url, uid } | null, playing, position, updatedAt, offset, choosing }.
  let room = null;
  let ours = 0; // quando foi a última mudança feita por nós (para não devolver para a sala)
  let waitTimer = 0;
  let announced = ""; // o que esta página já avisou (título + sessão + o que a pessoa estava escolhendo)
  let followed = ""; // a sessão da sala que esta página já seguiu
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
  // A sala está neste serviço. Num título certo, só a página desse título segue (a sessão sem título vale para qualquer um).
  const active = () => {
    const now = room?.now;
    return now?.source === service && (!titleId(now.url) || titleId(now.url) === titleId(location.pathname));
  };
  // Em que segundo a sala está (antes do fim da contagem, parado no mesmo segundo).
  const sharedAt = () => (room.playing ? room.position + Math.max(0, serverNow() - room.updatedAt) / 1000 : room.position);

  // Na Netflix, mexer direto no <video> trava o player: os comandos vão pelo player dela.
  function netflixPlayer() {
    try {
      const api = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      const sessions = api.getAllPlayerSessionIds();
      return api.getVideoPlayerBySessionId(sessions.find((id) => id.includes("watch")) || sessions[0]);
    } catch (_) {
      return null;
    }
  }

  function command(name, seconds) {
    ours = Date.now();
    const player = service === "netflix" ? netflixPlayer() : null;
    if (player) {
      if (name === "seek") player.seek(Math.round((seconds || 0) * 1000));
      else if (name === "play") player.play();
      else player.pause();
      return;
    }
    const element = video();
    if (!element) return;
    if (name === "seek") {
      if (service !== "netflix") element.currentTime = seconds;
    } else if (name === "play") element.play().catch(() => {});
    else element.pause();
  }

  function apply() {
    clearTimeout(waitTimer);
    if (leaving || !room || !active()) return;
    const element = video();
    if (!element) return;
    const target = sharedAt();
    if (Math.abs(element.currentTime - target) > 2.5) command("seek", target);
    // Contagem: espera até o momento combinado para dar o play.
    const wait = room.updatedAt - serverNow();
    if (room.playing && wait > 0) {
      if (!element.paused) command("pause");
      waitTimer = setTimeout(apply, wait);
      return;
    }
    if (room.playing && element.paused) command("play");
    else if (!room.playing && !element.paused) command("pause");
  }

  function report(op) {
    if (leaving || !room || !active() || Date.now() - ours < 1500) return;
    const element = video();
    if (!element) return;
    if (op === "pause" && !room.playing) return;
    if (op === "resume" && room.playing) return;
    if (op === "seek" && Math.abs(element.currentTime - sharedAt()) < 2.5) return;
    post({ type: "action", op, position: element.currentTime, duration: element.duration || 0 });
  }

  // O nome do que está passando, para a sala mostrar: o do player (Netflix: série e episódio) ou o da aba.
  function pageTitle() {
    const shown = document.querySelector('[data-uia="video-title"]');
    const parts = shown ? [...shown.children].map((node) => node.textContent.trim()).filter(Boolean).slice(0, 2) : [];
    const fromTab = document.title.replace(/\s*[|–—-]\s*(Netflix|HBO Max|Max)\s*$/i, "").replace(/^(Assistir|Watch)\s+/i, "").trim();
    const title = parts.join(" · ") || shown?.textContent.trim() || (/^(netflix|hbo max|max)?$/i.test(fromTab) ? "" : fromTab);
    return (title || serviceName).slice(0, 120);
  }

  // Deu o play num título aqui: o site decide se a sala começa (ou troca) para os dois. Espera o nome aparecer.
  function announce() {
    const url = playingUrl();
    const element = video();
    // Sem sessão deste serviço na sala, avisa de novo a cada 15 s (se um aviso se perder, a sala começa no próximo).
    const retry = room?.now?.source === service ? "" : Math.floor(Date.now() / 15000);
    const key = `${url}|${room?.now?.uid || ""}|${room?.choosing || ""}|${retry}`;
    if (leaving || !url || !element || element.paused || announced === key) return;
    announced = key;
    let tries = 0;
    const send = () => {
      const title = pageTitle();
      if (title === serviceName && tries++ < 6) return setTimeout(send, 500);
      post({ type: "playing", service, url, title, position: element.currentTime });
    };
    send();
  }

  // A sala começou ou trocou de título (a outra pessoa escolheu, ou passou para o próximo episódio): esta página vai
  // junto, uma vez por sessão. A sessão sem título não mexe aqui.
  function follow() {
    const now = room?.now;
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
    // O player daqui começa sozinho ao abrir: nos primeiros segundos quem manda é a sala.
    ours = Date.now() + 1500;
    element.addEventListener("play", () => {
      report("resume");
      announce();
    });
    element.addEventListener("pause", () => report("pause"));
    element.addEventListener("seeked", () => report("seek"));
    apply();
  }

  function update() {
    if (leaving || follow()) return;
    apply();
    announce();
  }

  window.__potatoRoom = (raw) => {
    try {
      room = JSON.parse(raw);
    } catch (_) {
      return;
    }
    update();
  };

  // O player da Netflix troca o <video> ao mudar de episódio: fica de olho (e pega o que já estiver na página).
  const watchVideo = () => {
    const element = video();
    if (element) bind(element);
  };
  new MutationObserver(watchVideo).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(() => {
    watchVideo();
    apply();
    announce();
  }, 4000);
  // Pede o estado da sala ao site (pelo app).
  post({ type: "hello" });
})();
