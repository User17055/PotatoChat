// A ponte do site com o app, com o mesmo nome e formato da do app do Android. Aqui só a Netflix e a HBO Max usam;
// os outros avisos que o site manda por ela (chamada, janelinha) o app ignora.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("PotatoAndroid", { postMessage: (raw) => ipcRenderer.send("potato-site", String(raw)) });
contextBridge.exposeInMainWorld("__potatoNativeStream", true);
