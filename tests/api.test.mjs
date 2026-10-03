import test from "node:test";
import assert from "node:assert/strict";
import { handleApi, importAll } from "../server/api.js";
import { readSheet, sheetReference } from "../server/sheets.js";
import { emptyState } from "../public/lib/domain.js";
import { sheet, row, headers } from "./fixture.mjs";
import { emptySecurity, passwordHash } from "../server/auth.js";
import { createHash } from "node:crypto";
const testHash = await passwordHash("Test only password 2026");
const sessionToken = "a".repeat(64);
function setup() {
  let data = emptyState();
  let security = emptySecurity();
  security.users.push({
    id: "admin",
    username: "admin",
    name: "Test administrator",
    role: "administrator",
    disabled: false,
    password: testHash,
  });
  security.sessions.push({
    hash: createHash("sha256").update(sessionToken).digest("hex"),
    userId: "admin",
    csrf: "test-csrf",
    expires: Date.now() + 60000,
  });
  return {
    LOCAL_DEV: "true",
    AUTH_STORE: {
      load: async () => structuredClone(security),
      save: async (next, expected) => {
        if (security.version !== expected) return false;
        security = structuredClone(next);
        return true;
      },
    },
    STORE: {
      load: async () => structuredClone(data),
      save: async (next, expected) => {
        if (data.version !== expected) return false;
        data = structuredClone(next);
        return true;
      },
    },
  };
}
const post = (path, data, origin = "http://localhost") =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: `ouems_session=${sessionToken}`,
      "X-CSRF-Token": "test-csrf",
    },
    body: JSON.stringify(data),
  });
