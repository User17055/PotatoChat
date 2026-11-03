// Catálogo local: funciona no WebView e na extensão sem baixar imagens ou consultar serviços.
const CATEGORIES = [
  { id: "faces", label: "Rostos", icon: "😀", groups: [
    ["feliz alegria sorriso sorrindo", "😀 😃 😄 😁 😆 😊 🙂 🙃 😉 😇 🥳 🤩"],
    ["rindo risada gargalhada engraçado", "😅 😂 🤣 😹 😏 🤭 🫢 🤫 🤪 😜 😝 😛"],
    ["amor apaixonado beijo carinho", "🥰 😍 😘 😗 😚 😙 🥹 🥲 😻 😽"],
    ["triste choro chorando saudade", "😢 😭 😞 😔 😟 🙁 ☹️ 🥺 😿 😩 😫"],
    ["raiva bravo irritado", "😤 😠 😡 🤬 😾 👿"],
    ["surpresa assustado medo vergonha", "😮 😯 😲 😳 😱 😨 😰 😥 😓 🫣"],
    ["pensando dúvida curioso neutro", "🤔 🧐 🤨 😐 😑 😶 🫤 🙄 😬 🤐 🫠 🫡"],
    ["sono cansado dormir doente calor frio", "🥱 😴 😪 🤤 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 😵 🤯"],
    ["legal óculos festa divertido", "😎 🤓 🥸 🤠 🤑 😈 👻 💀 ☠️ 🤖 👽 💩 🤡 😺 😸 🙀"],
  ] },
  { id: "hands", label: "Gestos e pessoas", icon: "👋", groups: [
    ["oi olá tchau mão aceno", "👋 🤚 🖐️ ✋ 🖖 🫱 🫲 🫳 🫴"],
    ["sim legal aprovado não positivo negativo joinha", "👍 👎 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙"],
    ["apontar dedo você aqui", "👈 👉 👆 👇 ☝️ 🫵"],
    ["obrigado oração palmas parabéns abraço amizade força", "🙏 👏 🙌 👐 🤲 🤝 💪 👊 ✊ 🤛 🤜 🫶"],
    ["corpo olhos boca ouvido cérebro", "👀 👁️ 👄 🫦 👅 👂 👃 🧠 🦷 🦴 🦵 🦶"],
    ["pessoa homem mulher criança bebê família casal", "👶 🧒 👦 👧 🧑 👨 👩 🧔 👴 👵 🧓 👸 🤴 🧕 👮 🧑‍⚕️ 🧑‍🍳 🧑‍💻 👼 🎅 🦸 🦹"],
    ["casal beijo abraço família dança correr", "💑 💏 👫 👬 👭 🫂 👨‍👩‍👧 👩‍👩‍👦 👨‍👨‍👧 💃 🕺 🏃 🚶 🧘 🤦 🤷 🙋 🙅 🙆"],
  ] },
  { id: "love", label: "Amor e corações", icon: "❤️", groups: [
    ["coração amor carinho", "❤️ 🧡 💛 💚 💙 💜 🤎 🖤 🤍 🩷 🩵 🩶"],
    ["coração paixão apaixonado romance", "💕 💞 💓 💗 💖 💘 💝 💟 ❣️ ❤️‍🔥"],
    ["coração partido triste curar saudade", "💔 ❤️‍🩹"],
    ["beijo abraço carta presente casal aliança flor", "💋 💌 💍 💐 🌹 🥀 🌷 🌸 🎁 🎀 🧸"],
  ] },
  { id: "nature", label: "Animais e natureza", icon: "🐻", groups: [
    ["cachorro cão gato pet animal", "🐶 🐕 🐩 🐺 🐱 🐈 🐈‍⬛ 🐾"],
    ["urso panda coelho raposa leão tigre animal", "🐻 🐼 🐨 🐰 🐇 🦊 🦁 🐯 🐭 🐹 🐮 🐷 🐸 🐵 🙈 🙉 🙊"],
    ["animal cavalo unicórnio girafa elefante", "🐴 🦄 🦓 🦒 🐘 🦏 🦛 🦔 🦥 🦦 🦝 🦇"],
    ["pássaro ave pato galinha pinguim", "🐔 🐣 🐤 🐦 🐧 🦆 🦅 🦉 🦜 🦚 🦩"],
    ["peixe mar tubarão golfinho baleia tartaruga", "🐢 🐍 🦎 🐊 🐙 🦑 🦀 🦞 🐠 🐟 🐬 🐳 🦈 🪼"],
    ["inseto borboleta abelha joaninha", "🦋 🐝 🐞 🐛 🐌 🐜 🕷️ 🦂"],
    ["planta árvore folha flor natureza", "🌵 🎄 🌲 🌳 🌴 🌱 🌿 ☘️ 🍀 🍁 🍂 🍃 🌻 🌼 🌺 🪻 🍄"],
    ["sol lua estrela céu tempo chuva fogo água", "☀️ 🌤️ ⛅ ☁️ 🌧️ ⛈️ 🌈 ❄️ ☃️ 🌬️ 🌪️ 🌊 💧 🔥 🌙 🌚 🌝 🌕 🌑 ⭐ 🌟 ✨ ☄️"],
  ] },
  { id: "food", label: "Comidas e bebidas", icon: "🍔", groups: [
    ["fruta maçã banana morango uva abacaxi", "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝"],
    ["batata vegetal salada milho cenoura", "🥔 🍅 🍆 🥑 🥦 🥬 🥒 🌶️ 🫑 🌽 🥕 🧄 🧅 🥜 🫘"],
    ["comida pão café manhã ovo queijo", "🍞 🥐 🥖 🥨 🥯 🥞 🧇 🧀 🥚 🍳 🥓"],
    ["comida almoço jantar hambúrguer pizza lanche", "🍔 🍟 🍕 🌭 🥪 🌮 🌯 🫔 🥙 🧆 🍖 🍗 🥩 🍝 🍜 🍲 🍛 🍚 🍣 🍤 🥟 🥗"],
    ["doce bolo chocolate sorvete sobremesa festa", "🍦 🍧 🍨 🍩 🍪 🎂 🍰 🧁 🥧 🍫 🍬 🍭 🍮 🍯"],
    ["bebida café chá água leite suco cerveja vinho brinde", "☕ 🍵 🧉 🥛 🍼 🧃 🥤 🧋 🍺 🍻 🥂 🍷 🍸 🍹 🍾 🧊"],
    ["comida talher prato cozinhar", "🍽️ 🍴 🥄 🔪 🥣 🥡 🥢"],
  ] },
  { id: "activities", label: "Atividades e lugares", icon: "⚽", groups: [
    ["esporte futebol bola basquete tênis vôlei", "⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🎱 🏓 🏸 🏒 🏏 ⛳"],
    ["esporte academia treino bicicleta natação", "🥊 🥋 🎯 🛹 🛼 🛷 ⛸️ 🎣 🤿 🏋️ 🚴 🏊 🏄 🧗 🤸"],
    ["vitória prêmio medalha troféu campeão", "🏆 🥇 🥈 🥉 🏅 🎖️"],
    ["festa aniversário carnaval comemorar", "🎉 🎊 🎈 🎆 🎇 🧨 🎃 🎭 🎪"],
    ["jogo videogame diversão cinema arte música", "🎮 🕹️ 🎲 🧩 ♟️ 🎰 🎬 🎨 🎸 🎹 🎻 🥁 🎺 🎤 🎧 🎵 🎶"],
    ["viagem carro ônibus moto avião trem barco foguete", "🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚚 🚲 🛵 🏍️ 🚆 🚇 ✈️ 🚁 🚀 🛸 ⛵ 🚤 🚢"],
    ["lugar casa cidade trabalho escola praia viagem", "🏠 🏡 🏢 🏥 🏦 🏨 🏫 🏰 ⛪ 🕌 🗽 🗼 🗺️ 🏖️ 🏝️ 🏕️ ⛰️ 🌋 🌅 🌇 🌃 🌉"],
  ] },
  { id: "objects", label: "Objetos", icon: "💡", groups: [
    ["celular telefone computador tecnologia câmera vídeo", "📱 📲 ☎️ 💻 🖥️ ⌨️ 🖱️ 🖨️ 📷 📸 📹 🎥 📺 📻"],
    ["luz ideia energia bateria ferramenta", "💡 🔦 🕯️ 🔌 🔋 🪫 🔧 🔨 ⚙️ 🧰 🪛"],
    ["livro estudar escola escrever trabalho", "📖 📚 📓 📝 ✏️ 🖊️ 🖌️ 📒 📅 📆 📌 📎 📁 💼"],
    ["dinheiro pagar compra cartão presente", "💰 💸 💵 💶 💳 🪙 🛒 🛍️ 💎 ⚖️"],
    ["casa cama banho limpeza chave segurança", "🛏️ 🛋️ 🚿 🛁 🚪 🪞 🪑 🧹 🧽 🧼 🧴 🧺 🧻 🔑 🔒 🔓"],
    ["saúde remédio hospital vacina curativo", "💊 💉 🩹 🩺 🩻 🩼"],
    ["roupa sapato acessório óculos coroa", "👕 👚 👖 👗 👙 🧥 🧦 👟 👠 🥾 🧢 🎩 👑 👓 🕶️ 🎒 👛 👜"],
    ["hora relógio tempo sino aviso", "⌚ ⏰ ⏳ ⌛ 🔔 📣 📢 💬 💭"],
  ] },
  { id: "symbols", label: "Símbolos e bandeiras", icon: "✨", groups: [
    ["ok certo confirmado sim sucesso", "✅ ☑️ ✔️ 💯 🆗 🆒 🆕 🆓 🆘"],
    ["não errado proibido atenção aviso pergunta", "❌ ❎ 🚫 ⛔ ⚠️ ❗ ❕ ❓ ❔ ‼️ ⁉️"],
    ["brilho estrela explosão gota zzz dormir paz", "💥 💫 💦 💨 💤 🕊️ ☮️ ♻️ ⚜️ 🔱"],
    ["seta direção próximo voltar música", "⬆️ ⬇️ ⬅️ ➡️ ↗️ ↘️ ↙️ ↖️ 🔄 🔙 🔜 🔝 ▶️ ⏸️ ⏭️ ⏮️ 🔀 🔁"],
    ["cor círculo quadrado colorido", "🔴 🟠 🟡 🟢 🔵 🟣 🟤 ⚫ ⚪ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 ⬛ ⬜"],
    ["bandeira brasil portugal país mundo", "🇧🇷 🇵🇹 🇦🇷 🇺🇾 🇨🇱 🇨🇴 🇲🇽 🇺🇸 🇨🇦 🇫🇷 🇮🇹 🇪🇸 🇩🇪 🇬🇧 🇯🇵 🇰🇷 🇨🇳 🇦🇺 🏳️‍🌈 🏳️‍⚧️ 🏁 🚩"],
  ] },
];
const normalize = (text) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const entries = [...new Map(CATEGORIES.flatMap((category) => category.groups.flatMap(([words, emojis]) =>
  emojis.split(" ").map((emoji) => [emoji, { emoji, category: category.id, search: normalize(`${category.label} ${words}`) }])
))).values()];
const known = new Set(entries.map(({ emoji }) => emoji));
const RECENT_KEY = "potato.recentEmojis";

