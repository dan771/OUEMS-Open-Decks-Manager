export class LiveConnection {
  constructor({ csrf, onChange, onPresence, onStatus, onReady, onExpired }) {
    Object.assign(this, {
      csrf,
      onChange,
      onPresence,
      onStatus,
      onReady,
      onExpired,
    });
    this.boardId = "";
    this.editing = null;
    this.attempt = 0;
    this.stopped = false;
    this.connect();
  }
  connect() {
    if (this.stopped) return;
    this.onStatus(navigator.onLine ? "connecting" : "offline");
    try {
      this.socket = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/live`,
        ["ouems-live", `csrf.${this.csrf}`],
      );
    } catch {
      this.reconnect();
      return;
    }
    const socket = this.socket;
    const active = () => !this.stopped && this.socket === socket;
    this.connectionTimeout = setTimeout(() => {
      if (active() && socket.readyState !== WebSocket.OPEN) socket.close();
    }, 15_000);
    socket.onopen = () => {
      if (!active()) return;
      clearTimeout(this.connectionTimeout);
      this.attempt = 0;
      this.received = Date.now();
      this.onStatus("live");
      this.sendPresence();
      this.heartbeat = setInterval(() => {
        if (!active()) return;
        if (Date.now() - this.received > 65_000) socket.close();
        else this.sendPresence();
      }, 25_000);
      this.onReady();
    };
    socket.onmessage = (event) => {
      if (!active()) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!message || typeof message !== "object") return;
      this.received = Date.now();
      if (message.type === "hello") this.connectionId = message.connectionId;
      if (message.type === "change" && Number.isInteger(message.version))
        this.onChange(message.version);
      if (message.type === "presence" && Array.isArray(message.peers))
        this.onPresence(message.peers);
    };
    socket.onclose = (event) => {
      if (!active()) return;
      clearTimeout(this.connectionTimeout);
      clearInterval(this.heartbeat);
      this.onPresence([]);
      if (event.code === 4001) {
        this.stop();
        this.onExpired();
        return;
      }
      this.reconnect();
    };
    socket.onerror = () => {
      if (active()) socket.close();
    };
  }
  reconnect() {
    if (this.stopped) return;
    this.onStatus(navigator.onLine ? "reconnecting" : "offline");
    clearTimeout(this.retry);
    clearTimeout(this.connectionTimeout);
    this.retry = setTimeout(
      () => this.connect(),
      Math.min(30_000, 1000 * 2 ** Math.min(this.attempt++, 5)) +
        Math.random() * 500,
    );
  }
  presence(boardId, editing = null) {
    this.boardId = boardId || "";
    this.editing = editing;
    this.sendPresence();
  }
  sendPresence() {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(
        JSON.stringify({
          type: "presence",
          boardId: this.boardId,
          editing: document.hidden ? null : this.editing,
        }),
      );
  }
  stop() {
    this.stopped = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.retry);
    clearTimeout(this.connectionTimeout);
    this.socket?.close();
  }
}
