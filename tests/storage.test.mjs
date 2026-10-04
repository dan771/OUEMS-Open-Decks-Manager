import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { loadState, saveState, mutate, changesSince } from "../server/store.js";
import { applyChanges } from "../public/lib/collaboration.js";
import { workspace } from "../server/history.js";
import { saveSnapshot, readSnapshot } from "../server/history.js";
import { demoState } from "../server/demo.js";

async function environment(initial = demoState()) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of [
    "0001_initial.sql",
    "0002_auth_history.sql",
    "0003_collaborative_entities.sql",
  ])
    sqlite.exec(
      await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"),
    );
  sqlite
    .prepare("UPDATE app_state SET data = ?, version = ? WHERE id = 1")
    .run(JSON.stringify(initial), initial.version);
  const query = (sql, values = []) => {
    const statement = sqlite.prepare(sql);
    if (/^\s*SELECT/i.test(sql))
      return { results: statement.all(...values), meta: { changes: 0 } };
    const result = statement.run(...values);
    return { results: [], meta: { changes: Number(result.changes) } };
  };
  const prepare = (sql, values = []) => ({
    sql,
    values,
    bind: (...params) => prepare(sql, params),
    first: async () => query(sql, values).results[0] || null,
    all: async () => query(sql, values),
    run: async () => query(sql, values),
  });
  const DB = {
    prepare,
    batch: async (statements) => {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map(({ sql, values }) => query(sql, values));
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { DB, sqlite };
}
test("legacy workspaces migrate atomically; later saves write only changed entities", async () => {
  const initial = demoState(),
    env = await environment(initial);
  try {
    const previous = await loadState(env);
    assert.deepEqual(previous.terms, initial.terms);
    assert.equal(
      await saveState(env, previous, previous.version, previous),
      true,
    );
    const migrated = await loadState(env);
    assert.deepEqual(migrated.terms, initial.terms);
    assert.equal(migrated.storageFormat, 2);
    const next = structuredClone(migrated);
    next.terms[0].profiles[0].genres = "A changed genre";
    assert.equal(await saveState(env, next, migrated.version, migrated), true);
    const rows = env.sqlite
      .prepare("SELECT kind, id FROM workspace_entities WHERE revision = ?")
      .all(migrated.version + 1);
    assert.deepEqual(
      rows.map((row) => ({ ...row })),
      [{ kind: "profile", id: next.terms[0].profiles[0].id }],
    );
    assert.equal(
      (await loadState(env)).terms[0].profiles[0].genres,
      "A changed genre",
    );
  } finally {
    env.sqlite.close();
  }
});
test("a losing SQL commit cannot change the winning commit's entity rows or deletions", async () => {
  const env = await environment();
  try {
    await mutate(env, (state) => {
      state.terms[0].profiles[0].genres = "Initial migration";
    });
    const base = await loadState(env);
    const winner = structuredClone(base),
      loser = structuredClone(base);
    winner.terms[0].profiles[0].name = "Winning name";
    loser.terms[0].profiles[0].name = "Losing name";
    loser.terms[0].instances = [];
    assert.equal(await saveState(env, winner, base.version, base), true);
    assert.equal(await saveState(env, loser, base.version, base), false);
    const stored = await loadState(env);
    assert.equal(stored.terms[0].profiles[0].name, "Winning name");
    assert.equal(
      stored.terms[0].instances.length,
      base.terms[0].instances.length,
    );
  } finally {
    env.sqlite.close();
  }
});
test("incremental reads rebuild exact ordered workspaces and keep viewer private fields absent", async () => {
  const env = await environment();
  try {
    await mutate(env, (state) => {
      state.terms[0].profiles[0].name = "Migrate first";
    });
    const initial = await loadState(env);
    await mutate(env, (state) => {
      state.terms[0].profiles[0].name = "A changed DJ";
      state.terms[0].profiles.reverse();
      state.terms[0].instances.splice(0, 1);
      state.epoch = 1;
    });
    const expected = await loadState(env);
    const admin = { role: "administrator" },
      viewer = { role: "viewer" };
    const patch = await changesSince(env, initial.version, admin);
    assert.ok(patch.entities.length < initial.terms[0].profiles.length);
    assert.deepEqual(
      applyChanges(workspace(initial, admin), patch),
      workspace(expected, admin),
    );
    const privatePatch = await changesSince(env, initial.version, viewer);
    const profile = privatePatch.entities.find(
      (entry) => entry.kind === "profile",
    ).data;
    for (const key of ["fullName", "transcript", "original"])
      assert.equal(profile[key], undefined);
    assert.deepEqual(profile.comments, []);
    assert.deepEqual(
      applyChanges(workspace(initial, viewer), privatePatch),
      workspace(expected, viewer),
    );
    await mutate(env, (state) => {
      state.terms = [];
    });
    const deletion = await changesSince(env, expected.version, admin);
    assert.deepEqual(
      applyChanges(workspace(expected, admin), deletion).terms,
      [],
    );
  } finally {
    env.sqlite.close();
  }
});
test("workspaces and recoverable snapshots can exceed the former total 1.9 MB limit", async () => {
  const env = await environment();
  try {
    const text = "🎧 Live collaboration ".repeat(55_000);
    await mutate(env, (state) => {
      state.terms[0].profiles[0].genres = text;
      state.terms[0].profiles[1].genres = text;
    });
    const state = await loadState(env);
    assert.ok(Buffer.byteLength(JSON.stringify(state)) > 1_900_000);
    const id = await saveSnapshot(env, state, "Large workspace", "Organiser");
    assert.ok(
      env.sqlite
        .prepare("SELECT COUNT(*) AS count FROM app_snapshot_chunks")
        .get().count > 1,
    );
    assert.deepEqual((await readSnapshot(env, id)).data.terms, state.terms);
    for (let index = 0; index < 5; index++)
      await saveSnapshot(
        env,
        { ...state, terms: [] },
        `Small ${index}`,
        "Organiser",
      );
    assert.equal(await readSnapshot(env, id), null);
    assert.equal(
      env.sqlite
        .prepare("SELECT COUNT(*) AS count FROM app_snapshot_chunks")
        .get().count,
      0,
    );
  } finally {
    env.sqlite.close();
  }
});
