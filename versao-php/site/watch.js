// Assistir junto: o player grande, em cima da conversa. YouTube (IFrame API), Twitch (vídeo gravado ou canal ao vivo,
// Embed API) ou um vídeo do aparelho (<video>: o arquivo de quem escolheu, ou a transmissão dele, que chega por WebRTC).
// Quem decide o que passa e em que segundo é o servidor; o app.js chama open/play/pause/seek para acompanhar.
import { youtubeApi } from "./music.js";

let twitchLoading = null;
const twitchApi = () => (window.Twitch?.Player ? Promise.resolve(window.Twitch) : (twitchLoading ||= new Promise((resolve, reject) => {
  const script = document.createElement("script");
  script.src = "https://player.twitch.tv/js/embed/v1.js";
  script.async = true;
  script.onload = () => resolve(window.Twitch);
  script.onerror = () => {
    twitchLoading = null;
    reject(new Error("Não deu para carregar a Twitch."));
  };
  document.head.append(script);
})));

// events: onReady(), onUpdate(), onEnded(uid), onError(uid, message)
export function createWatchPlayer(host, events) {
  let item = null;
  let ready = false;
  let load = 0;
  let youtube = null;
  let twitch = null;
  let video = null;
  let objectUrl = "";
  let stream = null;

  function destroy() {
    load += 1;
    if (item) events.onClose?.(item.uid);
    try { youtube?.destroy(); } catch {}
    try { twitch?.pause(); } catch {}
    if (video) video.pause();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    youtube = twitch = video = item = stream = null;
    objectUrl = "";
    ready = false;
    host.replaceChildren();
  }

  // feed = a transmissão de quem tem o arquivo (MediaStream): quem manda no segundo é quem transmite.
  async function open(next, position, playing, file, feed = null) {
    destroy();
    const mine = load;
    item = next;
    const mount = document.createElement("div");
    mount.id = `watch-mount-${mine}`;
    host.append(mount);
    try {
      if (item.source === "youtube") {
        const YT = await youtubeApi();
        if (mine !== load) return;
        youtube = new YT.Player(mount, {
          videoId: item.id,
          width: "100%",
          height: "100%",
          playerVars: { autoplay: playing() ? 1 : 0, start: Math.floor(position()), controls: 0, disablekb: 1, playsinline: 1, rel: 0, iv_load_policy: 3, fs: 0, cc_load_policy: 0 },
          events: {
            onReady: (event) => {
              if (event.target !== youtube) return;
              ready = true;
              youtube.seekTo(position(), true);
              if (playing()) youtube.playVideo();
              events.onReady?.();
            },
            onStateChange: (event) => {
              if (event.target !== youtube) return;
              if (event.data === YT.PlayerState.ENDED) events.onEnded?.(item.uid);
              events.onUpdate?.();
            },
            onError: (event) => {
              if (event.target === youtube) events.onError?.(item.uid, [101, 150].includes(event.data) ? "Esse vídeo não deixa passar fora do YouTube." : "Esse vídeo não está disponível.");
            }
          }
        });
      } else if (item.source === "twitch") {
        const Twitch = await twitchApi();
        if (mine !== load) return;
        const where = item.kind === "channel" ? { channel: item.id } : { video: `v${item.id}` };
        const player = twitch = new Twitch.Player(mount.id, { width: "100%", height: "100%", parent: [location.hostname], autoplay: playing(), muted: false, ...where });
        player.addEventListener(Twitch.Player.READY, () => {
          if (twitch !== player) return;
          ready = true;
          if (item.kind !== "channel") player.seek(position());
          if (playing()) player.play();
          else player.pause();
          events.onReady?.();
        });
        for (const name of [Twitch.Player.PLAY, Twitch.Player.PAUSE, Twitch.Player.PLAYING]) player.addEventListener(name, () => twitch === player && events.onUpdate?.());
        player.addEventListener(Twitch.Player.ENDED, () => twitch === player && events.onEnded?.(item.uid));
      } else if (feed) {
        const element = video = document.createElement("video");
        stream = element.srcObject = feed;
        element.playsInline = true;
        mount.replaceWith(element);
        for (const name of ["play", "pause", "playing", "waiting"]) element.addEventListener(name, () => video === element && events.onUpdate?.());
        ready = true;
        if (playing()) element.play().catch(() => {});
        events.onReady?.();
      } else {
        objectUrl = URL.createObjectURL(file);
        const element = video = document.createElement("video");
        element.src = objectUrl;
        element.playsInline = true;
        element.preload = "auto";
        mount.replaceWith(element);
        element.addEventListener("loadedmetadata", () => {
          if (video !== element) return;
          ready = true;
          element.currentTime = Math.min(position(), element.duration || position());
          if (playing()) element.play().catch(() => {});
          events.onReady?.();
        }, { once: true });
        for (const name of ["play", "pause", "playing", "waiting"]) element.addEventListener(name, () => video === element && events.onUpdate?.());
        element.addEventListener("ended", () => video === element && events.onEnded?.(item.uid));
        element.addEventListener("error", () => video === element && events.onError?.(item.uid, "Esse vídeo não abre neste aparelho."));
      }
    } catch (error) {
      if (mine === load) events.onError?.(item.uid, error.message);
    }
  }

  return {
    get uid() { return item?.uid || null; },
    get ready() { return ready; },
    // Canal ao vivo da Twitch e a transmissão do vídeo do aparelho: não dá para escolher o segundo, só tocar e pausar.
    get live() { return Boolean(stream) || (item?.source === "twitch" && item.kind === "channel"); },
    get stream() { return stream; },
    open,
    destroy,
    // O vídeo do aparelho virando transmissão (Chrome, Edge, Android; o Safari não sabe).
    capture() {
      return video && !stream && video.captureStream ? video.captureStream() : null;
    },
    time() {
      if (youtube) return youtube.getCurrentTime?.() || 0;
      if (twitch) return twitch.getCurrentTime?.() || 0;
      return video?.currentTime || 0;
    },
    duration() {
      if (youtube) return youtube.getDuration?.() || 0;
      if (twitch) return twitch.getDuration?.() || 0;
      // A transmissão não tem fim (Infinity): vale a duração que veio do servidor.
      return Number.isFinite(video?.duration) ? video.duration : 0;
    },
    playing() {
      if (youtube) return [1, 3].includes(youtube.getPlayerState?.());
      if (twitch) return twitch.isPaused?.() === false;
      return Boolean(video && !video.paused && !video.ended);
    },
    play() {
      if (!ready) return;
      if (youtube) youtube.playVideo();
      else if (twitch) twitch.play();
      else video?.play().catch(() => {});
    },
    pause() {
      if (!ready) return;
      if (youtube) youtube.pauseVideo();
      else if (twitch) twitch.pause();
      else video?.pause();
    },
    seek(seconds) {
      if (!ready) return;
      if (youtube) youtube.seekTo(seconds, true);
      else if (twitch) twitch.seek(seconds);
      else if (video) video.currentTime = seconds;
    }
  };
}
