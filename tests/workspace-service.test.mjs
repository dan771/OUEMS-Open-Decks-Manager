import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";
import { WorkspaceService } from "../server/workspace-service.js";
import { emptyState } from "../public/lib/domain.js";

test("the public Worker forwards API requests unchanged to the workspace CPU budget", async () => {
  const request = new Request("https://decks.example.invalid/api/auth/login", {
    method: "POST",
    headers: {
      Origin: "https://decks.example.invalid",
      Cookie: "__Host-ouems_session=test",
      "CF-Connecting-IP": "192.0.2.1",
      "X-CSRF-Token": "test-csrf",
    },
    body: '{"username":"test"}',
  });
  const env = {
    WORKSPACE: {
      idFromName: (name) => name,
      get: (id) => ({
        fetch: async (forwarded) => {
          assert.equal(id, "workspace");
          assert.equal(forwarded, request);
          assert.equal(await forwarded.text(), '{"username":"test"}');
          return Response.json({ forwarded: true });
        },
      }),
    },
  };
  const response = await worker.fetch(request, env, {});
  assert.deepEqual(await response.json(), { forwarded: true });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("the workspace service preserves HTTPS, Origin, authentication and CSRF checks", async () => {
  const service = new WorkspaceService({}, {});
  for (const [url, method, headers, expected] of [
    ["http://decks.example.invalid/api/state", "GET", {}, 403],
    ["https://decks.example.invalid/api/state", "GET", {}, 401],
    [
      "https://decks.example.invalid/api/action",
      "POST",
      { Origin: "https://other.example.invalid" },
      403,
    ],
    [
      "https://decks.example.invalid/api/action",
      "POST",
      { Origin: "https://decks.example.invalid" },
      401,
    ],
    ["https://decks.example.invalid/scheduled", "POST", {}, 404],
    [
      "https://decks.example.invalid/api/scheduled",
      "POST",
      { Origin: "https://decks.example.invalid" },
      401,
    ],
  ]) {
    assert.equal(
      (await service.fetch(new Request(url, { method, headers }))).status,
      expected,
    );
  }
});

test("live upgrades stay outside the workspace service and still require a session", async () => {
  const env = {
    WORKSPACE: {
      get: () => {
        throw new Error(
          "Must not proxy a live socket through the workspace service",
        );
      },
    },
  };
  const response = await worker.fetch(
    new Request("https://decks.example.invalid/api/live"),
    env,
    {},
  );
  assert.equal(response.status, 401);
});

test("cron uses the internal service and public page routes cannot invoke it", async () => {
  let imports = 0;
  const service = new WorkspaceService(
    {},
    {
      STORE: {
        load: async () => {
          imports++;
          return emptyState();
        },
      },
    },
  );
  let pending;
  const env = {
    WORKSPACE: {
      idFromName: (name) => name,
      get: () => ({
        fetch: (url, init) => service.fetch(new Request(url, init)),
      }),
    },
  };
  await worker.scheduled({}, env, {
    waitUntil: (promise) => {
      pending = promise;
    },
  });
  await pending;
  assert.equal(imports, 1);
  const blocked = await worker.fetch(
    new Request("https://decks.example.invalid/scheduled"),
    env,
    {},
  );
  assert.equal(blocked.status, 303);
  assert.equal(imports, 1);
});
