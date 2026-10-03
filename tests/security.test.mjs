import test from "node:test";
import assert from "node:assert/strict";
import { handleApi } from "../server/api.js";
import { emptySecurity } from "../server/auth.js";
import { emptyState } from "../public/lib/domain.js";
import worker from "../worker.js";
import { sheet } from "./fixture.mjs";

export function memoryStore(initial) {
  let value = structuredClone(initial);
  return {
    load: async () => structuredClone(value),
    save: async (next, expected) => {
      if (value.version !== expected) return false;
      value = structuredClone(next);
      return true;
    },
  };
}
const password = "A test-only long password 2026";
function environment() {
  return {
    LOCAL_DEV: "true",
    AUTH_STORE: memoryStore(emptySecurity()),
    STORE: memoryStore(emptyState()),
    SNAPSHOT_STORE: memoryStore({ version: 0, snapshots: [] }),
  };
}
async function request(env, path, input, session, extra = {}) {
  const origin = extra.origin || "http://localhost";
  const headers = {
    ...(input ? { Origin: origin, "Content-Type": "application/json" } : {}),
    ...(session
      ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
      : {}),
    ...extra.headers,
  };
  return handleApi(
    new Request(origin + path, {
      method: input ? "POST" : "GET",
      headers,
      body: input ? JSON.stringify(input) : undefined,
    }),
    env,
    extra.ctx || {},
  );
}
async function login(
  env,
  username = "administrator",
  setup = false,
  extra = {},
) {
  const response = await request(
    env,
    setup ? "/api/auth/setup" : "/api/auth/login",
    { username, name: username, password, ...extra.input },
    null,
    extra,
  );
  assert.equal(
    response.status,
    200,
    JSON.stringify(await response.clone().json()),
  );
  return {
    ...(await response.json()),
    cookie: response.headers.get("Set-Cookie").split(";")[0],
  };
}
async function createUser(env, admin, role) {
  const response = await request(
    env,
    "/api/admin/users",
    { username: role, name: role, role, password },
    admin,
  );
  assert.equal(response.status, 200);
  return (await response.json()).user;
}
const version = async (env) => (await env.STORE.load()).version;

test("night and board deletions enforce roles and save restorable pre-deletion states", async () => {
  const env = environment(),
    admin = await login(env, "administrator", true);
  await createUser(env, admin, "manager");
  await createUser(env, admin, "viewer");
  const manager = await login(env, "manager"),
    viewer = await login(env, "viewer");
  const created = await request(
    env,
    "/api/terms",
    { code: "MT26", rows: sheet, version: await version(env) },
    admin,
  );
  const term = (await created.json()).state.terms[0],
    night = term.nights[0],
    instance = term.instances[0];
  const action = async (type, user, extra = {}) =>
    request(
      env,
      "/api/action",
      {
        type,
        termId: term.id,
        nightId: night.id,
        version: await version(env),
        ...extra,
      },
      user,
    );
  assert.equal(
    (await action("move", manager, { instanceId: instance.id, slot: 0 }))
      .status,
    200,
  );
  assert.equal(
    (
      await action("confirm", manager, {
        instanceId: instance.id,
        confirmed: true,
      })
    ).status,
    200,
  );
  const before = await env.STORE.load();
  assert.equal((await action("delete-night", viewer)).status, 403);
  assert.equal((await action("delete-board", manager)).status, 403);
  assert.equal(
    (await action("delete-night", manager, { version: 0 })).status,
    409,
  );
  assert.equal(
    (await action("delete-night", manager, { nightId: "missing" })).status,
    400,
  );
  assert.equal((await env.SNAPSHOT_STORE.load()).snapshots.length, 0);
  assert.deepEqual(await env.STORE.load(), before);
  assert.equal((await action("delete-night", manager)).status, 200);
  const after = await env.STORE.load();
  assert.equal(
    after.terms[0].nights.some((n) => n.id === night.id),
    false,
  );
  const returned = after.terms[0].instances.find((i) => i.id === instance.id);
  assert.equal(returned.nightId, null);
  assert.equal(returned.slot, null);
  assert.equal(returned.confirmed, false);
  assert.equal(returned.period, undefined);
  assert.deepEqual(after.terms[0].profiles, before.terms[0].profiles);
  const saved = (await env.SNAPSHOT_STORE.load()).snapshots.at(-1);
  assert.deepEqual(saved.data.terms, before.terms);
  assert.equal(saved.author, "manager");
  assert.match(saved.name, /^Before deleting MT26 night/);
  assert.equal(
    (
      await request(
        env,
        "/api/admin/restore",
        { id: saved.id, version: await version(env) },
        admin,
      )
    ).status,
    200,
  );
  assert.deepEqual((await env.STORE.load()).terms, before.terms);
  assert.equal((await action("delete-board", admin)).status, 200);
  assert.equal((await env.STORE.load()).terms.length, 0);
  const boardSnapshot = (await env.SNAPSHOT_STORE.load()).snapshots.at(-1);
  assert.match(boardSnapshot.name, /^Before deleting Open Decks MT26/);
  assert.deepEqual(boardSnapshot.data.terms, before.terms);
  assert.equal(
    (
      await request(
        env,
        "/api/admin/restore",
        { id: boardSnapshot.id, version: await version(env) },
        admin,
      )
    ).status,
    200,
  );
  assert.deepEqual((await env.STORE.load()).terms, before.terms);
});

