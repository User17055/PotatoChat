// Conexão "em tempo real" com o servidor PHP. Imita a parte do Socket.IO que o app usa
// (on, emit, timeout().emit, connected, disconnect, io.on), trocando o WebSocket por HTTP:
// as ações vão em lote e em ordem para api.php?action=ops, e as novidades chegam por long polling.

export const apiUrl = (action) => new URL(`api.php?action=${action}`, document.baseURI).href;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function uid() {
  return crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

class Emitter {
  #handlers = new Map();

  on(event, handler) {
    if (!this.#handlers.has(event)) this.#handlers.set(event, []);
    this.#handlers.get(event).push(handler);
    return this;
  }

  off(event, handler) {
    this.#handlers.set(event, (this.#handlers.get(event) || []).filter((item) => item !== handler));
    return this;
  }

  trigger(event, ...args) {
    for (const handler of [...(this.#handlers.get(event) || [])]) {
      try {
        handler(...args);
      } catch (error) {
        console.error(error);
      }
    }
  }
}

class Connection extends Emitter {
  constructor({ auth = {}, reconnectionDelayMax = 5000 } = {}) {
    super();
    this.auth = auth;
    this.delayMax = reconnectionDelayMax;
    this.io = new Emitter(); // socket.io.on("reconnect_attempt", …)
    this.id = uid();
    this.connected = false;
    this.active = true;
    this.gen = 0;
    this.cursor = 0;
    this.wait = 20;
    this.attempt = 0;
    this.queue = [];
    this.sending = false;
    this.presence = "";
    this.onPageHide = () => this.goodbye();
    this.onPageShow = (event) => { if (event.persisted && this.active) this.open(); };
    this.onOnline = () => { if (this.active && !this.connected) this.open(); };
    addEventListener("pagehide", this.onPageHide);
    addEventListener("pageshow", this.onPageShow);
    addEventListener("online", this.onOnline);
    setTimeout(() => this.open());
  }

  async request(action, body = {}, { keepalive = false, timeout = 0 } = {}) {
    const controller = new AbortController();
    const timer = timeout && setTimeout(() => controller.abort(), timeout);
    if (action === "poll") this.abort = controller;
    try {
      const response = await fetch(apiUrl(action), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: this.auth.token, client: this.auth.client || "web", conn: this.id, visible: !document.hidden, ...body }),
        cache: "no-store",
        keepalive,
        signal: controller.signal
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result) {
        const error = new Error(result?.error || `Erro ${response.status} no servidor.`);
        error.status = response.status;
        throw error;
      }
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  async open() {
    const gen = ++this.gen;
    clearTimeout(this.retryTimer);
    this.abort?.abort();
    this.active = true;
    this.connected = false;
    try {
      const data = await this.request("connect", {}, { timeout: 15000 });
      if (gen !== this.gen) return;
      if (data.roomFull) {
        this.active = false;
        this.trigger("room-full");
        return;
      }
      this.attempt = 0;
      this.connected = true;
      this.cursor = data.cursor;
      this.wait = data.wait;
      this.trigger("connect");
      if (data.session) this.trigger("session", data.session);
      this.trigger("history", data.history);
      this.setPresence(data.presence, true);
      this.flush();
      this.poll(gen);
    } catch (error) {
      if (gen === this.gen) this.fail(error);
    }
  }

  async poll(gen) {
    while (gen === this.gen && this.connected) {
      let data;
      try {
        data = await this.request("poll", { cursor: this.cursor }, { timeout: (this.wait + 20) * 1000 });
      } catch (error) {
        // 410: esta aba avisou que ia sair, mas continuou aberta. Segue com o id novo.
        if (gen === this.gen && error.status === 410) continue;
        if (gen === this.gen) this.fail(error);
        return;
      }
      if (gen !== this.gen) return;
      this.cursor = data.cursor;
      this.wait = data.wait;
      if (data.history) this.trigger("history", data.history);
      for (const { type, data: payload } of data.events) {
        if (type === "presence") continue;
        if (payload === null) this.trigger(type);
        else this.trigger(type, payload);
      }
      this.setPresence(data.presence);
      // Long polling: pergunta de novo na hora. Consulta curta: espera um pouco (mais com a aba escondida).
      await sleep(this.wait > 0 ? 100 : document.hidden ? 5000 : 1500);
    }
  }

  fail(error) {
    const wasConnected = this.connected;
    this.connected = false;
    if (error.status === 401) {
      // Sessão inválida: não adianta tentar de novo.
      this.active = false;
      this.trigger("connect_error", new Error(error.message));
      return;
    }
    if (wasConnected) this.trigger("disconnect", "transport close");
    else this.trigger("connect_error", error);
    this.retry();
  }

  retry() {
    if (!this.active) return;
    clearTimeout(this.retryTimer);
    const gen = this.gen;
    this.attempt += 1;
    const delay = Math.min(this.delayMax, 500 * 2 ** this.attempt) * (0.75 + Math.random() / 2);
    this.retryTimer = setTimeout(() => {
      if (gen !== this.gen || !this.active) return;
      this.io.trigger("reconnect_attempt", this.attempt);
      this.open();
    }, delay);
  }

  setPresence(list, force = false) {
    const key = JSON.stringify(list);
    if (!force && key === this.presence) return;
    this.presence = key;
    this.trigger("presence", list);
  }

  emit(event, data, ack) {
    this.send(event, data, ack, 0);
    return this;
  }

  timeout(ms) {
    return { emit: (event, data, ack) => { this.send(event, data, ack, ms); return this; } };
  }

  send(event, data = null, ack = null, timeout = 0) {
    // Fim de chamada sai na hora, sem fila, e chega mesmo se a aba estiver fechando.
    if (event === "call-ended") {
      if (this.active) this.request("ops", { attach: false, ops: [{ event, data }] }, { keepalive: true }).catch(() => {});
      return;
    }
    const op = { event, data: data === undefined ? null : data, ack: typeof ack === "function" ? ack : null, timeout };
    if (!this.connected) {
      if (op.ack && timeout) op.ack(new Error("Sem conexão."));
      return;
    }
    if (op.ack && timeout) op.timer = setTimeout(() => this.settle(op, new Error("Tempo esgotado.")), timeout);
    this.queue.push(op);
    queueMicrotask(() => this.flush());
  }

  settle(op, error, result) {
    clearTimeout(op.timer);
    const ack = op.ack;
    op.ack = null;
    if (!ack) return;
    if (op.timeout) ack(error || null, result);
    else if (!error) ack(result);
  }

  // Envia a fila em lotes, um de cada vez: a ordem das ações é sempre a mesma em que foram feitas.
  async flush() {
    if (this.sending || !this.queue.length || !this.connected) return;
    this.sending = true;
    const batch = this.queue.splice(0, 40);
    try {
      const { results = [] } = await this.request("ops", { ops: batch.map(({ event, data }) => ({ event, data })) }, { timeout: 20000 });
      batch.forEach((op, index) => this.settle(op, null, results[index]));
    } catch (error) {
      batch.forEach((op) => this.settle(op, error));
      if (error.status === 401) this.fail(error);
    } finally {
      this.sending = false;
    }
    if (this.queue.length) this.flush();
  }

  // Avisa o servidor que esta aba saiu (fechar, recarregar ou sair). Se a página voltar, entra com outro id.
  goodbye() {
    const body = JSON.stringify({ token: this.auth.token, conn: this.id });
    this.id = uid();
    try {
      if (navigator.sendBeacon?.(apiUrl("disconnect"), new Blob([body], { type: "text/plain" }))) return;
    } catch {}
    fetch(apiUrl("disconnect"), { method: "POST", body, keepalive: true }).catch(() => {});
  }

  disconnect() {
    if (!this.active && !this.connected) return this;
    const wasConnected = this.connected;
    this.active = false;
    this.connected = false;
    this.gen += 1;
    clearTimeout(this.retryTimer);
    this.abort?.abort();
    this.goodbye();
    removeEventListener("pagehide", this.onPageHide);
    removeEventListener("pageshow", this.onPageShow);
    removeEventListener("online", this.onOnline);
    for (const op of this.queue.splice(0)) this.settle(op, new Error("Desconectado."));
    if (wasConnected) this.trigger("disconnect", "io client disconnect");
    return this;
  }
}

export function io(options) {
  return new Connection(options);
}
