// Potato Chat no computador: a janela abre o mesmo site (tudo igual ao navegador). O app acrescenta o que o navegador
// não dá: transmitir a tela com o som do computador sem extensão e a Netflix e a HBO Max dentro dele, seguindo a
// Batata Watch Party como no Rave. A ponte é a mesma do app do Android (StreamOverlay.kt + assets/stream-sync.js).
const { app, BrowserWindow, components, desktopCapturer, ipcMain, session, shell } = require("electron");
const fs = require("fs");
const path = require("path");

const SITE = process.env.POTATO_SITE || "https://potato.andrejrs.com.br/";
const SITE_ORIGIN = new URL(SITE).origin;
const STREAM_HOSTS = ["www.netflix.com", "play.max.com", "play.hbomax.com"];
const SYNC = fs.readFileSync(app.isPackaged ? path.join(process.resourcesPath, "stream-sync.js") : path.join(__dirname, "../android/app/src/main/assets/stream-sync.js"), "utf8");
const ICON = path.join(__dirname, "icon.png");
// Um Chrome comum, como no Android: a Netflix recusa navegador que ela não conhece. O site ainda sabe que é o app.
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome.split(".")[0]}.0.0.0 Safari/537.36`;

let site = null;
let stream = null;
let widevine = null;

const titleId = (url) => (String(url || "").match(/\/watch\/([^?#]+)/) || [])[1] || "";
const streamUrl = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && STREAM_HOSTS.includes(parsed.host);
  } catch {
    return false;
  }
};
const fromSite = (url) => {
  try {
    return new URL(url).origin === SITE_ORIGIN;
  } catch {
    return false;
  }
};
const openOutside = (url) => /^https?:\/\//i.test(url) && shell.openExternal(url);

app.setAppUserModelId("com.potatochat.desktop"); // as notificações do Windows saem com o nome e o ícone do app
app.on("second-instance", () => {
  if (!site) return;
  if (site.isMinimized()) site.restore();
  site.focus();
});
if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(start);

function start() {
  // O Widevine (DRM da Netflix e da HBO Max) é baixado na primeira vez; o resto do app não espera por ele.
  widevine = components.whenReady().catch((error) => console.error("Widevine:", error));
  session.defaultSession.setDisplayMediaRequestHandler(shareScreen);
  site = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 380,
    minHeight: 560,
    icon: ICON,
    title: "Potato Chat",
    backgroundColor: "#111111",
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload-site.js"), autoplayPolicy: "no-user-gesture-required" }
  });
  site.webContents.setUserAgent(`${CHROME_UA} PotatoChatDesktop/${app.getVersion()}`);
  // Arquivos e páginas do próprio site abrem numa janela do app (com a sessão); o resto, no navegador.
  site.webContents.setWindowOpenHandler(({ url }) => {
    if (fromSite(url)) return { action: "allow", overrideBrowserWindowOptions: { icon: ICON, autoHideMenuBar: true } };
    openOutside(url);
    return { action: "deny" };
  });
  site.webContents.on("will-navigate", (event, url) => {
    if (fromSite(url)) return;
    event.preventDefault();
    openOutside(url);
  });
  site.on("closed", () => {
    site = null;
    stream?.close();
  });
  site.loadURL(SITE);
}

// ---------- transmitir a tela ----------
// O Windows não tem um seletor pronto para o Electron: o app mostra o dele (telas e janelas, com miniatura).
async function shareScreen(request, callback) {
  let streams = null; // null = cancelado
  try {
    const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 } });
    const id = await pick(sources);
    const video = sources.find((source) => source.id === id);
    // shortcut: "loopback" leva todo o som do computador, até a voz da outra pessoa na chamada (ela pode ouvir eco);
    // trocar pelo "sem o próprio app" quando o Electron oferecer.
    if (video) streams = request.audioRequested && process.platform === "win32" ? { video, audio: "loopback" } : { video };
  } catch (error) {
    console.error("Transmissão:", error);
  }
  callback(streams);
}

function pick(sources) {
  return new Promise((resolve) => {
    let chosen = "";
    const win = new BrowserWindow({ parent: site, modal: true, width: 820, height: 560, icon: ICON, title: "Transmitir a tela", backgroundColor: "#16161a", autoHideMenuBar: true });
    const list = sources.map((source) => ({ id: source.id, name: source.name, thumb: source.thumbnail.toDataURL(), screen: source.id.startsWith("screen:") }));
    win.webContents.once("did-finish-load", () => win.webContents.executeJavaScript(`show(${JSON.stringify(list)})`).catch(() => {}));
    // A escolha volta pelo # do endereço: a página do seletor não precisa de ponte nenhuma.
    win.webContents.on("did-navigate-in-page", (event, url) => {
      chosen = decodeURIComponent(new URL(url).hash.slice(1));
      win.close();
    });
    win.on("closed", () => resolve(chosen));
    win.loadFile(path.join(__dirname, "picker.html"));
  });
}

// ---------- Netflix e HBO Max (Batata Watch Party) ----------
// Uma janela com a conta de cada um: os cookies ficam neste computador e nenhuma senha passa pelo Potato.
// Um título específico (/watch/…) troca a página; a página inicial não tira a pessoa de onde ela está.
async function openStream(url) {
  if (!streamUrl(url)) return;
  await widevine;
  if (!stream) {
    stream = new BrowserWindow({
      width: 1280,
      height: 760,
      icon: ICON,
      backgroundColor: "#000000",
      autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, "preload-stream.js"), autoplayPolicy: "no-user-gesture-required" }
    });
    stream.webContents.setUserAgent(CHROME_UA);
    // O papel do addDocumentStartJavaScript do Android: o script de sincronia entra em cada página dos serviços.
    stream.webContents.on("dom-ready", () => {
      if (streamUrl(stream.webContents.getURL())) stream.webContents.executeJavaScript(SYNC).catch(() => {});
    });
    stream.on("closed", () => { stream = null; });
  }
  const current = stream.webContents.getURL();
  const wanted = titleId(url);
  if (!current || new URL(current).host !== new URL(url).host || (wanted && wanted !== titleId(current))) stream.loadURL(url);
  if (stream.isMinimized()) stream.restore();
  stream.show();
  stream.focus();
}

// O site manda abrir o serviço e o estado da sala (o mesmo window.PotatoAndroid.postMessage do Android).
ipcMain.on("potato-site", (event, raw) => {
  if (event.sender !== site?.webContents || !fromSite(event.senderFrame?.url)) return;
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  if (message.type === "stream-open") openStream(String(message.url || ""));
  if (message.type === "stream-state" && stream) {
    stream.webContents.executeJavaScript(`window.__potatoRoom && window.__potatoRoom(${JSON.stringify(JSON.stringify(message.room ?? null))})`).catch(() => {});
  }
});

// A página da Netflix ou da HBO Max conta o que a pessoa fez no player. Só ela fala com a sala, como no Android.
ipcMain.on("potato-stream", (event, raw) => {
  if (event.sender !== stream?.webContents || event.senderFrame !== stream.webContents.mainFrame || !streamUrl(event.senderFrame.url)) return;
  if (typeof raw !== "string" || raw.length > 4000) return;
  site?.webContents.executeJavaScript(`window.potatoStream && window.potatoStream(${JSON.stringify(raw)})`).catch(() => {});
});