test("deletion leaves the workspace untouched when the safety snapshot cannot be saved", async () => {
  const env = environment(),
    admin = await login(env, "administrator", true);
  const created = await request(
    env,
    "/api/terms",
    { code: "MT26", rows: sheet, version: 0 },
    admin,
  );
  const term = (await created.json()).state.terms[0],
    before = await env.STORE.load();
  env.SNAPSHOT_STORE.save = async () => {
    throw new Error("Snapshot storage unavailable");
  };
  for (const type of ["delete-night", "delete-board"]) {
    const response = await request(
      env,
      "/api/action",
      {
        type,
        termId: term.id,
        nightId: term.nights[0].id,
        version: before.version,
      },
      admin,
    );
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Snapshot storage unavailable/);
    assert.deepEqual(await env.STORE.load(), before);
  }
});

test("first-run setup has no default login, hashes passwords, and cannot be repeated", async () => {
  const env = environment();
  assert.equal((await request(env, "/api/state")).status, 401);
  const before = await (await request(env, "/api/auth/status")).json();
  assert.equal(before.initialized, false);
  const admin = await login(env, "administrator", true);
  const security = await env.AUTH_STORE.load();
  assert.match(security.users[0].password, /^scrypt\$/);
  assert.equal(JSON.stringify(security).includes(password), false);
  assert.equal(
    security.sessions[0].hash.includes(admin.cookie.split("=")[1]),
    false,
  );
  assert.equal(
    (await request(env, "/api/auth/setup", { username: "second", password }))
      .status,
    409,
  );
  assert.equal((await request(env, "/api/state", null, admin)).status, 200);
  assert.equal(
    (
      await request(env, "/api/auth/login", {
        username: "administrator",
        password: "Incorrect test password",
      })
    ).status,
    401,
  );
  const response = await request(env, "/api/auth/login", {
    username: "administrator",
    password,
  });
  assert.match(response.headers.get("Set-Cookie"), /HttpOnly; SameSite=Strict/);
  assert.equal((await response.json()).user.password, undefined);
});

test("production setup requires an owner secret, HTTPS and a secure host-only cookie", async () => {
  const env = environment();
  delete env.LOCAL_DEV;
  env.ADMIN_SETUP_TOKEN = "deployment-owner-test-key".repeat(3);
  const origin = "https://workspace.example.invalid";
  assert.equal(
    (
      await request(
        env,
        "/api/auth/setup",
        { username: "administrator", password },
        null,
        { origin },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(env, "/api/auth/setup", {
        username: "administrator",
        password,
        setupToken: env.ADMIN_SETUP_TOKEN,
      })
    ).status,
    403,
  );
  const response = await request(
    env,
    "/api/auth/setup",
    { username: "administrator", password, setupToken: env.ADMIN_SETUP_TOKEN },
    null,
    { origin },
  );
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("Set-Cookie"),
    /^__Host-ouems_session=.*; Path=\/; HttpOnly; SameSite=Strict; Max-Age=28800; Secure$/,
  );
  assert.equal(
    (
      await request(env, "/api/state", null, null, {
        origin,
        ctx: {
          access: { getIdentity: async () => ({ email: "spoofed@invalid" }) },
        },
      })
    ).status,
    401,
  );
});