export function createEmojiPicker({ button, input, beforeOpen = () => {}, onLimit = () => {} }) {
  const form = button.closest("form");
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const readRecent = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(RECENT_KEY));
      return Array.isArray(saved) ? [...new Set(saved.filter((emoji) => known.has(emoji)))].slice(0, 32) : [];
    } catch { return []; }
  };
  let recent = readRecent();
  let category = recent.length ? "recent" : "faces";
  let selection = { start: input.selectionStart, end: input.selectionEnd };
  const panel = element("div", "emoji-panel");
  panel.id = "emoji-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Escolher emojis");
  const head = element("div", "emoji-head");
  const closeButton = element("button", "emoji-close", "×");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Fechar emojis");
  head.append(element("strong", "", "Emojis"), closeButton);
  const search = element("input", "emoji-search");
  search.type = "search";
  search.placeholder = "Buscar emoji";
  search.setAttribute("aria-label", "Buscar emoji");
  search.autocomplete = "off";
  search.maxLength = 60;
  const tabs = element("div", "emoji-categories");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Categorias de emojis");
  for (const item of [{ id: "recent", label: "Recentes", icon: "🕒" }, ...CATEGORIES]) {
    const tab = element("button", "emoji-category", item.icon);
    tab.type = "button";
    tab.dataset.category = item.id;
    tab.title = item.label;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-label", item.label);
    tab.setAttribute("aria-controls", "emoji-results");
    tabs.append(tab);
  }
  const results = element("div", "emoji-results");
  results.id = "emoji-results";
  const heading = element("p", "emoji-heading");
  heading.setAttribute("aria-live", "polite");
  const grid = element("div", "emoji-grid");
  const note = element("p", "emoji-empty");
  results.append(heading, grid, note);
  panel.append(head, search, tabs, results);
  form.append(panel);

  const rememberSelection = () => { selection = { start: input.selectionStart, end: input.selectionEnd }; };
  ["select", "keyup", "input", "click"].forEach((event) => input.addEventListener(event, rememberSelection));

  function render() {
    const query = normalize(search.value);
    const words = query.split(/\s+/).filter(Boolean);
    const shown = query ? entries.filter((item) => item.emoji.includes(search.value.trim()) || words.every((word) => item.search.includes(word)))
      : category === "recent" ? recent.map((emoji) => ({ emoji })) : entries.filter((item) => item.category === category);
    heading.textContent = query ? `Resultados · ${shown.length}` : category === "recent" ? "Usados recentemente" : CATEGORIES.find((item) => item.id === category).label;
    tabs.querySelectorAll("button").forEach((tab) => {
      tab.setAttribute("aria-selected", String(!query && tab.dataset.category === category));
      tab.tabIndex = tab.dataset.category === category ? 0 : -1;
    });
    const fragment = document.createDocumentFragment();
    for (const { emoji } of shown) {
      const choice = element("button", "emoji-choice", emoji);
      choice.type = "button";
      choice.dataset.emoji = emoji;
      choice.setAttribute("aria-label", `Inserir ${emoji}`);
      fragment.append(choice);
    }
    grid.replaceChildren(fragment);
    note.hidden = shown.length > 0;
    note.textContent = query ? "Nenhum emoji encontrado. Tente outro termo." : "Seus emojis recentes aparecem aqui.";
    results.scrollTop = 0;
  }

  function fit() {
    if (panel.hidden) return;
    const top = window.visualViewport?.offsetTop || 0;
    panel.style.maxHeight = `${Math.max(100, Math.min(420, form.getBoundingClientRect().top - top - 12))}px`;
  }
  function close(restoreFocus = false) {
    if (panel.hidden) return;
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", escape, true);
    if (restoreFocus) button.focus({ preventScroll: true });
  }
  function open() {
    beforeOpen();
    rememberSelection();
    recent = readRecent();
    search.value = "";
    if (category === "recent" && !recent.length) category = "faces";
    if (matchMedia("(pointer: coarse)").matches) input.blur();
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    render();
    fit();
    document.addEventListener("keydown", escape, true);
    if (matchMedia("(pointer: fine)").matches) search.focus({ preventScroll: true });
  }
  function escape(event) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    close(true);
  }
  button.addEventListener("click", () => panel.hidden ? open() : close());
  closeButton.addEventListener("click", () => close(true));
  search.addEventListener("input", render);
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") event.preventDefault();
    if (event.key === "ArrowDown") { event.preventDefault(); grid.querySelector("button")?.focus(); }
  });
  tabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-category]");
    if (!tab) return;
    category = tab.dataset.category;
    search.value = "";
    render();
  });
  tabs.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...tabs.querySelectorAll("button")];
    const index = buttons.indexOf(event.target);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].click();
    buttons[next].focus();
  });
  // Mantém a busca e o teclado estáveis ao escolher vários emojis seguidos.
  grid.addEventListener("mousedown", (event) => event.preventDefault());
  grid.addEventListener("click", (event) => {
    const emoji = event.target.closest(".emoji-choice")?.dataset.emoji;
    if (!emoji) return;
    const start = Math.min(selection.start, input.value.length);
    const end = Math.min(selection.end, input.value.length);
    if (input.maxLength >= 0 && input.value.length - (end - start) + emoji.length > input.maxLength) return onLimit();
    input.setRangeText(emoji, start, end, "end");
    rememberSelection();
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: emoji }));
    recent = [emoji, ...recent.filter((item) => item !== emoji)].slice(0, 32);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch {}
  });
  grid.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const buttons = [...grid.querySelectorAll("button")];
    const index = buttons.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    const columns = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key] || 0;
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + step));
    buttons[next].focus();
  });
  document.addEventListener("pointerdown", (event) => { if (!panel.contains(event.target) && !button.contains(event.target)) close(); });
  document.addEventListener("focusin", (event) => { if (!panel.contains(event.target) && event.target !== button) close(); });
  form.addEventListener("submit", () => close());
  window.addEventListener("resize", fit);
  window.visualViewport?.addEventListener("resize", fit);
  return { close };
}
