const form = document.querySelector("#form");
const input = document.querySelector("#site-url");
const notify = document.querySelector("#notify");
const status = document.querySelector("#status");

chrome.storage.sync.get({ siteUrl: "http://localhost:8000", notify: true }, (values) => {
  input.value = values.siteUrl;
  notify.checked = values.notify;
});

function say(text, ok = true) {
  status.textContent = text;
  status.classList.toggle("bad", !ok);
}

// Endereço do site sem barra no fim. Mantém a pasta, caso o chat não esteja na raiz do domínio.
function readSiteUrl() {
  const url = new URL(input.value.trim());
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("Use https:// (ou http://localhost para testes).");
  return url.origin + url.pathname.replace(/\/index\.php$/i, "").replace(/\/+$/, "");
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const siteUrl = readSiteUrl();
    chrome.storage.sync.set({ siteUrl, notify: notify.checked }, () => say("Configurações salvas."));
  } catch (error) {
    say(error.message, false);
  }
});

notify.addEventListener("change", () => chrome.storage.sync.set({ notify: notify.checked }));

document.querySelector("#test").addEventListener("click", async () => {
  say("Testando…");
  try {
    const response = await fetch(`${readSiteUrl()}/api.php?action=health`, { cache: "no-store" });
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