test("production denies unauthenticated access including spoofed identity headers and alternate hosts", async () => {
  const env = setup();
  delete env.LOCAL_DEV;
  for (const url of [
    "http://localhost/api/state",
    "https://test.workers.dev/api/state",
  ]) {
    const r = await handleApi(
      new Request(url, {
        headers: {
          "cf-access-authenticated-user-email": "spoof@example.invalid",
        },
      }),
      env,
      {},
    );
    assert.equal(r.status, url.startsWith("http:") ? 403 : 401);
  }
});
test("localhost also requires login; cross-origin writes denied", async () => {
  const env = setup();
  assert.equal(
    (await handleApi(new Request("https://example.org/api/state"), env, {}))
      .status,
    401,
  );
  assert.equal(
    (
      await handleApi(
        post(
          "/api/terms",
          { code: "MT26", rows: sheet, version: 0 },
          "https://evil.example",
        ),
        env,
        {},
      )
    ).status,
    403,
  );
});
test("create, shared edits, optimistic conflicts and import are durable", async () => {
  const env = setup();
  let response = await handleApi(
    post("/api/terms", { code: "MT26", rows: sheet, version: 0 }),
    env,
    {},
  );
  assert.equal(response.status, 201);
  let out = await response.json();
  const term = out.state.terms[0];
  const id = term.profiles[0].id;
  const edit = {
    type: "edit",
    termId: term.id,
    profileId: id,
    fields: { name: "Changed" },
    version: 1,
  };
  const saves = await Promise.all([
    handleApi(post("/api/action", edit), env, {}),
    handleApi(
      post("/api/action", { ...edit, fields: { name: "Collision" } }),
      env,
      {},
    ),
  ]);
  assert.deepEqual(saves.map((r) => r.status).sort(), [200, 409]);
  const stored = await env.STORE.load();
  assert.equal(stored.terms[0].profiles[0].name, "Changed");
  const extra = [...row];
  extra[0] = "9/29/2026 10:00:00";
  response = await handleApi(
    post("/api/import", { termId: term.id, rows: [headers, row, extra] }),
    env,
    {},
  );
  out = await response.json();
  assert.equal(out.result.added, 1);
  assert.equal(out.state.terms[0].profiles[0].name, "Changed");
  const bad = await handleApi(
    post("/api/action", {
      ...edit,
      version: out.state.version,
      fields: { name: "" },
    }),
    env,
    {},
  );
  assert.equal(bad.status, 400);
  assert.equal((await env.STORE.load()).terms[0].profiles[0].name, "Changed");
});
test("comments use the signed-in account, ignoring external identity claims", async () => {
  const env = setup();
  await handleApi(
    post("/api/terms", { code: "MT26", rows: sheet, version: 0 }),
    env,
    {},
  );
  const state = await env.STORE.load(),
    term = state.terms[0];
  const ctx = {
    access: {
      getIdentity: async () => ({ email: "organiser@example.invalid" }),
    },
  };
  const response = await handleApi(
    post("/api/action", {
      type: "comment",
      termId: term.id,
      profileId: term.profiles[0].id,
      text: "Hello",
      version: state.version,
    }),
    env,
    ctx,
  );
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).state.terms[0].profiles[0].comments[0].author,
    "Test administrator",
  );
});
test("Sheet URLs restrict source hosts and parse tab fragments", () => {
  assert.deepEqual(
    sheetReference(
      "https://docs.google.com/spreadsheets/d/example_id/edit?usp=sharing",
    ),
    { id: "example_id", gid: null },
  );
  assert.deepEqual(
    sheetReference(
      "https://docs.google.com/spreadsheets/d/example_id/edit#gid=42",
    ),
    { id: "example_id", gid: 42 },
  );
  assert.throws(() => sheetReference("https://evil.example/spreadsheets/d/id"));
  assert.throws(() =>
    sheetReference("https://docs.google.com/spreadsheets/d/id/edit?gid=abc"),
  );
});
test("public sheet download rejects login pages and parses CSV", async () => {
  const url = "https://docs.google.com/spreadsheets/d/example_id/edit";
  await assert.rejects(() =>
    readSheet(
      url,
      {},
      async () => new Response("<!doctype html><html>Sign in"),
    ),
  );
  const rows = await readSheet(url, {}, async (source) => {
    assert.equal(source.endsWith("export?format=csv"), true);
    return new Response("Timestamp,Full name\n123,Demo");
  });
  assert.equal(rows[1][1], "Demo");
});
test("cron import failure is visible and never deletes stored cards", async () => {
  const env = setup();
  await handleApi(
    post("/api/terms", {
      code: "MT26",
      rows: sheet,
      sheetUrl: "https://evil.example",
      version: 0,
    }),
    env,
    {},
  );
  await importAll(env);
  const state = await env.STORE.load();
  assert.equal(state.terms[0].instances.length, 1);
  assert.match(state.terms[0].importError, /docs.google.com/);
});
test("private Sheet uses a signed read-only service-account token and the specified tab", async () => {
  const keys = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ["sign", "verify"],
  );
  const der = await crypto.subtle.exportKey("pkcs8", keys.privateKey);
  const private_key = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString("base64")}\n-----END PRIVATE KEY-----`;
  const env = {
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: "test-only@example.invalid",
      private_key,
    }),
  };
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    if (url === "https://oauth2.googleapis.com/token") {
      const assertion = options.body.get("assertion");
      const [header, payload, signature] = assertion.split(".");
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
      assert.equal(
        claims.scope,
        "https://www.googleapis.com/auth/spreadsheets.readonly",
      );
      assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
      assert.equal(
        await crypto.subtle.verify(
          "RSASSA-PKCS1-v1_5",
          keys.publicKey,
          Buffer.from(signature, "base64url"),
          new TextEncoder().encode(`${header}.${payload}`),
        ),
        true,
      );
      return Response.json({ access_token: "test-token", expires_in: 3600 });
    }
    assert.equal(options.headers.Authorization, "Bearer test-token");
    if (url.includes("?fields="))
      return Response.json({
        sheets: [{ properties: { sheetId: 42, title: "Form's responses" } }],
      });
    assert.match(decodeURIComponent(url), /Form''s responses.*A:ZZ/);
    return Response.json({ values: sheet });
  };
  assert.deepEqual(
    await readSheet(
      "https://docs.google.com/spreadsheets/d/example_id/edit#gid=42",
      env,
      fetcher,
    ),
    sheet,
  );
  assert.equal(calls, 3);
});
