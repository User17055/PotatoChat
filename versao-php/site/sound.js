// Sons sintetizados com Web Audio: nada para baixar, funciona offline.
const STORAGE_KEY = "potato.sound";
let context;
let master;
let enabled = readPreference();
let loop = null;

function readPreference() {
  try { return localStorage.getItem(STORAGE_KEY) !== "off"; } catch { return true; }
}

function audio() {
  if (!context) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0.55;
    master.connect(context.destination);
  }
  if (context.state === "suspended") context.resume().catch(() => {});
  return context;
}

// O navegador só libera áudio depois de uma interação do usuário.
for (const event of ["pointerdown", "keydown", "touchstart"]) {
  window.addEventListener(event, () => audio(), { once: true, passive: true });
}

function tone({ freq = 440, to, type = "sine", start = 0, duration = 0.15, volume = 0.3, attack = 0.008 }) {
  const ctx = audio();
  if (!ctx) return;
  const time = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, time);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, time + duration);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(volume, time + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  osc.connect(gain).connect(master);
  osc.start(time);
  osc.stop(time + duration + 0.05);
}

// Chiado filtrado (palmas, pratos, caixa, estalo do beijo).
function noise({ start = 0, duration = 0.2, volume = 0.3, freq = 1500, type = "bandpass", q = 1 }) {
  const ctx = audio();
  if (!ctx) return;
  const time = ctx.currentTime + start;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  source.connect(filter).connect(gain).connect(master);
  source.start(time);
  source.stop(time + duration + 0.05);
}

// Soundboard: efeitos prontos, feitos aqui mesmo (nada para baixar, sem direitos autorais).
export const EFFECTS = [
  { id: "aplausos", name: "Aplausos" },
  { id: "buzina", name: "Buzina" },
  { id: "tum-dum-tss", name: "Tum dum tss" },
  { id: "tcharam", name: "Tcharam" },
  { id: "triste", name: "Triste" },
  { id: "boing", name: "Boing" },
  { id: "rufar", name: "Rufar" },
  { id: "beijo", name: "Beijo" },
  { id: "plim", name: "Plim" },
  { id: "suspense", name: "Suspense" }
];

const effects = {
  aplausos() {
    for (let i = 0; i < 70; i++) noise({ start: Math.random() * 2.2, duration: 0.04, volume: 0.15 + Math.random() * 0.25, freq: 1100 + Math.random() * 1400, q: 0.8 });
  },
  buzina() {
    [[0, 0.2], [0.27, 0.2], [0.54, 1.1]].forEach(([start, duration]) => {
      [466, 554, 698].forEach((freq) => tone({ freq, start, duration, volume: 0.09, type: "sawtooth", attack: 0.02 }));
    });
  },
  "tum-dum-tss"() {
    tone({ freq: 190, to: 110, duration: 0.18, volume: 0.45 });
    noise({ duration: 0.12, volume: 0.2, freq: 2000 });
    tone({ freq: 150, to: 90, start: 0.2, duration: 0.2, volume: 0.45 });
    noise({ start: 0.44, duration: 0.15, volume: 0.35, freq: 2500 });
    noise({ start: 0.44, duration: 1.1, volume: 0.25, freq: 7000, type: "highpass" });
  },
  tcharam() {
    [523.25, 659.25].forEach((freq, i) => tone({ freq, start: i * 0.11, duration: 0.12, volume: 0.13, type: "sawtooth" }));
    [523.25, 659.25, 783.99, 1046.5].forEach((freq) => tone({ freq, start: 0.24, duration: 0.9, volume: 0.07, type: "sawtooth", attack: 0.02 }));
  },
  triste() {
    [[311, 294, 0], [294, 277, 0.42], [277, 262, 0.84], [262, 233, 1.26]].forEach(([freq, to, start], i) => {
      tone({ freq, to, start, duration: i === 3 ? 1.1 : 0.36, volume: 0.14, type: "sawtooth", attack: 0.03 });
    });
  },
  boing() {
    tone({ freq: 110, to: 620, duration: 0.12, volume: 0.25, type: "triangle" });
    tone({ freq: 620, to: 160, start: 0.11, duration: 0.45, volume: 0.22, type: "triangle" });
  },
  rufar() {
    for (let i = 0; i < 28; i++) noise({ start: i * 0.045, duration: 0.05, volume: 0.08 + i * 0.009, freq: 1800, q: 0.7 });
    noise({ start: 1.28, duration: 1, volume: 0.3, freq: 6500, type: "highpass" });
    tone({ freq: 120, to: 70, start: 1.28, duration: 0.3, volume: 0.4 });
  },
  beijo() {
    [0, 0.32].forEach((start) => {
      noise({ start, duration: 0.05, volume: 0.25, freq: 3500, type: "highpass" });
      tone({ freq: 900, to: 1700, start: start + 0.02, duration: 0.07, volume: 0.18 });
    });
  },
  plim() {
    tone({ freq: 1568, duration: 1.1, volume: 0.18 });
    tone({ freq: 2349, duration: 0.8, volume: 0.08 });
    tone({ freq: 3136, duration: 0.5, volume: 0.04 });
  },
  suspense() {
    tone({ freq: 196, start: 0, duration: 0.3, volume: 0.2, type: "sawtooth" });
    tone({ freq: 185, start: 0.36, duration: 0.3, volume: 0.2, type: "sawtooth" });
    tone({ freq: 147, start: 0.72, duration: 1.4, volume: 0.22, type: "sawtooth", attack: 0.02 });
    tone({ freq: 73.5, start: 0.72, duration: 1.4, volume: 0.2, type: "triangle" });
  }
};

