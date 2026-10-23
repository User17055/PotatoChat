// Efeitos visuais com GSAP. Tudo vira no-op se o GSAP não carregar ou se a pessoa preferir menos movimento.
const gsap = window.gsap;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
const layer = () => document.querySelector("#fx");

export const motion = () => Boolean(gsap) && !reduced.matches;

function particle(content, className = "particle") {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = content;
  layer().append(node);
  return node;
}

const rand = (min, max) => min + Math.random() * (max - min);
let cinemaTimeline = null;
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// A batata das aberturas vira uma imagem pronta, desenhada uma vez só: a casca dela usa filtros SVG de ruído,
// pesados demais para redesenhar a cada quadro enquanto ela cai, amassa e cresce (era o que travava a abertura).
let potatoArt = null;
function potatoPicture() {
  potatoArt ??= new Promise((resolve) => {
    const symbol = document.querySelector("#potato");
    const sprite = symbol?.ownerSVGElement;
    if (!symbol || !sprite) return resolve(null);
    const xml = new XMLSerializer();
    const parts = [...sprite.querySelectorAll("defs"), ...symbol.childNodes].map((node) => xml.serializeToString(node)).join("");
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = 338;
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    image.onerror = () => resolve(null);
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 142 100" width="480" height="338">${parts}</svg>`)}`;
  });
  return potatoArt;
}
// Prepara a batata e a fonte do nome (o peso 800 só aparece na Watch Party) com o navegador folgado, para a
// primeira abertura já sair lisa, sem baixar fonte nem trocar letra no meio da animação.
if (motion()) {
  (window.requestIdleCallback || ((run) => setTimeout(run, 1500)))(() => {
    potatoPicture();
    document.fonts?.load('800 40px "Poppins"').catch(() => {});
  });
}

