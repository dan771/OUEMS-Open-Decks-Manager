import assert from "node:assert/strict";
import WebSocket from "ws";
import { headers, row } from "../tests/fixture.mjs";
import { prepareAction } from "../public/lib/collaboration.js";

// Deliberately fixed to loopback: never stress a deployment or real workspace.
// Run check-worker.mjs first against an isolated Wrangler persistence directory.
const origin = "http://127.0.0.1:8791";
const timings = [];
async function request(path, input, session) {
  const start = performance.now();
  const response = await fetch(origin + path, {
    method: input ? "POST" : "GET",
    headers: {
      Cookie: session?.cookie || "",
      ...(input
        ? {
            Origin: origin,
            "Content-Type": "application/json",
            "X-CSRF-Token": session?.csrf || "",
          }
        : {}),
    },
    body: input ? JSON.stringify(input) : undefined,
  });
  const data = await response.json();
  timings.push({
    path,
    ms: performance.now() - start,
    status: response.status,
  });
  return {
    status: response.status,
    data,
    cookie: response.headers.get("Set-Cookie")?.split(";")[0],
  };
}
async function ok(path, input, session, status = 200) {
  const result = await request(path, input, session);
  assert.equal(result.status, status, JSON.stringify(result.data));
  return result.data;
}
async function login(username, password) {
  const result = await request("/api/auth/login", { username, password });
  assert.equal(
    result.status,
    200,
    "Run scripts/check-worker.mjs first: " + JSON.stringify(result.data),
  );
  return { cookie: result.cookie, ...result.data };
}
async function until(predicate) {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "Live notification timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
const admin = await login(
  "worker-runtime-check",
  "Local worker test password 2026",
);
const suffix = Date.now();
const usernames = [1, 2].map((n) => `capacity-${suffix}-${n}`);
for (const username of usernames)
  await ok(
    "/api/admin/users",
    {
      username,
      name: username,
      role: "manager",
      password: "Capacity test password 2026",
    },
    admin,
  );
// Three independent cookie jars and simultaneous password verification.
const users = await Promise.all([
  login("worker-runtime-check", "Local worker test password 2026"),
  ...usernames.map((name) => login(name, "Capacity test password 2026")),
]);
let { state } = await ok("/api/state", null, users[0]);
const previous = state.terms.find((t) => t.code === "MT48");
if (previous)
  ({ state } = await ok(
    "/api/action",
    {
      type: "delete-board",
      termId: previous.id,
      version: state.version,
    },
    users[0],
  ));
({ state } = await ok(
  "/api/terms",
  {
    code: "MT48",
    version: state.version,
    rows: [
      headers,
      ...Array.from({ length: 200 }, (_, i) => {
        const entry = [...row];
        entry[0] = `capacity-response-${suffix}-${i}`;
        entry[2] = `Capacity DJ ${i}`;
        return entry;
      }),
    ],
  },
  users[0],
  201,
));
const term = state.terms.find((t) => t.code === "MT48");
assert.equal(term.profiles.length, 200);
const sockets = [];
async function connect(session) {
  const socket = new WebSocket(
    origin.replace("http:", "ws:") + "/api/live",
    ["ouems-live", `csrf.${session.csrf}`],
    {
      headers: { Cookie: session.cookie, Origin: origin },
    },
  );
  sockets.push(socket);
  socket.messages = [];
  socket.on("message", (raw) => socket.messages.push(JSON.parse(raw)));
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.send(
    JSON.stringify({ type: "presence", boardId: term.id, editing: null }),
  );
  return socket;
}
const command = (fields, profileId = term.profiles[0].id) => ({
  ...prepareAction(state, { type: "edit", termId: term.id, profileId, fields }),
  version: state.version,
  operationId: crypto.randomUUID(),
});
try {
  const clients = await Promise.all(users.map(connect));
  await until(() =>
    clients.every((s) =>
      s.messages.some(
        (m) =>
          m.type === "presence" &&
          new Set(m.peers.map((p) => p.userId)).size === 3,
      ),
    ),
  );
  // 60 contending writes across 20 rounds, same DJ but independent fields.
  for (let round = 0; round < 20; round++) {
    const values = [`Name ${round}`, `Genres ${round}`, `College ${round}`];
    const commands = ["name", "genres", "college"].map((field, i) =>
      command({ [field]: values[i] }),
    );
    await Promise.all(
      commands.map((input, i) => ok("/api/action", input, users[i])),
    );
    ({ state } = await ok("/api/state", null, users[0]));
    const profile = state.terms.find((t) => t.id === term.id).profiles[0];
    assert.deepEqual([profile.name, profile.genres, profile.college], values);
  }
  const collisions = await Promise.all(
    users.map((session, i) =>
      request("/api/action", command({ name: `Competing ${i}` }), session),
    ),
  );
  assert.deepEqual(collisions.map((r) => r.status).sort(), [200, 409, 409]);
  ({ state } = await ok("/api/state", null, users[0]));
  const comments = users.map((session, i) => ({
    ...prepareAction(state, {
      type: "comment",
      termId: term.id,
      profileId: term.profiles[0].id,
      text: `Capacity comment ${i}`,
    }),
    version: state.version,
    operationId: crypto.randomUUID(),
  }));
  await Promise.all(
    comments.map((input, i) => ok("/api/action", input, users[i])),
  );
  for (let i = 0; i < 3; i++)
    assert.equal(
      (await ok("/api/action", comments[i], users[i])).replayed,
      true,
    );
  ({ state } = await ok("/api/state", null, users[0]));
  assert.equal(
    state.terms.find((t) => t.id === term.id).profiles[0].comments.length,
    3,
  );
  await until(() =>
    clients.every((s) =>
      s.messages.some(
        (m) => m.type === "change" && m.version === state.version,
      ),
    ),
  );
  for (const session of users)
    assert.equal(
      (
        await ok(
          `/api/state?since=${state.version}&role=${session.user.role}`,
          null,
          session,
        )
      ).unchanged,
      true,
    );
  assert.equal((await request("/api/admin/users", null, users[1])).status, 403);
  assert.equal((await request("/api/export", null, users[2])).status, 403);
  const exported = await ok("/api/export", null, users[0]);
  assert.equal(
    exported.terms.find((t) => t.id === term.id).profiles.length,
    200,
  );
  assert.equal(JSON.stringify(exported).includes("scrypt$"), false);
  // A disconnected organiser receives missed edits when returning.
  const missedVersion = state.version;
  clients[2].close();
  await until(() => clients[2].readyState === WebSocket.CLOSED);
  ({ state } = await ok(
    "/api/action",
    command({ genres: "After disconnect" }),
    users[0],
  ));
  const patch = await ok(
    `/api/state?since=${missedVersion}&role=manager`,
    null,
    users[2],
  );
  assert.equal(patch.patch.version, state.version);
  assert.equal(patch.patch.entities.length, 1);
  const reconnected = await connect(users[2]);
  await until(() =>
    reconnected.messages.some(
      (m) => m.type === "presence" && m.peers.length === 3,
    ),
  );
  await ok("/api/auth/logout", {}, users[1]);
  await until(() => clients[1].readyState === WebSocket.CLOSED);
  assert.equal((await request("/api/state", null, users[1])).status, 401);
  for (const session of [users[0], users[2]])
    await ok("/api/state", null, session);
  const sorted = timings
    .filter((t) => t.path === "/api/action" && t.status === 200)
    .map((t) => t.ms)
    .sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        result: "PASS",
        users: 3,
        djs: 200,
        concurrentIndependentEdits: 60,
        sameFieldCollision: "1 saved, 2 explicit conflicts",
        commentsAfterRetries: 3,
        presence: "3 distinct accounts",
        reconnect: "one-entity catch-up",
        revocation: "only signed-out account",
        successfulEditWallMs: {
          p50: Math.round(sorted[Math.floor(sorted.length * 0.5)]),
          p95: Math.round(sorted[Math.floor(sorted.length * 0.95)]),
        },
        note: "Local wall times are not production CPU measurements. Free quotas are not enforced by Wrangler.",
      },
      null,
      2,
    ),
  );
} finally {
  for (const socket of sockets) socket.close();
}
