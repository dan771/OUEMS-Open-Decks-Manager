import test from "node:test";
import assert from "node:assert/strict";
import { BoardSaveQueue } from "../public/lib/save-queue.js";
import { actionBasis, equal, setIds } from "../public/lib/collaboration.js";
import { applyAction } from "../public/lib/domain.js";
import { demoState } from "../server/demo.js";

function gate() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function fixture() {
  const state = demoState();
  const term = state.terms[0];
  const card = term.instances.find((i) => !i.nightId);
  const night = term.nights[0];
  const receipts = new Map();
  const attempts = [];
  let commits = 0;
  const send = async (payload) => {
    attempts.push(structuredClone(payload));
    if (receipts.has(payload.operationId))
      return { state: structuredClone(state), replayed: true };
    if (!equal(payload.base, actionBasis(state, payload))) {
      const error = new Error("Placement changed");
      error.status = 409;
      throw error;
    }
    applyAction(
      state,
      payload,
      "Organiser",
      setIds("organiser", payload.operationId),
    );
    state.version++;
    commits++;
    receipts.set(payload.operationId, true);
    return { state: structuredClone(state) };
  };
  const move = (extra = {}) => ({
    type: "move",
    termId: term.id,
    instanceId: card.id,
    nightId: night.id,
    slot: null,
    period: "early",
    ...extra,
  });
  const confirm = (confirmed) => ({
    type: "confirm",
    termId: term.id,
    instanceId: card.id,
    confirmed,
  });
  const queue = (options = {}) =>
    new BoardSaveQueue({
      state: structuredClone(state),
      userId: "organiser",
      send,
      persist: () => {},
      onChange: () => {},
      ...options,
    });
  return {
    state,
    term,
    card,
    night,
    move,
    confirm,
    send,
    queue,
    attempts,
    get commits() {
      return commits;
    },
  };
}
function idle(queue) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 1000;
    const poll = () => {
      if (!queue.running) return resolve();
      if (Date.now() >= deadline)
        return reject(new Error("Queue did not settle"));
      setTimeout(poll, 1);
    };
    poll();
  });
}

test("rapid dependent moves and confirmations preview immediately and save in order", async () => {
  const f = fixture(),
    first = gate();
  const queue = f.queue({
    send: async (payload) => {
      await first.promise;
      return f.send(payload);
    },
  });
  const saves = [
    queue.enqueue(f.move()),
    queue.enqueue(f.confirm(true)),
    queue.enqueue(f.move({ period: "late" })),
  ];
  const preview = queue.view.terms[0].instances.find((i) => i.id === f.card.id);
  assert.equal(preview.period, "late");
  assert.equal(preview.confirmed, true);
  assert.equal(queue.entries.length, 3);
  // An independent remote edit must survive all the queued save responses.
  f.term.profiles[0].genres = "Remote genres";
  f.state.version++;
  first.release();
  assert.ok((await Promise.all(saves)).every(Boolean));
  await idle(queue);
  assert.equal(f.commits, 3);
  assert.equal(f.card.period, "late");
  assert.equal(f.card.confirmed, true);
  assert.equal(queue.state.terms[0].profiles[0].genres, "Remote genres");
  assert.equal(queue.entries.length, 0);
});

test("a default drop keeps the half previewed before a concurrent availability edit", async () => {
  const f = fixture(),
    first = gate();
  const profile = f.term.profiles.find((p) => p.id === f.card.profileId);
  profile.availability[f.night.date] = {
    available: true,
    timing: "Second half - 9pm-midnight",
  };
  const queue = f.queue({
    send: async (payload) => {
      await first.promise;
      return f.send(payload);
    },
  });
  const saved = queue.enqueue(f.move({ period: null }));
  assert.equal(queue.entries[0].payload.period, "late");
  profile.availability[f.night.date].timing = "First half - 6-9pm";
  f.state.version++;
  queue.accept(structuredClone(f.state));
  assert.equal(
    queue.view.terms[0].instances.find((i) => i.id === f.card.id).period,
    "late",
  );
  first.release();
  assert.ok(await saved);
  await idle(queue);
  assert.equal(f.card.period, "late");
  assert.equal(profile.availability[f.night.date].timing, "First half - 6-9pm");
});

