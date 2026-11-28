// A página da Netflix ou da HBO Max fala com a sala por aqui (o mesmo window.PotatoStream do app do Android).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("PotatoStream", { postMessage: (raw) => ipcRenderer.send("potato-stream", String(raw)) });
