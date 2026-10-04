import test from "node:test";
import assert from "node:assert/strict";
import { LiveConnection } from "../public/lib/live.js";

function browser() {
  const keys = [
    "WebSocket",
    "navigator",
    "location",
    "document",
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
  ];
  const original = new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const timeouts = new Map(),
    intervals = new Map(),
    sockets = [];
  let nextId = 1;
  class Socket {
    static OPEN = 1;
    constructor() {
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
    }
    open() {
      this.readyState = 1;
      this.onopen();
    }
    message(data) {
      this.onmessage({ data: JSON.stringify(data) });
    }
    send(message) {
      this.sent.push(JSON.parse(message));
    }
    close(code = 1000) {
      this.readyState = 3;
      this.onclose?.({ code });
    }
  }
  const values = {
    WebSocket: Socket,
    navigator: { onLine: true },
    location: { protocol: "https:", host: "board.example" },
    document: { hidden: false },
    setTimeout: (callback, delay) => {
      const id = nextId++;
      timeouts.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id) => timeouts.delete(id),
    setInterval: (callback) => {
      const id = nextId++;
      intervals.set(id, callback);
      return id;
    },
    clearInterval: (id) => intervals.delete(id),
  };
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  const events = { status: [], presence: [], change: [], ready: 0, expired: 0 };
  const live = new LiveConnection({
    csrf: "test-token",
    onStatus: (status) => events.status.push(status),
    onPresence: (peers) => events.presence.push(peers),
    onChange: (version) => events.change.push(version),
    onReady: () => events.ready++,
    onExpired: () => events.expired++,
  });
  const restore = () => {
    live.stop();
    for (const [key, descriptor] of original)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
  };
  return { live, events, sockets, timeouts, intervals, restore };
}

test("late events from a replaced live socket cannot expire or disrupt the new connection", () => {
  const b = browser();
  try {
    const first = b.sockets[0];
    first.open();
    first.close();
    b.timeouts.get(b.live.retry).callback();
    const second = b.sockets[1];
    second.open();
    second.message({ type: "hello", connectionId: "current" });
    const heartbeat = b.live.heartbeat;
    first.onclose({ code: 4001 });
    first.message({ type: "hello", connectionId: "old" });
    first.onerror();
    assert.equal(b.events.expired, 0);
    assert.equal(b.live.connectionId, "current");
    assert.equal(second.readyState, 1);
    assert.ok(b.intervals.has(heartbeat));
    b.live.stop();
    second.onopen();
    assert.equal(b.events.ready, 2);
    assert.equal(b.intervals.size, 0);
  } finally {
    b.restore();
  }
});

test("stalled connections reconnect and malformed messages cannot break board updates", () => {
  const b = browser();
  try {
    const socket = b.sockets[0];
    socket.open();
    socket.message(null);
    socket.message({ type: "presence", peers: null });
    socket.message({ type: "change", version: "invalid" });
    socket.message({ type: "change", version: 7 });
    assert.deepEqual(b.events.change, [7]);
    b.live.received = Date.now() - 70_000;
    b.intervals.get(b.live.heartbeat)();
    assert.equal(socket.readyState, 3);
    assert.equal(b.events.status.at(-1), "reconnecting");
    assert.ok(b.timeouts.has(b.live.retry));
    assert.deepEqual(b.events.presence.at(-1), []);
  } finally {
    b.restore();
  }
});

test("a never-opened socket times out and active session revocation stops all retries", () => {
  const b = browser();
  try {
    b.timeouts.get(b.live.connectionTimeout).callback();
    assert.equal(b.sockets[0].readyState, 3);
    b.timeouts.get(b.live.retry).callback();
    const second = b.sockets[1];
    second.open();
    second.close(4001);
    assert.equal(b.events.expired, 1);
    assert.equal(b.live.stopped, true);
    assert.equal(b.intervals.size, 0);
    // The fired fake timer remains registered; stop must still clear it.
    assert.equal(b.timeouts.size, 0);
  } finally {
    b.restore();
  }
});