test("materialised timeline slots use identical IDs for queued dependent moves", async () => {
  const f = fixture(),
    first = gate();
  for (const card of f.term.instances) {
    card.nightId = null;
    card.slot = null;
    card.period = null;
  }
  f.night.plan = [{ id: "initial-slot", instanceIds: [], duration: 30 }];
  const queue = f.queue({
    send: async (payload) => {
      await first.promise;
      return f.send(payload);
    },
  });
  const saves = [
    queue.enqueue(f.move({ slot: 1 })),
    queue.enqueue(f.move({ slot: 2 })),
    queue.enqueue(f.confirm(true)),
  ];
  const expectedIds = queue.view.terms[0].nights[0].plan.map((s) => s.id);
  first.release();
  assert.ok((await Promise.all(saves)).every(Boolean));
  await idle(queue);
  assert.deepEqual(
    f.night.plan.map((s) => s.id),
    expectedIds,
  );
  assert.equal(f.card.slot, 2);
  assert.equal(f.card.confirmed, true);
});

test("conflicting remote placements remain visible until the organiser reviews pending moves", async () => {
  const f = fixture(),
    first = gate();
  const queue = f.queue({
    send: async (payload) => {
      await first.promise;
      return f.send(payload);
    },
  });
  const saved = queue.enqueue(f.move());
  const later = queue.enqueue(f.confirm(true));
  applyAction(
    f.state,
    f.move({ nightId: f.term.nights[1].id, period: "late" }),
  );
  f.state.version++;
  queue.accept(structuredClone(f.state));
  const preview = queue.view.terms[0].instances.find((i) => i.id === f.card.id);
  assert.equal(preview.nightId, f.term.nights[1].id);
  first.release();
  assert.equal(await saved, false);
  await idle(queue);
  assert.equal(queue.error.kind, "conflict");
  assert.equal(queue.entries.length, 2);
  assert.equal(f.commits, 0);
  queue.rebase(structuredClone(f.state));
  assert.ok(await later);
  await idle(queue);
  assert.equal(f.card.nightId, f.night.id);
  assert.equal(f.card.confirmed, true);
});

test("reviewed changes retain the reviewed guards if another edit arrives before applying", async () => {
  const f = fixture();
  const queue = f.queue();
  applyAction(f.state, f.move({ period: "late" }));
  f.state.version++;
  assert.equal(await queue.enqueue(f.move()), false);
  await idle(queue);
  const reviewed = structuredClone(f.state);
  applyAction(f.state, f.move({ nightId: f.term.nights[1].id }));
  f.state.version++;
  queue.accept(structuredClone(f.state));
  queue.rebase(reviewed);
  await idle(queue);
  assert.equal(queue.error.kind, "conflict");
  assert.equal(f.card.nightId, f.term.nights[1].id);
  assert.equal(f.commits, 0);
});

test("a reload after a lost reply retries the original command without repeating its effect", async () => {
  const f = fixture();
  let persisted;
  const queue = f.queue({
    persist: (entries) => {
      persisted = structuredClone(entries);
    },
    send: async (payload) => {
      await f.send(payload);
      throw new Error("Reply lost");
    },
  });
  const saved = queue.enqueue(f.move());
  queue.enqueue(f.confirm(true));
  assert.equal(await saved, false);
  await idle(queue);
  assert.equal(persisted.length, 2);
  const operationId = persisted[0].payload.operationId;
  queue.stop();
  const recovered = f.queue({ restored: persisted });
  assert.equal(recovered.error.kind, "recovered");
  recovered.retry();
  await idle(recovered);
  assert.equal(f.attempts[1].operationId, operationId);
  assert.equal(f.commits, 2);
  assert.equal(f.card.confirmed, true);
  assert.equal(recovered.entries.length, 0);
});

test("older replies cannot replace newer shared data and discard resolves queued callers", async () => {
  const f = fixture(),
    first = gate();
  const queue = f.queue({
    send: async (payload) => {
      const out = await f.send(payload);
      await first.promise;
      return out;
    },
  });
  const saved = queue.enqueue(f.move());
  await Promise.resolve();
  f.term.profiles[0].genres = "Newest shared edit";
  f.state.version++;
  queue.accept(structuredClone(f.state));
  first.release();
  assert.ok(await saved);
  await idle(queue);
  assert.equal(queue.view.terms[0].profiles[0].genres, "Newest shared edit");
  queue.error = { kind: "failed" };
  const pending = queue.enqueue(f.confirm(true));
  queue.discard();
  assert.equal(await pending, false);
  assert.equal(queue.entries.length, 0);
  assert.equal(
    queue.view.terms[0].instances.find((i) => i.id === f.card.id).confirmed,
    false,
  );
  assert.throws(
    () => queue.enqueue({ type: "delete-board" }),
    /cannot be queued/,
  );
});
