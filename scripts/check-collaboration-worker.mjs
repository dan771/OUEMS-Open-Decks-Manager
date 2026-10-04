import assert from "node:assert/strict";
import WebSocket from "ws";
import { prepareAction, applyChanges } from "../public/lib/collaboration.js";
import { sheet } from "../tests/fixture.mjs";
import { BoardSaveQueue } from "../public/lib/save-queue.js";

const origin = "http://127.0.0.1:8791";
const signed = await fetch(origin + "/api/auth/login", {
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json" },
  body: JSON.stringify({
    username: "worker-runtime-check",
    password: "Local worker test password 2026",
  }),
});
assert.equal(
  signed.status,
  200,
  "Run scripts/check-worker.mjs against the isolated local Worker first.",
);
const cookie = signed.headers.get("Set-Cookie").split(";")[0],
  { csrf, user } = await signed.json();
async function request(path, input) {
  const response = await fetch(origin + path, {
    method: input ? "POST" : "GET",
    headers: {
      Cookie: cookie,
      ...(input
        ? {
            Origin: origin,
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf,
          }
        : {}),
    },
    body: input ? JSON.stringify(input) : undefined,
  });
  const data = await response.json();
  assert.ok(response.ok, data.error || `HTTP ${response.status}`);
  return data;
}
let { state } = await request("/api/state");
let term = state.terms.find((t) => t.code === "MT47");
if (!term) {
  const row = [...sheet[1]];
  row[0] = "second-live-runtime-response";
  row[2] = "Live runtime second DJ";
  ({ state } = await request("/api/terms", {
    code: "MT47",
    rows: [...sheet, row],
    version: state.version,
    operationId: crypto.randomUUID(),
  }));
  term = state.terms.at(-1);
}
const sockets = [];
async function connect() {
  const socket = new WebSocket(
    origin.replace("http:", "ws:") + "/api/live",
    ["ouems-live", `csrf.${csrf}`],
    { headers: { Cookie: cookie, Origin: origin } },
  );
  socket.messages = [];
  socket.on("message", (raw) => socket.messages.push(JSON.parse(raw)));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Live connection timed out")),
      5000,
    );
    socket.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", reject);
  });
  sockets.push(socket);
  socket.send(
    JSON.stringify({
      type: "presence",
      boardId: term.id,
      editing: { kind: "profile", id: term.profiles[0].id },
    }),
  );
  return socket;
}
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Live update timed out");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
try {
  const a = await connect(),
    b = await connect();
  await until(() =>
    a.messages.some((m) => m.type === "presence" && m.peers.length === 2),
  );
  const profileId = term.profiles[0].id,
    suffix = Date.now();
  const commands = [
    { name: `Live D1 DJ ${suffix}` },
    { genres: `Live D1 genres ${suffix}` },
  ].map((fields) => ({
    ...prepareAction(state, {
      type: "edit",
      termId: term.id,
      profileId,
      fields,
    }),
    version: state.version,
    operationId: crypto.randomUUID(),
  }));
  const saves = await Promise.all(
    commands.map((input) => request("/api/action", input)),
  );
  const newest = Math.max(...saves.map((save) => save.state.version));
  await until(() =>
    b.messages.some(
      (message) => message.type === "change" && message.version === newest,
    ),
  );
  const delta = await request(
    `/api/state?since=${state.version}&role=administrator`,
  );
  assert.ok(delta.patch);
  assert.equal(delta.patch.entities.length, 1);
  assert.equal(delta.patch.entities[0].kind, "profile");
  state = applyChanges(state, delta.patch);
  const merged = state.terms
    .find((t) => t.id === term.id)
    .profiles.find((p) => p.id === profileId);
  assert.equal(merged.name, commands[0].fields.name);
  assert.equal(merged.genres, commands[1].fields.genres);
  const comment = {
    ...prepareAction(state, {
      type: "comment",
      termId: term.id,
      profileId,
      text: `Live retry ${suffix}`,
    }),
    version: state.version,
    operationId: crypto.randomUUID(),
  };
  await request("/api/action", comment);
  const repeated = await request("/api/action", comment);
  assert.equal(repeated.replayed, true);
  assert.equal(
    repeated.state.terms
      .find((t) => t.id === term.id)
      .profiles.find((p) => p.id === profileId)
      .comments.filter((c) => c.text === comment.text).length,
    1,
  );
  const unchanged = await request(
    `/api/state?since=${repeated.state.version}&role=administrator`,
  );
  assert.equal(unchanged.unchanged, true);
  // Use the browser's real queue against D1, including a move which creates new
  // timeline slots and another move whose guards depend on those generated IDs.
  ({ state } = await request("/api/state"));
  const queueTerm = state.terms.find((t) => t.id === term.id);
  const queueNight = queueTerm.nights[1];
  for (const card of queueTerm.instances) {
    if (card.nightId !== queueNight.id) continue;
    ({ state } = await request("/api/action", {
      ...prepareAction(state, {
        type: "move",
        termId: term.id,
        instanceId: card.id,
        nightId: null,
        slot: null,
      }),
      version: state.version,
      operationId: crypto.randomUUID(),
    }));
  }
  ({ state } = await request("/api/action", {
    ...prepareAction(state, {
      type: "plan",
      termId: term.id,
      nightId: queueNight.id,
      sets: [{ instanceIds: [], duration: 30 }],
    }),
    version: state.version,
    operationId: crypto.randomUUID(),
  }));
  let release;
  const delayed = new Promise((resolve) => {
    release = resolve;
  });
  const queue = new BoardSaveQueue({
    state,
    userId: user.id,
    persist: () => {},
    onChange: () => {},
    send: async (payload) => {
      await delayed;
      return request("/api/action", payload);
    },
  });
  const queuedCard = queueTerm.instances[1];
  const savesInOrder = [1, 2].map((slot) =>
    queue.enqueue({
      type: "move",
      termId: term.id,
      instanceId: queuedCard.id,
      nightId: queueNight.id,
      slot,
      period: "early",
    }),
  );
  savesInOrder.push(
    queue.enqueue({
      type: "confirm",
      termId: term.id,
      instanceId: queuedCard.id,
      confirmed: true,
    }),
  );
  const previewIds = queue.view.terms
    .find((t) => t.id === term.id)
    .nights[1].plan.map((s) => s.id);
  release();
  assert.ok((await Promise.all(savesInOrder)).every(Boolean));
  ({ state } = await request("/api/state"));
  const savedTerm = state.terms.find((t) => t.id === term.id);
  assert.deepEqual(
    savedTerm.nights[1].plan.map((s) => s.id),
    previewIds,
  );
  assert.equal(savedTerm.instances.find((i) => i.id === queuedCard.id).slot, 2);
  assert.equal(
    savedTerm.instances.find((i) => i.id === queuedCard.id).confirmed,
    true,
  );
  a.send(JSON.stringify({ type: "presence", boardId: term.id, editing: null }));
  await until(() => a.messages.some((m) => m.type === "pong"));
  await request("/api/auth/logout", {});
  await until(() =>
    sockets.every((socket) => socket.readyState === WebSocket.CLOSED),
  );
  console.log(
    "Cloudflare collaboration passed: hibernating Durable Object sockets, presence heartbeats, live notifications, concurrent D1 field merges, incremental reads, queued dependent timeline moves, retry deduplication and immediate session revocation.",
  );
} finally {
  for (const socket of sockets) socket.close();
}
