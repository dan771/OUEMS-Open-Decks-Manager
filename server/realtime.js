import { authenticate, loadSecurity, fail, secureTransport } from "./auth.js";

export async function authorizeLive(request, env) {
  secureTransport(request, env);
  const origin = new URL(request.url).origin;
  if (request.headers.get("Origin") !== origin)
    throw fail("Only connections from this app are accepted.", 403);
  const user = await authenticate(request, env);
  const protocols = (request.headers.get("Sec-WebSocket-Protocol") || "")
    .split(",")
    .map((p) => p.trim());
  if (
    !protocols.includes("ouems-live") ||
    !protocols.includes(`csrf.${user.csrf}`)
  )
    throw fail("Refresh before reconnecting to the board.", 403);
  return {
    id: crypto.randomUUID(),
    userId: user.id,
    name: user.name || user.username,
    role: user.role,
    sessionHash: user.sessionHash,
    expires: user.sessionExpires,
    boardId: "",
    editing: null,
    seen: 0,
    checked: Date.now(),
  };
}

// Notifications never contain workspace content. Reads still pass through the
// authenticated, role-filtered API. A broken live channel cannot undo a save.
export async function publish(env, message) {
  try {
    if (env.LIVE) await env.LIVE.publish(message);
    else if (env.COLLABORATION)
      await env.COLLABORATION.get(
        env.COLLABORATION.idFromName("workspace"),
      ).fetch("https://collaboration.internal/publish", {
        method: "POST",
        body: JSON.stringify(message),
      });
  } catch {
    console.warn(
      "Live notification unavailable; clients will reconcile through the state API.",
    );
  }
}

export class CollaborationHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.lastPresence = new Map();
  }
  sockets() {
    return this.ctx.getWebSockets().filter((socket) => socket.readyState === 1);
  }
  send(socket, value) {
    try {
      socket.send(typeof value === "string" ? value : JSON.stringify(value));
    } catch {
      socket.close(1011, "Reconnect to the board");
    }
  }
  attach(socket, info) {
    socket.serializeAttachment(info);
    this.send(socket, { type: "hello", connectionId: info.id });
    this.presence();
  }
  async fetch(request) {
    if (
      new URL(request.url).pathname === "/publish" &&
      request.method === "POST"
    ) {
      this.publish(await request.json());
      return new Response(null, { status: 204 });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response("WebSocket required", { status: 426 });
    const info = JSON.parse(request.headers.get("X-Live-Identity"));
    if (
      this.sockets().length >= 1000 ||
      this.sockets().filter(
        (s) => s.deserializeAttachment().userId === info.userId,
      ).length >= 20
    )
      return new Response("Too many board connections", { status: 429 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    this.attach(server, info);
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": "ouems-live" },
    });
  }
  publish(message) {
    if (message.type === "revoke") {
      for (const socket of this.sockets()) {
        const info = socket.deserializeAttachment();
        if (
          (message.userId && info.userId === message.userId) ||
          (message.sessionHash && info.sessionHash === message.sessionHash)
        )
          socket.close(4001, "Sign in again");
      }
      this.presence();
    } else if (message.type === "change" && Number.isInteger(message.version)) {
      for (const socket of this.sockets()) this.send(socket, message);
    }
  }
  presence() {
    const now = Date.now();
    const boards = new Map();
    for (const socket of this.sockets()) {
      const info = socket.deserializeAttachment();
      if (info.expires <= now) {
        socket.close(4001, "Session expired");
        continue;
      }
      if (now - info.seen < 65_000) {
        if (!boards.has(info.boardId)) boards.set(info.boardId, []);
        boards.get(info.boardId).push({ socket, info });
      }
    }
    for (const [boardId, connections] of boards) {
      // Serialize once per board, and avoid broadcasting an identical roster on
      // every heartbeat. This cache is disposable across DO hibernation.
      const message = JSON.stringify({
        type: "presence",
        peers: connections.map(({ info }) => ({
          id: info.id,
          userId: info.userId,
          name: info.name,
          role: info.role,
          editing: info.editing,
        })),
      });
      if (message !== this.lastPresence.get(boardId))
        for (const { socket } of connections) this.send(socket, message);
      this.lastPresence.set(boardId, message);
    }
    for (const boardId of this.lastPresence.keys())
      if (!boards.has(boardId)) this.lastPresence.delete(boardId);
  }
  async webSocketMessage(socket, raw) {
    if (typeof raw !== "string" || raw.length > 2048) {
      socket.close(1009, "Message too large");
      return;
    }
    const info = socket.deserializeAttachment();
    if (!info || info.expires <= Date.now()) {
      socket.close(4001, "Session expired");
      return;
    }
    if (Date.now() - (info.window || 0) > 1000) {
      info.window = Date.now();
      info.messages = 0;
    }
    if ((info.messages = (info.messages || 0) + 1) > 20) {
      socket.close(1008, "Too many messages");
      return;
    }
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      socket.close(1003, "Invalid message");
      return;
    }
    if (message.type !== "presence") return;
    // Revocations are pushed immediately; revalidation also covers lost notices
    // and sessions evicted by the login session limit.
    if (Date.now() - info.checked > 20_000) {
      const security = await loadSecurity(this.env);
      const user = security.users.find(
        (u) => u.id === info.userId && !u.disabled,
      );
      if (
        !user ||
        !security.sessions.some(
          (s) => s.hash === info.sessionHash && s.expires > Date.now(),
        ) ||
        user.role !== info.role
      ) {
        socket.close(4001, "Sign in again");
        return;
      }
      info.checked = Date.now();
    }
    if (typeof message.boardId !== "string" || message.boardId.length > 100)
      return;
    const editing = message.editing;
    info.boardId = message.boardId;
    info.editing =
      info.role !== "viewer" &&
      editing &&
      ["profile", "night"].includes(editing.kind) &&
      typeof editing.id === "string" &&
      editing.id.length <= 100
        ? { kind: editing.kind, id: editing.id }
        : null;
    info.seen = Date.now();
    socket.serializeAttachment(info);
    this.send(socket, { type: "pong" });
    this.presence();
  }
  webSocketClose(socket, code = 1000) {
    // Reciprocate for runtimes without automatic Close replies. This is also
    // safe on newer compatibility dates which already complete the handshake.
    socket.close(code === 1005 || code === 1006 ? 1000 : code, "");
    this.presence();
  }
  webSocketError(socket) {
    socket.close(1011, "Reconnect to the board");
    this.presence();
  }
}
