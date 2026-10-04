import assert from "node:assert/strict";
import { sheet, row, headers } from "../tests/fixture.mjs";
const origin = "http://127.0.0.1:8791";
let cookie = "",
  csrf = "";
async function request(path, data) {
  const response = await fetch(origin + path, {
    method: data ? "POST" : "GET",
    headers: {
      Cookie: cookie,
      ...(data
        ? {
            Origin: origin,
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf,
          }
        : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("Set-Cookie"),
  };
}
assert.equal((await request("/api/state")).status, 401);
for (const route of ["/", "/app.js", "/lib/domain.js"]) {
  const anonymous = await fetch(origin + route, { redirect: "manual" });
  assert.equal(anonymous.status, 303);
  assert.equal(anonymous.headers.get("Location"), "/login");
}
assert.equal((await fetch(origin + "/login")).status, 200);
const status = await request("/api/auth/status");
const signed = await request(
  status.data.initialized ? "/api/auth/login" : "/api/auth/setup",
  {
    username: "worker-runtime-check",
    name: "Worker runtime check",
    password: "Local worker test password 2026",
  },
);
assert.equal(signed.status, 200, JSON.stringify(signed.data));
cookie = signed.cookie.split(";")[0];
csrf = signed.data.csrf;
const initial = await request("/api/state");
assert.equal(initial.status, 200);
let out = initial;
let term = initial.data.state.terms.find((t) => t.code === "MT26");
if (!term) {
  out = await request("/api/terms", {
    code: "MT26",
    rows: sheet,
    version: initial.data.state.version,
  });
  assert.equal(out.status, 201);
  term = out.data.state.terms.at(-1);
}
const profile = term.profiles[0];
const edit = {
  type: "edit",
  termId: term.id,
  profileId: profile.id,
  version: out.data.state.version,
  fields: { name: `D1 test DJ ${Date.now()}` },
};
out = await request("/api/action", edit);
assert.equal(out.status, 200);
assert.equal((await request("/api/action", edit)).status, 409);
const reloaded = await request("/api/state");
assert.equal(
  reloaded.data.state.terms.find((t) => t.id === term.id).profiles[0].name,
  edit.fields.name,
);
out = await request("/api/import", { termId: term.id, rows: sheet });
assert.equal(out.data.result.added, 0);
const newer = [...row];
newer[0] = new Date().toISOString();
out = await request("/api/import", {
  termId: term.id,
  rows: [headers, row, newer],
});
assert.equal(out.data.result.added, 1);
out = await request("/api/action", {
  type: "move",
  termId: term.id,
  instanceId: term.instances[0].id,
  nightId: term.nights[0].id,
  period: "early",
  version: out.data.state.version,
});
assert.equal(out.status, 200);
const currentTerm = () => out.data.state.terms.find((t) => t.id === term.id);
out = await request("/api/action", {
  type: "add",
  termId: term.id,
  nightId: term.nights[0].id,
  fields: { name: "Runtime B2B partner" },
  version: out.data.state.version,
});
assert.equal(out.status, 200);
out = await request("/api/action", {
  type: "configure",
  termId: term.id,
  nightId: term.nights[0].id,
  venue: "Runtime Venue",
  start: "23:00",
  end: "02:00",
  setLength: 30,
  autoTime: true,
  version: out.data.state.version,
});
assert.equal(out.status, 200);
const assigned = currentTerm().instances.filter(
  (i) => i.nightId === term.nights[0].id,
);
const sets = [
  { instanceIds: assigned.slice(0, 2).map((i) => i.id), duration: 60 },
  ...assigned.slice(2).map((i) => ({ instanceIds: [i.id], duration: 30 })),
];
out = await request("/api/action", {
  type: "plan",
  termId: term.id,
  nightId: term.nights[0].id,
  sets,
  version: out.data.state.version,
});
assert.equal(out.status, 200);
assert.equal(currentTerm().nights[0].plan[0].instanceIds.length, 2);
const savedName = currentTerm().profiles[0].name;
out = await request("/api/admin/snapshots", {
  name: "Worker restore point",
  version: out.data.state.version,
});
assert.equal(out.status, 201);
const history = await request("/api/admin/history");
assert.equal(history.data.snapshots.length > 0, true);
const snapshot = history.data.snapshots[0];
out = await request("/api/action", {
  ...edit,
  fields: { name: "Transient restore test" },
  version: out.data.state.version,
});
assert.equal(out.status, 200);
out = await request("/api/admin/restore", {
  id: snapshot.id,
  version: out.data.state.version,
});
assert.equal(out.status, 200);
assert.equal(currentTerm().profiles[0].name, savedName);
const scheduled = await fetch(
  origin +
    "/cdn-cgi/local/explorer/api/local/scheduled?worker=ouems-open-decks-local-test",
  {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ cron: "*/5 * * * *" }),
  },
);
const scheduledResult = await scheduled.json();
assert.equal(scheduled.ok, true, JSON.stringify(scheduledResult));
assert.equal(scheduledResult.success, true);
assert.equal(scheduledResult.result.outcome, "ok");
console.log(
  "Cloudflare Worker + local D1 passed: login and scrypt, creation, persistent edits, conflicts, imports, B2B plans, saved states, restore and scheduled handler.",
);
