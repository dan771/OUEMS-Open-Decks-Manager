import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { handleApi } from "../server/api.js";
import { emptySecurity } from "../server/auth.js";
import { demoState, demoRows } from "../server/demo.js";
import { actionBasis, prepareAction } from "../public/lib/collaboration.js";
import { createTerm } from "../public/lib/domain.js";
import { CollaborationHub, authorizeLive } from "../server/realtime.js";

const token = "c".repeat(64);
function memory(initial) {
  let state = structuredClone(initial);
  return {
    load: async () => structuredClone(state),
    save: async (next, version) => {
      if (state.version !== version) return false;
      state = structuredClone(next);
      return true;
    },
  };
}
function environment() {
  const security = emptySecurity();
  security.users.push({
    id: "organiser",
    username: "organiser",
    name: "Organiser",
    role: "administrator",
  });
  security.sessions.push({
    hash: createHash("sha256").update(token).digest("hex"),
    userId: "organiser",
    csrf: "test-csrf",
    expires: Date.now() + 60_000,
  });
  const notices = [];
  return {
    LOCAL_DEV: "true",
    STORE: memory(demoState()),
    AUTH_STORE: memory(security),
    SNAPSHOT_STORE: memory({ version: 0, snapshots: [] }),
    LIVE: { publish: (message) => notices.push(message) },
    notices,
  };
}
function request(env, path, input, extraHeaders = {}) {
  return handleApi(
    new Request(`http://localhost${path}`, {
      method: input ? "POST" : "GET",
      headers: {
        Cookie: `ouems_session=${token}`,
        "X-CSRF-Token": "test-csrf",
        ...(input
          ? { Origin: "http://localhost", "Content-Type": "application/json" }
          : {}),
        ...extraHeaders,
      },
      body: input ? JSON.stringify(input) : undefined,
    }),
    env,
    {},
  );
}
function command(snapshot, input, operationId = crypto.randomUUID()) {
  return {
    ...prepareAction(snapshot, { termId: snapshot.terms[0].id, ...input }),
    version: snapshot.version,
    operationId,
  };
}
test("twenty-four concurrent independent DJ edits all survive CAS retries", async () => {
  const env = environment();
  const initial = await env.STORE.load();
  const profiles = initial.terms[0].profiles;
  const commands = profiles.flatMap((profile, index) => [
    command(initial, {
      type: "edit",
      profileId: profile.id,
      fields: { name: `Name ${index}` },
    }),
    command(initial, {
      type: "edit",
      profileId: profile.id,
      fields: { genres: `Genres ${index}` },
    }),
  ]);
  const responses = await Promise.all(
    commands.map((input) => request(env, "/api/action", input)),
  );
  assert.deepEqual(
    responses.map((r) => r.status),
    commands.map(() => 200),
  );
  const final = await env.STORE.load();
  for (let index = 0; index < profiles.length; index++) {
    assert.equal(final.terms[0].profiles[index].name, `Name ${index}`);
    assert.equal(final.terms[0].profiles[index].genres, `Genres ${index}`);
  }
  assert.equal(env.notices.length, commands.length);
});
test("same-field collisions report the conflicting field without losing the winning edit", async () => {
  const env = environment(),
    state = await env.STORE.load(),
    profileId = state.terms[0].profiles[0].id;
  const saves = await Promise.all(
    ["First", "Second"].map((name) =>
      request(
        env,
        "/api/action",
        command(state, { type: "edit", profileId, fields: { name } }),
      ),
    ),
  );
  assert.deepEqual(saves.map((r) => r.status).sort(), [200, 409]);
  const rejected = saves.find((r) => r.status === 409);
  assert.deepEqual((await rejected.json()).conflicts, ["fields.name"]);
});
test("availability values and individual transcript answers merge independently", async () => {
  const env = environment(),
    state = await env.STORE.load(),
    profileId = state.terms[0].profiles[0].id;
  const date = state.terms[0].nights[0].date;
  const edits = [
    { fields: { availability: { [date]: { available: false } } } },
    { fields: { availability: { [date]: { timing: "Late" } } } },
    { answers: { 0: "First answer" } },
    { answers: { 1: "Second answer" } },
  ];
  const responses = await Promise.all(
    edits.map((edit) => {
      const input = {
        type: "edit",
        termId: state.terms[0].id,
        profileId,
        ...edit,
      };
      return request(env, "/api/action", {
        ...input,
        base: actionBasis(state, input),
        version: state.version,
        operationId: crypto.randomUUID(),
      });
    }),
  );
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200, 200, 200],
  );
  const p = (await env.STORE.load()).terms[0].profiles[0];
  assert.deepEqual(p.availability[date], { available: false, timing: "Late" });
  assert.equal(p.transcript[0].answer, "First answer");
  assert.equal(p.transcript[1].answer, "Second answer");
});
test("comments append together; retrying a committed comment creates no duplicate", async () => {
  const env = environment(),
    state = await env.STORE.load(),
    profileId = state.terms[0].profiles[0].id;
  const input = command(state, {
    type: "comment",
    profileId,
    text: "First shared comment",
  });
  const responses = await Promise.all([
    request(env, "/api/action", input),
    request(env, "/api/action", input),
    request(
      env,
      "/api/action",
      command(state, {
        type: "comment",
        profileId,
        text: "Second shared comment",
      }),
    ),
  ]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200, 200],
  );
  const comments = (await env.STORE.load()).terms[0].profiles[0].comments;
  assert.equal(comments.filter((c) => c.text === input.text).length, 1);
  assert.equal(
    comments.filter((c) => c.text === "Second shared comment").length,
    1,
  );
  const misuse = await request(env, "/api/action", {
    ...input,
    text: "Different payload with the same identifier",
  });
  assert.equal(misuse.status, 409);
});
test("unchanged imports do not create revisions or notifications; conditional reads omit the workspace", async () => {
  const env = environment(),
    state = await env.STORE.load();
  const imported = await request(env, "/api/import", {
    termId: state.terms[0].id,
    rows: demoRows,
  });
  assert.equal(imported.status, 200);
  assert.equal((await imported.json()).state.version, state.version);
  assert.equal(env.notices.length, 0);
  const unchanged = await (
    await request(env, `/api/state?since=${state.version}&role=administrator`)
  ).json();
  assert.equal(unchanged.unchanged, true);
  assert.equal(unchanged.state, undefined);
  const stateResponse = await (
    await request(env, `/api/state?since=${state.version}&role=viewer`)
  ).json();
  assert.ok(stateResponse.state);
});
test("edits on different boards and independent moves coexist; competing moves reject", async () => {
  const env = environment();
  let initial = await env.STORE.load();
  initial.terms.push(createTerm("HT27", "", demoRows));
  await env.STORE.save(initial, initial.version);
  const a = initial.terms[0],
    b = initial.terms[1];
  const edits = [a, b].map((term) =>
    command(initial, {
      type: "edit",
      termId: term.id,
      profileId: term.profiles[0].id,
      fields: { genres: term.code },
    }),
  );
  assert.deepEqual(
    (
      await Promise.all(
        edits.map((input) => request(env, "/api/action", input)),
      )
    ).map((r) => r.status),
    [200, 200],
  );
  const state = await env.STORE.load();
  const term = state.terms[0];
  const moves = term.instances.slice(0, 2).map((i) =>
    command(state, {
      type: "move",
      instanceId: i.id,
      nightId: term.nights[0].id,
      period: "early",
      slot: null,
    }),
  );
  assert.deepEqual(
    (
      await Promise.all(
        moves.map((input) => request(env, "/api/action", input)),
      )
    ).map((r) => r.status),
    [200, 200],
  );
  assert.equal(
    (
      await request(env, "/api/action", {
        ...moves[0],
        operationId: crypto.randomUUID(),
        nightId: term.nights[1].id,
      })
    ).status,
    409,
  );
});
test("live upgrades require authentication, matching Origin and a session CSRF protocol", async () => {
  const env = environment();
  const headers = {
    Cookie: `ouems_session=${token}`,
    Origin: "http://localhost",
    "Sec-WebSocket-Protocol": "ouems-live, csrf.test-csrf",
  };
  assert.equal(
    (
      await authorizeLive(
        new Request("http://localhost/api/live", { headers }),
        env,
      )
    ).userId,
    "organiser",
  );
  for (const overrides of [
    { Origin: "https://evil.invalid" },
    { Cookie: "" },
    { "Sec-WebSocket-Protocol": "ouems-live" },
  ])
    await assert.rejects(
      authorizeLive(
        new Request("http://localhost/api/live", {
          headers: { ...headers, ...overrides },
        }),
        env,
      ),
    );
});