const sounds = {
  send() {
    tone({ freq: 520, to: 980, duration: 0.11, volume: 0.22, type: "triangle" });
    tone({ freq: 1400, duration: 0.05, volume: 0.05, start: 0.06 });
  },
  receive() {
    tone({ freq: 880, duration: 0.22, volume: 0.18 });
    tone({ freq: 1318.5, duration: 0.32, volume: 0.15, start: 0.09 });
  },
  react() {
    tone({ freq: 660, to: 1320, duration: 0.09, volume: 0.16, type: "triangle" });
  },
  tap() {
    tone({ freq: 1200, duration: 0.03, volume: 0.06, type: "square" });
  },
  join() {
    [523.25, 659.25, 783.99].forEach((freq, i) => tone({ freq, duration: 0.25, volume: 0.12, start: i * 0.07 }));
  },
  leave() {
    [659.25, 523.25].forEach((freq, i) => tone({ freq, duration: 0.25, volume: 0.1, start: i * 0.09 }));
  },
  connected() {
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => tone({ freq, duration: 0.3, volume: 0.14, start: i * 0.06, type: "triangle" }));
  },
  hangup() {
    [587.33, 440, 349.23].forEach((freq, i) => tone({ freq, duration: 0.22, volume: 0.14, start: i * 0.1, type: "triangle" }));
  },
  error() {
    tone({ freq: 180, to: 120, duration: 0.25, volume: 0.18, type: "sawtooth" });
  },
  sparkle() {
    [1568, 2093, 2637, 3136].forEach((freq, i) => tone({ freq, duration: 0.18, volume: 0.06, start: i * 0.05 }));
  },
  whoosh() {
    tone({ freq: 300, to: 1800, duration: 0.25, volume: 0.07, type: "sawtooth" });
  }
};

// Toques que se repetem até serem parados (chamada recebida / chamando).
const patterns = {
  ring: { every: 2200, play: () => [784, 988, 1175, 988].forEach((freq, i) => tone({ freq, duration: 0.18, volume: 0.2, start: i * 0.13, type: "triangle" })) },
  ringback: { every: 3000, play: () => { tone({ freq: 425, duration: 0.9, volume: 0.1 }); tone({ freq: 480, duration: 0.9, volume: 0.06 }); } }
};

export const sound = {
  play(name) {
    if (enabled) sounds[name]?.();
  },
  // Efeito do soundboard: toca mesmo com os sons do app desligados (alguém apertou de propósito).
  effect(id) {
    effects[id]?.();
  },
  loop(name) {
    this.stopLoop();
    const pattern = patterns[name];
    if (!pattern) return;
    const run = () => enabled && pattern.play();
    run();
    loop = setInterval(run, pattern.every);
  },
  stopLoop() {
    clearInterval(loop);
    loop = null;
  },
  get enabled() { return enabled; },
  toggle() {
    enabled = !enabled;
    try { localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off"); } catch {}
    if (enabled) sounds.tap();
    else this.stopLoop();
    return enabled;
  },
  // Nível de voz (RMS, 0 a 1) de um stream — usado no anel verde de quem está falando.
  meter(stream) {
    const ctx = audio();
    if (!ctx || !stream?.getAudioTracks().length) return () => 0;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    return () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const value of data) sum += value * value;
      return Math.sqrt(sum / data.length);
    };
  }
};
