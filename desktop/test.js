// Teste do app (npm test): abre o site de verdade e confere a ponte da Watch Party, o Widevine e a janela da Netflix.
// Não precisa de login: a ponte é testada direto, sem a sala.
const assert = require("assert");
const { app, BrowserWindow, components } = require("electron");
require("./main.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, ms = 45000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await check().catch(() => null);
    if (value) return value;
    await sleep(300);
  }
  throw new Error(`Demorou demais: ${check}`);
}

app.whenReady().then(async () => {
  try {
    const [site] = BrowserWindow.getAllWindows();
    const js = (win, code) => win.webContents.executeJavaScript(code);
    await until(async () => !site.webContents.isLoading());
    assert.match(await js(site, "navigator.userAgent"), /PotatoChatDesktop/);
    assert.equal(await js(site, "typeof window.PotatoAndroid.postMessage + window.__potatoNativeStream"), "functiontrue");

    await components.whenReady();
    const drm = await js(site, `navigator.requestMediaKeySystemAccess("com.widevine.alpha", [{ videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] }]).then(() => true, (error) => error.message)`);
    assert.equal(drm, true, `Widevine: ${drm}`);

    // Transmitir a tela com som: escolhe a primeira tela no seletor do app.
    const share = site.webContents.executeJavaScript(`navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      .then((media) => { const kinds = media.getTracks().map((track) => track.kind).sort().join(","); media.getTracks().forEach((track) => track.stop()); return kinds; }, (error) => error.message)`, true);
    const picker = await until(async () => BrowserWindow.getAllWindows().find((win) => win !== site));
    await until(() => js(picker, `(() => { const first = document.querySelector("#screens button.source"); if (first) setTimeout(() => first.click(), 50); return Boolean(first); })()`));
    assert.equal(await share, "audio,video");
    // Fechar o seletor cancela, sem travar o próximo pedido.
    const cancel = site.webContents.executeJavaScript(`navigator.mediaDevices.getDisplayMedia({ video: true }).then(() => "abriu", () => "cancelado")`, true);
    (await until(async () => BrowserWindow.getAllWindows().find((win) => win !== site))).close();
    assert.equal(await cancel, "cancelado");

    // Site → app: abrir a Netflix. Netflix → site: o "hello" do stream-sync.js chega em window.potatoStream.
    await js(site, `window.__got = []; window.potatoStream = (raw) => window.__got.push(raw);
      window.PotatoAndroid.postMessage(JSON.stringify({ type: "stream-open", service: "netflix", url: "https://www.netflix.com/browse" }))`);
    const stream = await until(async () => BrowserWindow.getAllWindows().find((win) => win !== site));
    await until(() => js(stream, "window.__potatoStreamReady === true"));
    assert.equal(JSON.parse(await until(() => js(site, "window.__got[0]"))).type, "hello");
    assert.doesNotMatch(await js(stream, "navigator.userAgent"), /Electron|Potato/);
    // Uma página fora dos serviços não fala com a sala.
    await js(site, "window.__got = []");
    await stream.webContents.loadURL("https://example.com/");
    await js(stream, `window.PotatoStream.postMessage(JSON.stringify({ type: "action", op: "pause" }))`);
    await sleep(1000);
    assert.equal(await js(site, "window.__got.length"), 0);

    console.log("ok: site, ponte, Widevine e janela da Netflix");
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
