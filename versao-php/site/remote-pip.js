// Superfície exclusiva do PiP: nunca contém controles do site nem a própria transmissão.
let video;
export function updateRemotePip(track) {
  if (!video) {
    const surface = document.createElement("div");
    surface.id = "remote-pip";
    surface.setAttribute("aria-hidden", "true");
    video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true; // O som continua pelos elementos originais, uma só vez.
    surface.append(video);
    document.body.append(surface);
    const shape = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      window.PotatoAndroid?.postMessage(JSON.stringify({ type: "pip-shape", width: video.videoWidth, height: video.videoHeight }));
    };
    video.addEventListener("resize", shape);
    video.addEventListener("loadedmetadata", shape);
  }
  if (video.dataset.track === (track?.id || "")) return;
  video.dataset.track = track?.id || "";
  video.srcObject = track ? new MediaStream([track]) : null;
  if (track) video.play().catch(() => {});
}