export const fx = {
  intro() {
    if (!motion()) return;
    const potato = document.querySelector(".hero-potato svg");
    gsap.timeline({ defaults: { ease: "power3.out" } })
      .from(potato, { y: -260, rotate: -25, duration: 0.6, ease: "power2.in" })
      .to(potato, { scaleY: 0.78, scaleX: 1.16, transformOrigin: "50% 100%", duration: 0.09, ease: "power1.out" })
      .to(potato, { scaleY: 1, scaleX: 1, duration: 0.7, ease: "elastic.out(1.2, 0.35)" })
      .from(".login-panel h1 .line", { yPercent: 100, opacity: 0, stagger: 0.09, duration: 0.7 }, 0.15)
      .from(".login-panel .eyebrow, .login-panel .lead, .login-panel label, .login-panel .primary", { y: 16, opacity: 0, stagger: 0.06, duration: 0.5 }, 0.3)
      .add(() => gsap.to(potato, { rotate: 3, y: -4, duration: 2.4, ease: "sine.inOut", yoyo: true, repeat: -1 }));
  },

  // Clique na batata: amassa, pula e solta batatinhas.
  squish(potato) {
    if (!motion()) return;
    const box = potato.getBoundingClientRect();
    gsap.timeline()
      .to(potato, { scaleY: 0.72, scaleX: 1.2, transformOrigin: "50% 100%", duration: 0.1 })
      .to(potato, { scaleY: 1, scaleX: 1, y: -40, rotate: "+=360", duration: 0.45, ease: "power2.out" })
      .to(potato, { y: 0, duration: 0.5, ease: "bounce.out" });
    this.burst(box.left + box.width / 2, box.top + box.height / 2, ["🥔", "🍟", "✨"], 12);
  },

  ambient() {
    if (!motion()) return;
    document.querySelectorAll(".ambient span").forEach((orb, i) => {
      gsap.to(orb, { x: () => rand(-140, 140), y: () => rand(-100, 100), scale: () => rand(0.85, 1.25), duration: rand(9, 15), ease: "sine.inOut", repeat: -1, yoyo: true, repeatRefresh: true, delay: i * 0.8 });
    });
  },

  shake(element) {
    if (!motion()) return;
    gsap.fromTo(element, { x: 0 }, { x: 0, duration: 0.5, ease: "none", keyframes: { x: [-12, 10, -8, 6, -3, 0] } });
  },

  enterChat(done) {
    if (!motion()) return done();
    gsap.to(".login-panel", {
      scale: 0.92, opacity: 0, y: -30, duration: 0.45, ease: "power2.in",
      onComplete: () => {
        done();
        const clear = { clearProps: "transform,opacity" };
        const items = gsap.utils.toArray(".messages .message, .messages .day").slice(-14);
        const timeline = gsap.timeline({ defaults: { ease: "power3.out" } })
          .fromTo(".sidebar", { x: -60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.6, ...clear })
          .fromTo(".peer", { y: -18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ...clear }, "-=0.4")
          .fromTo(".actions .icon-button", { scale: 0 }, { scale: 1, stagger: 0.05, duration: 0.45, ease: "back.out(2.5)", ...clear }, "-=0.35")
          .fromTo(".composer", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ...clear }, "-=0.45");
        if (items.length) timeline.fromTo(items, { y: 18, opacity: 0 }, { y: 0, opacity: 1, stagger: { each: 0.025, from: "end" }, duration: 0.4, ...clear }, "-=0.5");
      }
    });
  },

  message(element, mine) {
    if (!motion()) return;
    const bubble = element.querySelector(".bubble");
    gsap.fromTo(element, { opacity: 0, y: 22, x: mine ? 26 : -26 }, { opacity: 1, y: 0, x: 0, duration: 0.5, ease: "back.out(1.6)", clearProps: "transform,opacity" });
    gsap.fromTo(bubble, { scale: 0.6, transformOrigin: mine ? "100% 100%" : "0% 100%" }, { scale: 1, duration: 0.55, ease: "elastic.out(1, 0.65)", clearProps: "transform" });
  },

  sent(element) {
    if (!motion()) return;
    gsap.fromTo(element.querySelector(".status"), { scale: 0 }, { scale: 1, duration: 0.35, ease: "back.out(3)" });
  },

  remove(element, done) {
    if (!motion()) return done();
    gsap.to(element.querySelector(".bubble"), { scale: 0.9, opacity: 0.3, duration: 0.18, yoyo: true, repeat: 1, onComplete: done });
  },

  pop(element) {
    if (!motion() || !element) return;
    gsap.fromTo(element, { scale: 0.2 }, { scale: 1, duration: 0.6, ease: "elastic.out(1.2, 0.45)" });
  },

  press(element) {
    if (!motion()) return;
    gsap.fromTo(element, { scale: 0.82 }, { scale: 1, duration: 0.5, ease: "elastic.out(1.1, 0.4)" });
  },

  sendButton(button) {
    if (!motion()) return;
    const icon = button.querySelector("svg");
    gsap.timeline()
      .to(icon, { y: -26, opacity: 0, duration: 0.18, ease: "power2.in" })
      .set(icon, { y: 22 })
      .to(icon, { y: 0, opacity: 1, duration: 0.35, ease: "back.out(2)" });
    this.press(button);
  },

  // Gravar sem segurar: a faixa nasce do botão de enviar, com mola, e o parar, o tempo e a lixeira pulam em seguida.
  recorder(form) {
    if (!motion()) return;
    gsap.fromTo(form.querySelector(".rec-pill"), { scaleX: 0.15, scaleY: 0.6, opacity: 0, transformOrigin: "100% 50%" },
      { scaleX: 1, scaleY: 1, opacity: 1, duration: 0.75, ease: "elastic.out(1, 0.7)", clearProps: "transform,opacity" });
    gsap.fromTo(form.querySelectorAll(".rec-stop, .rec-clock, .rec-cancel"), { scale: 0, opacity: 0 },
      { scale: 1, opacity: 1, duration: 0.5, stagger: 0.08, delay: 0.15, ease: "back.out(2.6)", clearProps: "transform,opacity" });
    this.press(form.querySelector(".mic"));
  },

  // Parou para ouvir: a onda inteira cresce da esquerda para a direita, e o play aparece pulando.
  recorderReview(bars, button) {
    if (!motion()) return;
    if (bars.length) gsap.fromTo(bars, { scaleY: 0 }, { scaleY: 1, duration: 0.5, stagger: 0.012, ease: "back.out(3)", clearProps: "transform" });
    this.pop(button);
  },

  // Fim da faixa: enviando, ela encolhe para o enviar e o aviãozinho voa; apagando, cai na lixeira, que treme.
  // done volta o campo de mensagem ao normal (na hora, sem animação ou segurando o microfone).
  recorderOut(form, sent, done) {
    if (!motion() || !form.classList.contains("rec-locked")) return done();
    const pill = form.querySelector(".rec-pill");
    const plane = form.querySelector(".mic .when-send");
    const finish = () => {
      gsap.set([pill, plane], { clearProps: "transform,opacity" });
      done();
    };
    if (sent) {
      gsap.to(plane, { x: 28, y: -28, rotate: -12, opacity: 0, duration: 0.3, ease: "power2.in" });
      gsap.to(pill, { scaleX: 0.08, opacity: 0, transformOrigin: "100% 50%", duration: 0.3, ease: "power3.in", onComplete: finish });
    } else {
      this.shake(form.querySelector(".rec-cancel"));
      gsap.to(pill, { y: 30, scale: 0.5, opacity: 0, transformOrigin: "0% 100%", duration: 0.32, ease: "power2.in", onComplete: finish });
    }
  },

  show(element, from = { y: 12 }) {
    element.classList.remove("hidden");
    if (motion()) gsap.fromTo(element, { opacity: 0, ...from }, { opacity: 1, x: 0, y: 0, scale: 1, duration: 0.35, ease: "power3.out" });
  },

  // Troca de aba: a tela nova desliza do lado de onde veio; no perfil, os blocos entram um a um.
  view(element, direction = 1) {
    if (!motion()) return;
    gsap.fromTo(element, { opacity: 0, x: 28 * direction }, { opacity: 1, x: 0, duration: 0.4, ease: "power3.out", clearProps: "transform,opacity" });
    const items = element.querySelectorAll(".profile-hero > *, .profile-stats > div, .profile-card, .us-pane:not(.hidden) :is(.day-card, .us-card, .goal-card, .letter-card, .game-tile, .event-row)");
    if (items.length) gsap.fromTo(items, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.045, delay: 0.05, ease: "power3.out", clearProps: "transform,opacity" });
  },

  // Número que sobe contando até o valor novo.
  count(element, value) {
    const format = (n) => Math.round(n).toLocaleString("pt-BR");
    const from = Number(element.dataset.value || 0);
    element.dataset.value = value;
    if (!motion() || from === value) {
      element.textContent = format(value);
      return;
    }
    const state = { n: from };
    gsap.to(state, { n: value, duration: 1.1, ease: "power2.out", onUpdate: () => { element.textContent = format(state.n); } });
  },

  // Segurar a mensagem (celular): o balão afunda devagar e volta com mola quando o menu abre.
  hold(bubble) {
    if (motion()) gsap.to(bubble, { scale: 0.95, duration: 0.4, delay: 0.08, ease: "power1.in", overwrite: true });
  },

  release(bubble, opened) {
    if (!gsap) return;
    gsap.to(bubble, opened
      ? { scale: 1, duration: 0.6, ease: "elastic.out(1.2, 0.45)", overwrite: true, clearProps: "transform" }
      : { scale: 1, duration: 0.2, overwrite: true, clearProps: "transform" });
  },

  // Arrastar para responder: o balão segue o dedo e o ícone de resposta cresce junto.
  swipe(targets, hint, offset, progress) {
    if (gsap) {
      gsap.set(targets, { x: offset });
      gsap.set(hint, { yPercent: -50, scale: 0.5 + progress * 0.5, opacity: progress });
      return;
    }
    targets.forEach((node) => { node.style.transform = `translateX(${offset}px)`; });
    hint.style.opacity = progress;
  },

  swipeBack(targets, hint) {
    if (!motion()) {
      hint.remove();
      if (gsap) gsap.set(targets, { clearProps: "transform" });
      else targets.forEach((node) => { node.style.transform = ""; });
      return;
    }
    gsap.to(hint, { opacity: 0, scale: 0.5, duration: 0.2, onComplete: () => hint.remove() });
    gsap.to(targets, { x: 0, duration: 0.55, ease: "elastic.out(1, 0.6)", clearProps: "transform" });
  },

  // Troca de tema: as cores novas se espalham num círculo a partir de onde a pessoa tocou.
  reveal(update, x, y) {
    if (!motion() || !document.startViewTransition) {
      update();
      return Promise.resolve();
    }
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const transition = document.startViewTransition(update);
    transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 700, easing: "cubic-bezier(.65, 0, .35, 1)", pseudoElement: "::view-transition-new(root)" }
      );
    }).catch(() => {});
    return transition.updateCallbackDone;
  },

  hide(element, to = { y: 12 }) {
    if (element.classList.contains("hidden")) return;
    if (!motion()) return element.classList.add("hidden");
    gsap.to(element, { opacity: 0, ...to, duration: 0.22, ease: "power2.in", onComplete: () => { element.classList.add("hidden"); gsap.set(element, { clearProps: "all" }); } });
  },

  // As bolinhas pulam em onda pelo CSS (.typing.on em styles.css); aqui só a entrada e a saída.
  typing(element, active) {
    if (!motion()) return element.classList.toggle("on", active);
    gsap.killTweensOf(element);
    if (active) {
      element.classList.add("on");
      gsap.fromTo(element, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.25 });
    } else {
      gsap.to(element, { opacity: 0, duration: 0.2, onComplete: () => element.classList.remove("on") });
    }
  },

  // Batata Watch Party: abertura e encerramento de cinema. Só transform e opacidade em camadas prontas: nada é
  // redesenhado a cada quadro (é o que deixa leve, até no celular).
  // Entrando: faixas pretas de cinema, a batata cai e amassa no chão com o "ta-dum", o nome entra letra por letra e
  // brilha; a câmera mergulha no logo, as faixas de luz passam pelos lados e tudo vira um clarão. Por trás do
  // clarão o site vira sala (swap), a luz segura um instante enquanto o navegador monta a sala, e as faixas abrem.
  // Saindo: as faixas pretas fecham, o logo volta com "até a próxima sessão", as letras caem, a batata dá tchau e
  // a conversa aparece. Um toque na tela acelera. done() roda no fim (o que é pesado, como o player, entra depois).
  // cue(nome) toca os sons: "cinema" (ta-dum), "dive" (mergulho), "outro" (saída) e "bye" (tchau da batata).
  cinema(entering, swap, cue, done) {
    cinemaTimeline?.progress(1);
    if (!motion()) {
      swap();
      done?.();
      return;
    }
    const overlay = document.createElement("div");
    overlay.className = entering ? "wp-intro" : "wp-intro leaving";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = '<i class="wp-black"></i><i class="wp-glow"></i><div class="wp-ribbons"></div><i class="wp-shade"></i><div class="wp-logo"><span class="wp-mark"><i class="wp-ring"></i><span class="wp-potato"></span></span><span class="wp-batata"></span><span class="wp-title"></span><span class="wp-bye">até a próxima sessão</span></div><i class="wp-bar"></i><i class="wp-bar low"></i><i class="wp-flash"></i>';
    const part = (name) => overlay.querySelector(`.wp-${name}`);
    const letters = (name, text) => {
      for (const char of text) {
        const letter = document.createElement("span");
        letter.textContent = char === " " ? " " : char;
        part(name).append(letter);
      }
      return part(name).children;
    };
    const small = letters("batata", "BATATA");
    const big = letters("title", "WATCH PARTY");
    const potato = part("potato");
    potatoPicture().then((art) => {
      if (!art) {
        potato.innerHTML = '<svg viewBox="0 0 142 100"><use href="#potato"></use></svg>';
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = art.width;
      canvas.height = art.height;
      canvas.getContext("2d").drawImage(art, 0, 0);
      potato.append(canvas);
    });
    // Faixas de luz: escondidas atrás do logo, num feixe estreito; no mergulho, cada uma vai para um lado.
    const ribbons = part("ribbons");
    const colors = ["#f5c04f", "#ffb020", "#ff7a1a", "#ff3b5c", "#e50914", "#ff2d95", "#bf5af2", "#7c3aed", "#5e5ce6", "#64d2ff"];
    const spread = [];
    if (entering) {
      for (let i = 0; i < (innerWidth < 700 ? 24 : 36); i++) {
        const ribbon = document.createElement("i");
        ribbon.style.setProperty("--c", pick(colors));
        ribbon.style.width = `${rand(3, 18).toFixed(1)}px`;
        spread.push((i % 2 ? 1 : -1) * Math.random() ** 1.4);
        ribbons.append(ribbon);
      }
    }
    document.body.append(overlay);
    const [black, glow, shade, ring, logo, bye, flash] = ["black", "glow", "shade", "ring", "logo", "bye", "flash"].map(part);
    const bars = overlay.querySelectorAll(".wp-bar");
    const strips = ribbons.children;
    const away = (index) => (index ? 100 : -100);
    const hurry = () => timeline.timeScale(3);
    const timeline = cinemaTimeline = gsap.timeline({
      paused: true,
      onComplete: () => {
        overlay.remove();
        removeEventListener("pointerdown", hurry);
        if (cinemaTimeline === timeline) cinemaTimeline = null;
        done?.();
      }
    });
    // Só começa depois do primeiro quadro: montar as camadas pesa uma vez e não pode comer o começo da animação.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (cinemaTimeline === timeline) timeline.play();
    }));
    gsap.set(bars, { yPercent: away });
    addEventListener("pointerdown", hurry, { once: true });
    if (!entering) {
      gsap.set([small, big], { opacity: 1 });
      timeline
        // As faixas pretas fecham e o logo volta, como o fim de um filme.
        .add(() => cue?.("outro"), 0)
        .to(bars, { yPercent: 0, duration: 0.5, ease: "expo.out" }, 0)
        .to(black, { opacity: 1, duration: 0.4, ease: "power2.inOut" }, 0)
        .fromTo(logo, { scale: 1.12, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: "expo.out" }, 0.22)
        .fromTo(glow, { scale: 0.6 }, { scale: 1, opacity: 0.8, duration: 0.6, ease: "expo.out" }, 0.22)
        .add(swap, 0.42)
        .fromTo(bye, { y: 8 }, { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }, 0.5)
        // As letras caem, a batata dá um pulinho e some com um tchau.
        .to(big, { y: 40, rotateX: 90, opacity: 0, duration: 0.4, stagger: { each: 0.03, from: "edges" }, ease: "power2.in" }, 1.0)
        .to([small, bye], { opacity: 0, duration: 0.3, stagger: 0.02 }, 1.05)
        .to(potato, { y: -30, duration: 0.18, ease: "power2.out" }, 1.08)
        .add(() => cue?.("bye"), 1.26)
        .to(potato, { y: 0, scale: 0, rotate: 30, duration: 0.3, ease: "back.in(2)" }, 1.26)
        .to(glow, { opacity: 0, duration: 0.3 }, 1.3)
        .to(black, { opacity: 0, duration: 0.5, ease: "power2.out" }, 1.5)
        .to(bars, { yPercent: away, duration: 0.6, ease: "expo.inOut" }, 1.55);
      return;
    }
    gsap.set(strips, { x: (index) => spread[index] * Math.min(innerWidth * 0.05, 44), scaleY: 0.25 });
    timeline
      // Escurece em formato de cinema.
      .to(black, { opacity: 1, duration: 0.35, ease: "power2.inOut" }, 0)
      .to(bars, { yPercent: 0, duration: 0.6, ease: "expo.out" }, 0)
      // A batata cai do alto, amassa no chão e volta: "ta-dum", com uma onda de luz no chão.
      .fromTo(potato, { y: () => -innerHeight * 0.6, rotate: -28 }, { y: 0, rotate: 0, duration: 0.42, ease: "power2.in" }, 0.15)
      .add(() => cue?.("cinema"), 0.55)
      .to(potato, { scaleX: 1.22, scaleY: 0.72, duration: 0.08, ease: "power1.out" }, 0.57)
      .to(potato, { scaleX: 1, scaleY: 1, duration: 0.75, ease: "elastic.out(1.1, 0.4)" }, 0.65)
      .fromTo(ring, { scale: 0.3, opacity: 0.9 }, { scale: 3.2, opacity: 0, duration: 0.9, ease: "expo.out", immediateRender: false }, 0.57)
      .fromTo(glow, { scale: 0.5 }, { scale: 1, opacity: 1, duration: 0.9, ease: "expo.out" }, 0.57)
      // BATATA chega do meio para fora; WATCH PARTY sobe letra por letra.
      .fromTo(small, { x: (index) => (index - 2.5) * 26 }, { x: 0, opacity: 1, duration: 0.8, ease: "expo.out" }, 0.62)
      .fromTo(big, { y: 46, rotateX: -100 }, { opacity: 1, y: 0, rotateX: 0, duration: 0.55, stagger: 0.028, ease: "back.out(1.8)" }, 0.68)
      // Um brilho dourado passa pelas letras.
      .fromTo(big, { filter: "drop-shadow(0px 0px 0px rgba(255, 207, 90, 0))" }, { filter: "drop-shadow(0px 0px 14px rgba(255, 207, 90, 1))", duration: 0.16, stagger: 0.03, yoyo: true, repeat: 1, ease: "sine.inOut", immediateRender: false }, 1.22)
      .fromTo(logo, { scale: 0.94 }, { scale: 1.04, duration: 1, ease: "sine.inOut" }, 0.55)
      // Mergulho: a câmera entra no logo e as faixas de luz abrem para os lados, cada vez mais rápido.
      .add(() => cue?.("dive"), 1.5)
      .to(logo, { scale: 5, duration: 0.6, ease: "power3.in" }, 1.55)
      .to(logo, { opacity: 0, duration: 0.22, ease: "power2.in" }, 1.88)
      .to(glow, { scale: 2.4, opacity: 0, duration: 0.7, ease: "power3.in" }, 1.55)
      .to(strips, { opacity: () => rand(0.55, 0.95), duration: 0.25, stagger: { each: 0.008, from: "center" } }, 1.5)
      .to(strips, { scaleY: 1.5, duration: 0.85, ease: "power2.out" }, 1.5)
      .to(strips, { x: (index) => spread[index] * innerWidth * 0.8, scaleX: () => rand(3, 9), duration: 0.75, ease: "power3.in" }, 1.6)
      .to(flash, { opacity: 1, duration: 0.2, ease: "power2.in" }, 2.1)
      // O site vira sala por trás do clarão; a luz segura um instante (o navegador monta a sala) e baixa.
      .add(swap, 2.3)
      .set([logo, ribbons, glow, shade], { autoAlpha: 0 }, 2.31)
      .to([flash, black], { opacity: 0, duration: 0.55, ease: "power2.out" }, 2.45)
      .to(bars, { yPercent: away, duration: 0.7, ease: "expo.inOut" }, 2.7);
  },

  toast(element) {
    if (!motion()) return setTimeout(() => element.remove(), 3500);
    gsap.timeline({ onComplete: () => element.remove() })
      .from(element, { y: -30, opacity: 0, scale: 0.9, duration: 0.45, ease: "back.out(1.8)" })
      .to(element, { y: -20, opacity: 0, duration: 0.3, ease: "power2.in" }, "+=3");
  },

  incoming(card) {
    if (!motion()) return;
    gsap.fromTo(card, { y: 40, scale: 0.9, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.5, ease: "back.out(1.7)" });
    // Anéis e botão de atender só existem na janela de chamada.
    const rings = card.querySelectorAll(".ring");
    const accept = card.querySelector(".accept");
    if (rings.length) gsap.fromTo(rings, { scale: 1, opacity: 0.6 }, { scale: 2.1, opacity: 0, duration: 1.8, ease: "power1.out", stagger: { each: 0.6, repeat: -1 } });
    if (accept) gsap.to(accept, { scale: 1.06, duration: 0.6, yoyo: true, repeat: -1, ease: "sine.inOut" });
  },

  callRings(container) {
    if (!motion()) return;
    gsap.fromTo(container.querySelectorAll(".ring"), { scale: 1, opacity: 0.5 }, { scale: 1.9, opacity: 0, duration: 2, ease: "power1.out", stagger: { each: 1, repeat: -1 } });
  },

  stopCallRings(container) {
    const rings = container.querySelectorAll(".ring");
    if (gsap && rings.length) gsap.killTweensOf(rings);
  },

  level(element, value) {
    if (gsap) gsap.to(element, { scale: 1 + Math.min(value * 1.4, 0.35), duration: 0.12, overwrite: true });
  },

  // ---- jogos e cartinhas ----

  // Cartas entrando na mesa, uma depois da outra, a partir do meio (memória).
  deal(cards) {
    if (!motion() || !cards.length) return;
    gsap.from(cards, { y: 46, rotation: () => rand(-16, 16), scale: 0.55, opacity: 0, duration: 0.6, ease: "back.out(1.7)", stagger: { each: 0.035, from: "center" }, clearProps: "transform,opacity" });
  },

  // A carta vira e mostra a figura (o verso gira em 3D).
  flip(inner) {
    if (!motion()) return;
    gsap.fromTo(inner, { rotationY: 0 }, { rotationY: 180, duration: 0.6, ease: "back.out(1.5)" });
  },

  // Par certo: as duas cartas pulam juntas.
  match(cards) {
    if (!motion() || !cards.length) return;
    gsap.fromTo(cards, { scale: 1 }, { scale: 1.14, duration: 0.18, yoyo: true, repeat: 1, ease: "power2.out", delay: 0.45, clearProps: "scale" });
  },

  // Par errado: as duas tremem e viram de volta (dá tempo de decorar onde estão).
  miss(inners, delay = 0) {
    if (!motion() || !inners.length) return;
    gsap.timeline({ delay })
      .to(inners, { x: -6, duration: 0.06, repeat: 5, yoyo: true, ease: "sine.inOut" }, 1.1)
      .to(inners, { x: 0, duration: 0.05 })
      .to(inners, { rotationY: 0, duration: 0.55, ease: "power2.inOut" }, "+=0.35");
  },

  // Traço sendo desenhado à mão (X e O do jogo da velha, o risco da vitória).
  draw(paths, { duration = 0.42, delay = 0, stagger = 0.14 } = {}) {
    if (!motion() || !paths.length) return;
    for (const path of paths) {
      const length = path.getTotalLength();
      path.style.strokeDasharray = length;
      path.style.strokeDashoffset = length;
    }
    gsap.to(paths, { strokeDashoffset: 0, duration, delay, stagger, ease: "power2.out", onComplete: () => paths.forEach((path) => { path.style.strokeDasharray = ""; path.style.strokeDashoffset = ""; }) });
  },

  // Dama: a pedra desliza da casa de onde saiu até a nova. Comendo, ela pula por cima da peça (sobe e cresce no meio do
  // caminho), que é esmagada, solta umas faíscas e sai do tabuleiro girando. land = a pedra encostando na casa;
  // eaten = a peça sendo comida (os sons).
  damaMove(stone, from, taken, land, eaten) {
    if (!stone || !from || !motion()) {
      taken?.remove();
      if (taken) eaten?.();
      land?.();
      return;
    }
    const start = from.getBoundingClientRect();
    const end = stone.parentElement.getBoundingClientRect();
    stone.classList.add("moving");
    taken?.classList.add("moving");
    const timeline = gsap.timeline({
      onComplete: () => {
        stone.classList.remove("moving");
        gsap.set(stone, { clearProps: "transform" });
        taken?.remove();
      }
    });
    timeline.fromTo(stone, { x: start.left - end.left, y: start.top - end.top }, { x: 0, y: 0, duration: taken ? 0.56 : 0.34, ease: taken ? "power1.inOut" : "power2.inOut" }, 0);
    if (!taken) return timeline.call(() => land?.(), null, 0.3);
    timeline
      .fromTo(stone, { scale: 1 }, { scale: 1.38, duration: 0.28, ease: "sine.out", yoyo: true, repeat: 1 }, 0)
      .to(taken, { scaleX: 1.18, scaleY: 0.55, duration: 0.09, ease: "power2.out" }, 0.24)
      .call(() => {
        const box = taken.getBoundingClientRect();
        fx.burst(box.left + box.width / 2, box.top + box.height / 2, ["✨", "💥"], 6);
        eaten?.();
      }, null, 0.33)
      .to(taken, { scale: 0, rotation: 220, opacity: 0, duration: 0.42, ease: "back.in(1.8)" }, 0.34)
      .call(() => land?.(), null, 0.54);
  },

  // Carta de jogo chegando na mesa (girando um pouco) ou virando para revelar o que tem.
  dealCard(card) {
    if (!motion()) return;
    gsap.from(card, { y: 70, rotation: -10, scale: 0.75, opacity: 0, duration: 0.65, ease: "back.out(1.5)", clearProps: "transform,opacity" });
  },

  revealCard(card) {
    if (!motion()) return;
    gsap.fromTo(card, { rotationY: -100, scale: 0.92 }, { rotationY: 0, scale: 1, duration: 0.75, ease: "back.out(1.4)", clearProps: "transform" });
  },

  // Cartinha: o envelope chega, o selo some, a aba abre, a carta sobe e vira a cartinha aberta.
  // Tocar no envelope pula a animação.
  letter(envelope, paper) {
    if (!motion()) {
      envelope.classList.add("hidden");
      return;
    }
    const flap = envelope.querySelector(".env-flap");
    const seal = envelope.querySelector(".env-seal");
    const sheet = envelope.querySelector(".env-sheet");
    envelope.classList.remove("hidden");
    gsap.set([flap, seal, sheet, envelope], { clearProps: "all" });
    gsap.set(paper, { opacity: 0, y: 90, scale: 0.6 });
    const timeline = gsap.timeline({
      onComplete: () => {
        envelope.classList.add("hidden");
        gsap.set(paper, { clearProps: "all" });
      }
    });
    timeline
      .fromTo(envelope, { scale: 0.35, rotation: -14, opacity: 0, y: 40 }, { scale: 1, rotation: 0, opacity: 1, y: 0, duration: 0.6, ease: "back.out(1.6)" })
      .to(envelope, { rotation: 3, duration: 0.12, yoyo: true, repeat: 3, ease: "sine.inOut" })
      .to(seal, { scale: 0, rotation: 90, opacity: 0, duration: 0.28, ease: "back.in(2)" })
      .to(flap, { rotationX: 180, duration: 0.5, ease: "power2.inOut" }, "-=0.05")
      .set(flap, { zIndex: -1 })
      .to(sheet, { y: -96, duration: 0.5, ease: "power2.out" })
      .to(envelope, { y: 90, opacity: 0, scale: 0.9, duration: 0.38, ease: "power2.in" }, "+=0.05")
      .to(paper, { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: "back.out(1.3)" }, "-=0.3");
    envelope.onclick = () => timeline.progress(1);
  },

  // Explosão de emojis a partir de um ponto (ex.: duplo clique numa mensagem).
  burst(x, y, emojis = ["❤️"], count = 12) {
    if (!motion()) return;
    for (let i = 0; i < count; i++) {
      const node = particle(pick(emojis));
      const angle = rand(0, Math.PI * 2);
      const distance = rand(50, 140);
      gsap.set(node, { x, y, xPercent: -50, yPercent: -50, scale: 0.3, fontSize: rand(16, 30) });
      gsap.timeline({ onComplete: () => node.remove() })
        .to(node, { x: x + Math.cos(angle) * distance, y: y + Math.sin(angle) * distance - 40, scale: 1, rotate: rand(-60, 60), duration: 0.7, ease: "power3.out" })
        .to(node, { y: `+=${rand(60, 120)}`, opacity: 0, duration: 0.6, ease: "power1.in" }, "-=0.15");
    }
  },

  // Corações / emojis subindo da parte de baixo da tela.
  float(emojis = ["❤️", "💖", "💕", "🥰"], count = 26) {
    if (!motion()) return;
    const { innerWidth: w, innerHeight: h } = window;
    for (let i = 0; i < count; i++) {
      const node = particle(pick(emojis));
      const x = rand(0, w);
      gsap.set(node, { x, y: h + 40, fontSize: rand(18, 44), opacity: rand(0.7, 1) });
      gsap.to(node, { y: -80, duration: rand(2.4, 4.2), delay: rand(0, 1.2), ease: "power1.in", onComplete: () => node.remove() });
      gsap.to(node, { x: x + rand(-80, 80), rotate: rand(-40, 40), duration: rand(1, 2), delay: rand(0, 1.2), ease: "sine.inOut", yoyo: true, repeat: 3 });
    }
  },

  confetti(count = 90) {
    if (!motion()) return;
    const colors = ["#f5c04f", "#ff7064", "#6fd987", "#7cc4ff", "#c592ff", "#fff3d6"];
    const { innerWidth: w, innerHeight: h } = window;
    for (let i = 0; i < count; i++) {
      const node = particle("", "confetti");
      node.style.background = pick(colors);
      const fromLeft = i % 2 === 0;
      gsap.set(node, { x: fromLeft ? -20 : w + 20, y: h * rand(0.45, 0.8), width: rand(6, 11), height: rand(10, 18), rotate: rand(0, 360) });
      gsap.timeline({ onComplete: () => node.remove() })
        .to(node, { x: fromLeft ? rand(w * 0.1, w * 0.7) : rand(w * 0.3, w * 0.9), y: rand(-40, h * 0.3), rotate: `+=${rand(180, 720)}`, duration: rand(0.7, 1.1), ease: "power3.out" })
        .to(node, { y: h + 40, x: `+=${rand(-120, 120)}`, rotate: `+=${rand(180, 900)}`, rotationX: rand(180, 720), duration: rand(1.8, 3), ease: "power1.in" });
    }
  },

  // Emojis caindo do topo (ex.: "boa noite", "kkkk").
  rain(emojis, count = 30) {
    if (!motion()) return;
    const { innerWidth: w, innerHeight: h } = window;
    for (let i = 0; i < count; i++) {
      const node = particle(pick(emojis));
      gsap.set(node, { x: rand(0, w), y: -60, fontSize: rand(18, 38) });
      gsap.to(node, { y: h + 60, x: `+=${rand(-60, 60)}`, rotate: rand(-180, 180), duration: rand(2, 3.6), delay: rand(0, 1.4), ease: "power1.in", onComplete: () => node.remove() });
    }
  }
};

// Efeitos disparados por palavras-chave nas mensagens novas.
const triggers = [
  { test: /te amo|amo voc[eê]|❤️|❤|😍|🥰|💕|💖|😘/i, run: () => fx.float() },
  { test: /parab[eé]ns|feliz anivers|🎉|🥳|🎂/i, run: () => fx.confetti() },
  { test: /boa noite|🌙|😴/i, run: () => fx.rain(["🌙", "✨", "⭐", "💤"], 26) },
  { test: /k{4,}|(ha){3,}|😂|🤣/i, run: () => fx.rain(["😂", "🤣", "😆"], 22) },
  { test: /🥔|batata/i, run: () => fx.rain(["🥔", "🍟"], 24) }
];

export function effectFor(text) {
  return triggers.find((trigger) => trigger.test.test(text)) || null;
}
