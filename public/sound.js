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
