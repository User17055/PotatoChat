// Tocador do bot de música: YouTube (IFrame API) ou Spotify (Embed API), atrás da capa no painel de música.
// Quem decide o que toca e em que segundo é o servidor; o app.js chama open/play/pause/seek para acompanhar.

const apis = {};

function loadApi(name, src, setup) {
  apis[name] ||= new Promise((resolve, reject) => {
    setup(resolve);
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onerror = () => {
      apis[name] = null;
      reject(new Error(`Não deu para carregar o ${name === "youtube" ? "YouTube" : "Spotify"}.`));
    };
    document.head.append(script);
  });
  return apis[name];
}

export const youtubeApi = () => (window.YT?.Player ? Promise.resolve(window.YT) : loadApi("youtube", "https://www.youtube.com/iframe_api", (resolve) => {
  const previous = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => {
    previous?.();
    resolve(window.YT);
  };
}));

const spotifyApi = () => loadApi("spotify", "https://open.spotify.com/embed/iframe-api/v1", (resolve) => {
  window.onSpotifyIframeApiReady = (api) => resolve(api);
});

// events: onReady(), onEnded(uid), onError(uid, message), onUpdate()
// position() e playing() dizem, na hora, onde a música deveria estar (o carregamento demora um pouco).
export function createPlayer(host, events) {
  let kind = null;
  let youtube = null;
  let spotify = null;
  let uid = null;
  let videoId = null;
  let ready = false;
  let load = 0;
  let volume = 80;
  // O Spotify só conta onde está pelo evento playback_update.
  let spot = { position: 0, duration: 0, paused: true, started: false };

  function destroy() {
    load += 1;
    try { youtube?.destroy(); } catch {}
    try { spotify?.destroy(); } catch {}
    youtube = spotify = kind = uid = videoId = null;
    ready = false;
    spot = { position: 0, duration: 0, paused: true, started: false };
    host.replaceChildren();
    host.classList.remove("youtube", "spotify");
  }

  // Outra do YouTube depois de uma do YouTube: troca o vídeo no mesmo player.
  // Com o app em segundo plano, o celular deixa continuar um player que já tocava, mas pode barrar um novo.
  function swapVideo(track, position, playing) {
    load += 1;
    uid = track.uid;
    videoId = track.id;
    const options = { videoId: track.id, startSeconds: Math.floor(position()) };
    if (playing()) youtube.loadVideoById(options);
    else youtube.cueVideoById(options);
    events.onReady?.();
  }

  async function open(track, position, playing) {
    if (kind === "youtube" && track.source === "youtube" && youtube && ready) return swapVideo(track, position, playing);
    destroy();
    const mine = load;
    uid = track.uid;
    videoId = track.id;
    kind = track.source;
    host.classList.add(kind);
    const mount = document.createElement("div");
    host.append(mount);
    try {
      if (kind === "youtube") {
        const YT = await youtubeApi();
        if (mine !== load) return;
        youtube = new YT.Player(mount, {
          videoId: track.id,
          width: "100%",
          height: "100%",
          playerVars: { autoplay: playing() ? 1 : 0, start: Math.floor(position()), controls: 0, disablekb: 1, playsinline: 1, rel: 0, iv_load_policy: 3, fs: 0, cc_load_policy: 0 },
          events: {
            onReady: (event) => {
              if (event.target !== youtube) return;
              ready = true;
              // Sem legenda automática (o YouTube às vezes liga a tradução sozinho).
              try { youtube.unloadModule?.("captions"); } catch {}
              youtube.setVolume(volume);
              youtube.seekTo(position(), true);
              if (playing()) youtube.playVideo();
              else youtube.pauseVideo();
              events.onReady?.();
            },
            onStateChange: (event) => {
              if (event.target !== youtube) return;
              if (event.data === YT.PlayerState.PLAYING) {
                try { youtube.unloadModule?.("captions"); } catch {}
              }
              if (event.data === YT.PlayerState.ENDED) events.onEnded?.(uid);
              events.onUpdate?.();
            },
            // 101 e 150: o dono do vídeo não deixa tocar fora do YouTube.
            onError: (event) => {
              if (event.target !== youtube) return;
              events.onError?.(uid, [101, 150].includes(event.data)
                ? "Esse vídeo não deixa tocar fora do YouTube."
                : "Esse vídeo não está disponível.");
            }
          }
        });
        return;
      }
      const api = await spotifyApi();
      if (mine !== load) return;
      api.createController(mount, { uri: `spotify:${track.type}:${track.id}`, width: "100%", height: "100%" }, (controller) => {
        if (mine !== load) return controller.destroy();
        spotify = controller;
        controller.addListener("ready", () => {
          if (spotify !== controller) return;
          ready = true;
          if (playing()) controller.play();
          events.onReady?.();
        });
        controller.addListener("playback_update", ({ data }) => {
          if (spotify !== controller) return;
          const before = spot;
          spot = { position: data.position / 1000, duration: data.duration / 1000, paused: data.isPaused, started: before.started || !data.isPaused };
          // Música única que chegou ao fim (no Spotify sem login, a prévia de 30 s também conta).
          if (track.type === "track" && !before.paused && data.isPaused && spot.duration && before.position >= spot.duration - 1.5) events.onEnded?.(track.uid);
          events.onUpdate?.();
        });
      });
    } catch (error) {
      if (mine === load) events.onError?.(track.uid, error.message);
    }
  }

  return {
    get uid() { return uid; },
    get kind() { return kind; },
    get ready() { return ready; },
    open,
    destroy,
    time: () => (kind === "youtube" ? youtube?.getCurrentTime?.() || 0 : spot.position),
    duration: () => (kind === "youtube" ? youtube?.getDuration?.() || 0 : spot.duration),
    // Tocando (ou carregando para tocar).
    playing: () => (kind === "youtube" ? [1, 3].includes(youtube?.getPlayerState?.()) : !spot.paused),
    // Estado do YouTube (1 tocando, 2 pausado, 3 carregando…); no Spotify, só tocando ou pausado.
    state: () => (kind === "youtube" ? youtube?.getPlayerState?.() : spot.paused ? 2 : 1),
    // No celular, o YouTube larga a música quando o app sai da tela e fica "carregando" para sempre:
    // carrega o vídeo de novo, no ponto certo. Devolve se precisou.
    revive(seconds) {
      if (kind !== "youtube" || !ready || youtube.getPlayerState?.() === 1) return false;
      youtube.loadVideoById({ videoId, startSeconds: Math.max(0, seconds) });
      return true;
    },
    play() {
      if (!ready) return;
      if (kind === "youtube") youtube.playVideo();
      else if (spot.started) spotify.resume();
      else spotify.play();
    },
    pause() {
      if (!ready) return;
      if (kind === "youtube") youtube.pauseVideo();
      else spotify.pause();
    },
    seek(seconds) {
      if (!ready) return;
      if (kind === "youtube") youtube.seekTo(seconds, true);
      else spotify.seek(seconds);
    },
    // Volume só no YouTube (o Spotify não deixa mudar por fora).
    setVolume(value) {
      volume = value;
      if (ready && kind === "youtube") youtube.setVolume(value);
    }
  };
}