test("implicit API moves guard availability when their destination half is not explicit", async () => {
  const env = environment();
  const state = await env.STORE.load(),
    term = state.terms[0];
  const card = term.instances.find((i) => !i.nightId),
    night = term.nights[0];
  const action = {
    type: "move",
    termId: term.id,
    instanceId: card.id,
    nightId: night.id,
    slot: null,
  };
  const basis = actionBasis(state, action);
  const timing =
    basis.defaultPeriod === "late"
      ? "First half - 6-9pm"
      : "Second half - 9pm-midnight";
  const edit = command(state, {
    type: "edit",
    profileId: card.profileId,
    fields: { availability: { [night.date]: { available: true, timing } } },
  });
  assert.equal((await request(env, "/api/action", edit)).status, 200);
  const moved = await request(env, "/api/action", {
    ...action,
    base: basis,
    version: state.version,
    operationId: crypto.randomUUID(),
  });
  assert.equal(moved.status, 409);
  assert.ok((await moved.json()).conflicts.includes("defaultPeriod"));
});
test("presence is scoped by board, expires, suppresses viewer editing and revokes sessions", async () => {
  const env = environment(),
    sockets = [];
  const room = new CollaborationHub({ getWebSockets: () => sockets }, env);
  function socket(userId, boardId, role = "manager") {
    let info = {
      id: crypto.randomUUID(),
      userId,
      name: userId,
      boardId,
      role,
      editing: null,
      seen: Date.now(),
      checked: Date.now(),
      expires: Date.now() + 60000,
    };
    const value = {
      readyState: 1,
      sent: [],
      deserializeAttachment: () => structuredClone(info),
      serializeAttachment: (next) => {
        info = structuredClone(next);
      },
      send: (raw) => value.sent.push(JSON.parse(raw)),
      close: () => {
        value.readyState = 3;
      },
    };
    sockets.push(value);
    return value;
  }
  const a = socket("A", "one"),
    b = socket("B", "two"),
    viewer = socket("Viewer", "one", "viewer");
  room.presence();
  assert.deepEqual(
    a.sent.at(-1).peers.map((p) => p.name),
    ["A", "Viewer"],
  );
  assert.deepEqual(
    b.sent.at(-1).peers.map((p) => p.name),
    ["B"],
  );
  const sent = a.sent.length;
  room.presence();
  assert.equal(
    a.sent.length,
    sent,
    "unchanged presence must not be broadcast again",
  );
  await room.webSocketMessage(
    viewer,
    JSON.stringify({
      type: "presence",
      boardId: "one",
      editing: { kind: "profile", id: "private-dj" },
    }),
  );
  assert.equal(viewer.deserializeAttachment().editing, null);
  assert.equal(
    viewer.sent.at(-1).type,
    "pong",
    "unchanged heartbeats still acknowledge liveness",
  );
  room.publish({ type: "revoke", userId: "A" });
  assert.equal(a.readyState, 3);
  const expired = b.deserializeAttachment();
  expired.expires = Date.now() - 1;
  b.serializeAttachment(expired);
  room.presence();
  assert.equal(b.readyState, 3);
});

