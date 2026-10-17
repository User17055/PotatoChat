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
          .fromTo(".composer", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ...clear }, "-=0.45")
          .fromTo(".tabbar", { y: 70 }, { y: 0, duration: 0.6, ...clear }, "-=0.5");
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

  show(element, from = { y: 12 }) {
    element.classList.remove("hidden");
    if (motion()) gsap.fromTo(element, { opacity: 0, ...from }, { opacity: 1, x: 0, y: 0, scale: 1, duration: 0.35, ease: "power3.out" });
  },

  // Troca de aba: a tela nova desliza do lado de onde veio; no perfil, os blocos entram um a um.
  view(element, direction = 1) {
    if (!motion()) return;
    gsap.fromTo(element, { opacity: 0, x: 28 * direction }, { opacity: 1, x: 0, duration: 0.4, ease: "power3.out", clearProps: "transform,opacity" });
    const items = element.querySelectorAll(".profile-hero > *, .profile-stats > div, .profile-card");
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

  // Watch Party: as cortinas de cinema fecham, o logo acende no facho do projetor, o site vira sala de cinema por
  // trás delas (swap) e elas abrem revelando a sala. Saindo, as cortinas só fecham e abrem, rapidinho.
  cinema(entering, swap) {
    cinemaTimeline?.progress(1);
    if (!motion()) return swap();
    const overlay = document.createElement("div");
    overlay.className = "wp-intro";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = '<i class="wp-curtain left"></i><i class="wp-curtain right"></i><i class="wp-beam"></i><div class="wp-logo"><svg class="icon"><use href="#i-tv"></use></svg><span>Watch Party</span></div>';
    for (let i = 0; i < 18; i++) {
      const spark = document.createElement("i");
      spark.className = "wp-spark";
      spark.style.left = `${rand(15, 85)}%`;
      spark.style.top = `${rand(35, 75)}%`;
      overlay.append(spark);
    }
    document.body.append(overlay);
    const [left, right] = overlay.querySelectorAll(".wp-curtain");
    const beam = overlay.querySelector(".wp-beam");
    const logo = overlay.querySelector(".wp-logo");
    const sparks = overlay.querySelectorAll(".wp-spark");
    const close = entering ? 0.55 : 0.32;
    const open = entering ? 1.55 : 0.42;
    const timeline = cinemaTimeline = gsap.timeline({
      onComplete: () => {
        overlay.remove();
        if (cinemaTimeline === timeline) cinemaTimeline = null;
      }
    });
    timeline
      .fromTo(left, { xPercent: -100 }, { xPercent: 0, duration: close, ease: "power3.inOut" }, 0)
      .fromTo(right, { xPercent: 100 }, { xPercent: 0, duration: close, ease: "power3.inOut" }, 0);
    if (entering) {
      timeline
        .fromTo(beam, { opacity: 0, scaleY: 0.4 }, { opacity: 1, scaleY: 1, duration: 0.5, ease: "power2.out" }, 0.4)
        .fromTo(logo, { opacity: 0, scale: 0.6, filter: "blur(10px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.55, ease: "back.out(1.7)" }, 0.45)
        .fromTo(sparks, { opacity: 0, y: 20, scale: 0 }, { opacity: 1, y: () => rand(-90, -40), scale: 1, duration: 0.9, stagger: 0.03, ease: "power2.out" }, 0.5)
        .add(swap, 0.7)
        .to(sparks, { opacity: 0, duration: 0.4 }, 1.2)
        .to(logo, { opacity: 0, scale: 1.25, filter: "blur(6px)", duration: 0.35, ease: "power2.in" }, 1.3)
        .to(beam, { opacity: 0, duration: 0.35 }, 1.3);
    } else {
      timeline.add(swap, close + 0.02);
    }
    timeline
      .to(left, { xPercent: -100, duration: entering ? 0.7 : 0.38, ease: "power3.inOut" }, open)
      .to(right, { xPercent: 100, duration: entering ? 0.7 : 0.38, ease: "power3.inOut" }, open);
    // A sala aparece: o vídeo cresce e a conversa desliza para o lugar.
    if (entering) {
      timeline.add(() => {
        gsap.from(".watching .watch-panel", { scale: 0.92, opacity: 0, duration: 0.75, ease: "power3.out", clearProps: "transform,opacity" });
        gsap.from(".watching .messages-wrap, .watching .composer", { x: 50, opacity: 0, duration: 0.6, stagger: 0.08, ease: "power3.out", clearProps: "transform,opacity" });
      }, open + 0.1);
    }
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