test("all workspace routes and code are gated; login assets alone stay public", async () => {
  const env = environment();
  const routes = [
    "/api/state",
    "/api/export",
    "/api/admin/history",
    "/api/admin/users",
  ];
  for (const path of routes)
    assert.equal((await request(env, path)).status, 401);
  for (const path of [
    "/api/action",
    "/api/terms",
    "/api/import",
    "/api/preview",
    "/api/admin/restore",
  ])
    assert.equal((await request(env, path, {})).status, 401);
  env.ASSETS = {
    fetch: async (req) => new Response(new URL(req.url).pathname),
  };
  for (const path of [
    "/",
    "/index.html",
    "/app.js",
    "/lib/domain.js",
    "/anything",
  ]) {
    const response = await worker.fetch(
      new Request("http://localhost" + path),
      env,
      {},
    );
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("Location"), "/login");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  const loginPage = await worker.fetch(
    new Request("http://localhost/login"),
    env,
    {},
  );
  assert.equal(await loginPage.text(), "/login");
  assert.match(
    loginPage.headers.get("Content-Security-Policy"),
    /frame-ancestors 'none'/,
  );
});

test("sessions reject forged, expired and revoked cookies and require CSRF and same-origin writes", async () => {
  const env = environment(),
    admin = await login(env, "administrator", true);
  assert.equal(
    (
      await request(
        env,
        "/api/terms",
        { code: "MT26", rows: sheet, version: 0 },
        admin,
        { headers: { "X-CSRF-Token": "wrong" } },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        env,
        "/api/terms",
        { code: "MT26", rows: sheet, version: 0 },
        admin,
        { headers: { Origin: "https://evil.invalid" } },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(env, "/api/state", null, {
        ...admin,
        cookie: "ouems_session=" + "b".repeat(64),
      })
    ).status,
    401,
  );
  assert.equal((await request(env, "/api/auth/logout", {}, admin)).status, 200);
  assert.equal((await request(env, "/api/state", null, admin)).status, 401);
  const again = await login(env);
  const data = await env.AUTH_STORE.load();
  data.sessions.forEach((s) => (s.expires = 0));
  await env.AUTH_STORE.save(
    { ...data, version: data.version + 1 },
    data.version,
  );
  assert.equal((await request(env, "/api/state", null, again)).status, 401);
});

test("administrator, manager and viewer permissions are enforced on every API, with private viewer data removed", async () => {
  const env = environment(),
    admin = await login(env, "administrator", true);
  await createUser(env, admin, "manager");
  await createUser(env, admin, "viewer");
  const manager = await login(env, "manager"),
    viewer = await login(env, "viewer");
  const created = await request(
    env,
    "/api/terms",
    { code: "MT26", rows: sheet, version: await version(env) },
    manager,
  );
  assert.equal(created.status, 201);
  const { state } = await created.json(),
    term = state.terms[0];
  const edit = {
    type: "edit",
    termId: term.id,
    profileId: term.profiles[0].id,
    fields: { name: "Manager edit" },
    version: state.version,
  };
  assert.equal((await request(env, "/api/action", edit, manager)).status, 200);
  for (const user of [manager, viewer]) {
    for (const path of [
      "/api/admin/users",
      "/api/admin/history",
      "/api/export",
    ])
      assert.equal((await request(env, path, null, user)).status, 403);
    for (const path of [
      "/api/admin/users",
      "/api/admin/snapshots",
      "/api/admin/restore",
    ])
      assert.equal((await request(env, path, {}, user)).status, 403);
    assert.equal(
      (
        await request(
          env,
          "/api/action",
          { ...edit, type: "revert", version: await version(env) },
          user,
        )
      ).status,
      403,
    );
  }
  for (const path of [
    "/api/action",
    "/api/terms",
    "/api/preview",
    "/api/import",
  ])
    assert.equal((await request(env, path, edit, viewer)).status, 403);
  for (const user of [admin, manager, viewer]) {
    const exposed = await (await request(env, "/api/state", null, user)).json();
    assert.equal(exposed.state.history, undefined);
    assert.equal(exposed.state.users, undefined);
    assert.equal(JSON.stringify(exposed).includes("scrypt$"), false);
    if (user === viewer) {
      assert.equal(exposed.state.terms[0].profiles[0].transcript, undefined);
      assert.equal(exposed.state.terms[0].profiles[0].original, undefined);
      assert.equal(exposed.state.terms[0].sheetUrl, undefined);
    }
  }
});

test("account changes revoke existing sessions and the last administrator cannot be disabled or demoted", async () => {
  const env = environment(),
    admin = await login(env, "administrator", true);
  const account = await createUser(env, admin, "manager");
  const manager = await login(env, "manager");
  assert.equal(
    (
      await request(
        env,
        "/api/admin/users",
        { ...account, disabled: true },
        admin,
      )
    ).status,
    200,
  );
  assert.equal((await request(env, "/api/state", null, manager)).status, 401);
  assert.equal(
    (await request(env, "/api/auth/login", { username: "manager", password }))
      .status,
    401,
  );
  for (const input of [
    { ...admin.user, role: "viewer" },
    { ...admin.user, disabled: true },
  ])
    assert.equal(
      (await request(env, "/api/admin/users", input, admin)).status,
      400,
    );
  assert.equal((await request(env, "/api/state", null, admin)).status, 200);
  const response = await request(
    env,
    "/api/auth/password",
    { currentPassword: password, password: "A different test password 2026" },
    admin,
  );
  assert.equal(response.status, 200);
  assert.equal((await request(env, "/api/state", null, admin)).status, 401);
});

test("failed sign-ins are persistently rate-limited before more password checks", async () => {
  const env = environment();
  await login(env, "administrator", true);
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await request(env, "/api/auth/login", {
          username: "administrator",
          password: "Incorrect test password",
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await request(env, "/api/auth/login", {
        username: "administrator",
        password,
      })
    ).status,
    429,
  );
});

test("edit history records who and before/after; five states are retained and restores preserve accounts, history and conflict checks", async () => {
  const env = environment(),
    admin = await login(env, "administrator", true);
  const response = await request(
    env,
    "/api/terms",
    { code: "MT26", rows: sheet, version: 0 },
    admin,
  );
  const { state } = await response.json(),
    term = state.terms[0];
  for (let i = 0; i < 7; i++) {
    const saved = await request(
      env,
      "/api/admin/snapshots",
      { name: `State ${i}`, version: await version(env) },
      admin,
    );
    assert.equal(saved.status, 201);
  }
  const info = await (
    await request(env, "/api/admin/history", null, admin)
  ).json();
  assert.equal(info.snapshots.length, 5);
  assert.equal(info.snapshots.at(-1).name, "State 2");
  await createUser(env, admin, "manager");
  const edit = await request(
    env,
    "/api/action",
    {
      type: "edit",
      termId: term.id,
      profileId: term.profiles[0].id,
      fields: { name: "Changed DJ" },
      version: await version(env),
    },
    admin,
  );
  assert.equal(edit.status, 200);
  const after = await (
    await request(env, "/api/admin/history", null, admin)
  ).json();
  const entry = after.history.at(-1);
  assert.equal(entry.author, "administrator");
  assert.equal(
    entry.changes.some(
      (c) => c.path.endsWith(".name") && c.after === '"Changed DJ"',
    ),
    true,
  );
  const stale = await request(
    env,
    "/api/admin/restore",
    { id: info.snapshots[0].id, version: 0 },
    admin,
  );
  assert.equal(stale.status, 409);
  const restored = await request(
    env,
    "/api/admin/restore",
    { id: info.snapshots[0].id, version: await version(env) },
    admin,
  );
  assert.equal(restored.status, 200);
  assert.equal(
    (await env.STORE.load()).terms[0].profiles[0].name,
    term.profiles[0].name,
  );
  assert.equal((await env.AUTH_STORE.load()).users.length, 2);
  const final = await (
    await request(env, "/api/admin/history", null, admin)
  ).json();
  assert.equal(final.snapshots.length, 5);
  assert.match(final.snapshots[0].name, /^Before restoring/);
  assert.match(final.history.at(-1).summary, /^Restored state/);
  assert.equal(
    final.history.some((h) => h.summary.startsWith("edit:")),
    true,
  );
});