test("board activity includes creation, imports and restores without private values", async () => {
  const env = environment();
  const initial = await env.STORE.load();
  const created = await request(env, "/api/terms", {
    code: "MT49",
    rows: demoRows,
    version: initial.version,
    operationId: crypto.randomUUID(),
  });
  assert.equal(created.status, 201);
  let { state, result } = await created.json();
  const termId = result.termId;
  const newRow = [...demoRows[1]];
  newRow[0] = "unique-activity-import";
  newRow[2] = "Activity import DJ";
  const imported = await request(env, "/api/import", {
    termId,
    rows: [...demoRows, newRow],
  });
  assert.equal(imported.status, 200);
  ({ state } = await imported.json());
  const profileId = state.terms.find((t) => t.id === termId).profiles[0].id;
  assert.equal(
    (
      await request(env, "/api/action", {
        ...prepareAction(state, {
          type: "comment",
          termId,
          profileId,
          text: "Private team note",
        }),
        version: state.version,
        operationId: crypto.randomUUID(),
      })
    ).status,
    200,
  );
  state = await env.STORE.load();
  assert.equal(
    (
      await request(env, "/api/admin/snapshots", {
        name: "Activity restore",
        version: state.version,
        operationId: crypto.randomUUID(),
      })
    ).status,
    201,
  );
  state = await env.STORE.load();
  const id = (await env.SNAPSHOT_STORE.load()).snapshots[0].id;
  assert.equal(
    (
      await request(env, "/api/admin/restore", {
        id,
        version: state.version,
        operationId: crypto.randomUUID(),
      })
    ).status,
    200,
  );
  const activity = await (
    await request(env, `/api/activity?termId=${termId}`)
  ).json();
  assert.ok(
    activity.activity.some((e) => e.summary.startsWith("Created Open Decks")),
  );
  assert.ok(
    activity.activity.some((e) => e.summary.startsWith("Imported 1 DJs")),
  );
  assert.ok(
    activity.activity.some((e) => e.summary.startsWith("Restored state:")),
  );
  assert.ok(
    activity.activity.some((e) => e.summary.startsWith("Commented on")),
  );
  assert.ok(!JSON.stringify(activity).includes("Private team note"));
});
test("saved states and restores deduplicate retries; a restore invalidates drafts from before it", async () => {
  const env = environment(),
    initial = await env.STORE.load();
  const draft = command(initial, {
    type: "edit",
    profileId: initial.terms[0].profiles[0].id,
    fields: { genres: "Draft before restore" },
  });
  const save = {
    name: "A collaborative restore point",
    version: initial.version,
    operationId: crypto.randomUUID(),
  };
  const snapshots = await Promise.all([
    request(env, "/api/admin/snapshots", save),
    request(env, "/api/admin/snapshots", save),
  ]);
  assert.deepEqual(
    snapshots.map((r) => r.status),
    [201, 201],
  );
  assert.equal((await env.SNAPSHOT_STORE.load()).snapshots.length, 1);
  const state = await env.STORE.load(),
    id = (await env.SNAPSHOT_STORE.load()).snapshots[0].id;
  const restore = {
    id,
    version: state.version,
    operationId: crypto.randomUUID(),
  };
  assert.equal((await request(env, "/api/admin/restore", restore)).status, 200);
  const repeated = await request(env, "/api/admin/restore", restore);
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).replayed, true);
  assert.equal((await env.STORE.load()).epoch, 1);
  assert.equal((await request(env, "/api/action", draft)).status, 409);
});
