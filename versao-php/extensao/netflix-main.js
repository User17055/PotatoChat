// Batata Watch Party (Netflix): roda na própria página da Netflix, onde dá para usar o player dela.
// Pular de segundo direto no <video> trava a Netflix; pelo player dela, não. Recebe os comandos de watch-content.js.

window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data?.potato) return;
  try {
    const videoPlayer = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
    const sessions = videoPlayer.getAllPlayerSessionIds();
    const player = videoPlayer.getVideoPlayerBySessionId(sessions.find((id) => id.includes("watch")) || sessions[0]);
    if (event.data.potato === "seek") player.seek(event.data.ms);
    else if (event.data.potato === "play") player.play();
    else if (event.data.potato === "pause") player.pause();
  } catch {}
});
