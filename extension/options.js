const form = document.querySelector("#form");
const input = document.querySelector("#site-url");
const notify = document.querySelector("#notify");
const status = document.querySelector("#status");

chrome.storage.sync.get({ siteUrl: "http://localhost:3000", notify: true }, (values) => {
  input.value = values.siteUrl;
  notify.checked = values.notify;
});

function say(text, ok = true) {
  status.textContent = text;
  status.classList.toggle("bad", !ok);
}

function readOrigin() {
  const url = new URL(input.value);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("Use https:// (ou http://localhost para testes).");
  return url.origin;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const siteUrl = readOrigin();
    chrome.storage.sync.set({ siteUrl, notify: notify.checked }, () => say("Configurações salvas."));
  } catch (error) {
    say(error.message, false);
  }
});

notify.addEventListener("change", () => chrome.storage.sync.set({ notify: notify.checked }));

document.querySelector("#test").addEventListener("click", async () => {
  say("Testando…");
  try {
    const response = await fetch(`${readOrigin()}/api/health`);
    const result = await response.json();
    if (!result.ok) throw new Error();
    say(`Servidor online · ${result.people} pessoa(s) conectada(s).`);
  } catch (error) {
    say(error.message?.startsWith("Use") ? error.message : "Não foi possível falar com o servidor.", false);
  }
});

document.querySelector("#disconnect").addEventListener("click", async () => {
  await chrome.storage.local.remove("session");
  await chrome.storage.session.remove("outbox");
  say("Sessão da extensão encerrada.");
});

chrome.commands.getAll((commands) => {
  const toggle = commands.find((command) => command.name === "toggle-chat");
  const key = document.querySelector("#shortcut-key");
  key.textContent = toggle?.shortcut || "nenhum — clique em Mudar atalho";
  key.classList.toggle("bad", !toggle?.shortcut);
});
document.querySelector("#change-shortcut").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));
