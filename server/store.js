import { emptyState, normalizeProfileFields } from "../public/lib/domain.js";
import { publish } from "./realtime.js";
import { workspace } from "./history.js";

function entities(state) {
  const rows = new Map();
  for (const term of state.terms) {
    const { profiles, instances, nights, ...board } = term;
    for (const [kind, values] of [
      [
        "board",
        [
          {
            ...board,
            entityOrder: {
              profiles: profiles.map((p) => p.id),
              instances: instances.map((i) => i.id),
              nights: nights.map((n) => n.id),
            },
          },
        ],
      ],
      ["profile", profiles],
      ["card", instances],
      ["night", nights],
    ])
      for (const value of values)
        rows.set(`${kind}:${value.id}`, {
          kind,
          id: value.id,
          boardId: term.id,
          data: JSON.stringify(value),
        });
  }
  return rows;
}
export async function stateVersion(env) {
  if (env.STORE) return (await env.STORE.load()).version;
  const row = await env.DB.prepare(
    "SELECT version FROM app_state WHERE id = 1",
  ).first();
  if (!row)
    throw new Error("Apply the database migrations before using the app.");
  return row.version;
}
export async function changesSince(env, since, user) {
  if (env.STORE || !Number.isInteger(since) || since < 0) return null;
  const results = await env.DB.batch([
    env.DB.prepare("SELECT version, data FROM app_state WHERE id = 1"),
    env.DB.prepare(
      "SELECT kind, id, board_id, data, deleted FROM workspace_entities WHERE revision > ? ORDER BY rowid",
    ).bind(since),
  ]);
  const row = results[0].results[0];
  const metadata = JSON.parse(row.data);
  if (metadata.storageFormat !== 2 || since > row.version) return null;
  const entities = results[1].results.map((entry) => {
    let data = entry.deleted ? null : JSON.parse(entry.data);
    if (data && user.role === "viewer") {
      const filtered = workspace(
        {
          terms: [
            {
              ...(entry.kind === "board" ? data : {}),
              profiles: entry.kind === "profile" ? [data] : [],
            },
          ],
        },
        user,
      ).terms[0];
      if (entry.kind === "board") {
        const { profiles, ...board } = filtered;
        data = board;
      }
      if (entry.kind === "profile") data = filtered.profiles[0];
    }
    return { kind: entry.kind, id: entry.id, boardId: entry.board_id, data };
  });
  return {
    version: row.version,
    epoch: metadata.epoch || 0,
    termIds: metadata.termIds,
    entities,
  };
}
export async function loadState(env) {
  if (env.STORE) return normalizeProfileFields(await env.STORE.load());
  if (!env.DB) throw new Error("D1 database is not configured.");
  const results = await env.DB.batch([
    env.DB.prepare("SELECT version, data FROM app_state WHERE id = 1"),
    env.DB.prepare(
      "SELECT kind, board_id, data FROM workspace_entities WHERE deleted = 0 ORDER BY rowid",
    ),
  ]);
  const row = results[0].results[0];
  if (!row)
    throw new Error("Apply the D1 database migrations before using the app.");
  const state = { ...JSON.parse(row.data), version: row.version };
  if (state.storageFormat === 2) {
    const boards = new Map();
    for (const entity of results[1].results.filter((e) => e.kind === "board"))
      boards.set(entity.board_id, {
        ...JSON.parse(entity.data),
        profiles: [],
        instances: [],
        nights: [],
      });
    const lists = { profile: "profiles", card: "instances", night: "nights" };
    for (const entity of results[1].results)
      if (lists[entity.kind])
        boards
          .get(entity.board_id)
          ?.[lists[entity.kind]].push(JSON.parse(entity.data));
    state.terms = state.termIds.map((id) => boards.get(id)).filter(Boolean);
    for (const term of state.terms) {
      for (const key of ["profiles", "instances", "nights"]) {
        const order = new Map(
          (term.entityOrder?.[key] || []).map((id, index) => [id, index]),
        );
        term[key].sort(
          (a, b) =>
            (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity),
        );
      }
      delete term.entityOrder;
    }
  }
  return normalizeProfileFields(state);
}
export async function saveState(env, state, expectedVersion, previous = null) {
  const next = { ...state, version: expectedVersion + 1 };
  const rows = entities(next);
  for (const row of rows.values())
    if (new TextEncoder().encode(row.data).byteLength > 1_900_000)
      throw new Error(
        "One DJ or board entry exceeds the storage limit. Shorten its response or notes before saving.",
      );
  if (env.STORE) return env.STORE.save(next, expectedVersion);
  const old = previous?.storageFormat === 2 ? entities(previous) : new Map();
  const changed = [...rows.values()]
    .filter((row) => old.get(`${row.kind}:${row.id}`)?.data !== row.data)
    .map((row) => ({ ...row, deleted: 0 }));
  for (const [key, row] of old)
    if (!rows.has(key)) changed.push({ ...row, data: "null", deleted: 1 });
  const commitId = crypto.randomUUID();
  const { terms, termIds, storageFormat, ...metadata } = next;
  const encoded = JSON.stringify({
    ...metadata,
    storageFormat: 2,
    termIds: terms.map((t) => t.id),
    commitId,
  });
  const statements = [
    env.DB.prepare(
      "UPDATE app_state SET version = ?, data = ? WHERE id = 1 AND version = ?",
    ).bind(next.version, encoded, expectedVersion),
  ];
  // Entity writes are gated by the unique winning commit, inside one atomic batch.
  for (let offset = 0; offset < changed.length; offset += 15) {
    const chunk = changed.slice(offset, offset + 15);
    const values = chunk.map(() => "(?, ?, ?, ?, ?, ?)");
    statements.push(
      env.DB.prepare(
        `WITH incoming(kind, id, board_id, data, revision, deleted) AS (VALUES ${values.join(", ")})
      INSERT INTO workspace_entities (kind, id, board_id, data, revision, deleted)
      SELECT kind, id, board_id, data, revision, deleted FROM incoming
      WHERE EXISTS (SELECT 1 FROM app_state WHERE id = 1 AND json_extract(data, '$.commitId') = ?)
      ON CONFLICT(kind, id) DO UPDATE SET board_id = excluded.board_id, data = excluded.data,
        revision = excluded.revision, deleted = excluded.deleted`,
      ).bind(
        ...chunk.flatMap((row) => [
          row.kind,
          row.id,
          row.boardId,
          row.data,
          next.version,
          row.deleted,
        ]),
        commitId,
      ),
    );
  }
  const results = await env.DB.batch(statements);
  return results[0].meta.changes === 1;
}
export async function mutate(env, fn, options = null) {
  if (typeof options === "number") options = { expectedVersion: options };
  options ||= {};
  const { expectedVersion = null, check, operation } = options;
  for (let attempt = 0; attempt < 32; attempt++) {
    const state = await loadState(env);
    if (operation) {
      const saved = state.operations?.find(
        (o) => o.id === operation.id && o.userId === operation.userId,
      );
      if (saved) {
        if (saved.fingerprint !== operation.fingerprint) {
          const error = new Error(
            "This save identifier was already used for a different change.",
          );
          error.status = 409;
          throw error;
        }
        return { state, result: saved.result, replayed: true };
      }
    }
    if (expectedVersion !== null && state.version !== expectedVersion) {
      const error = new Error(
        "The board changed while you were editing. Your changes were not saved. Review the latest board and try again.",
      );
      error.status = 409;
      throw error;
    }
    check?.(state);
    const previous = structuredClone(state);
    const result = await fn(state);
    if (JSON.stringify(state) === JSON.stringify(previous))
      return { state, result, unchanged: true };
    if (operation)
      state.operations = [
        ...(state.operations || []).filter(
          (o) => o.at > Date.now() - 86_400_000,
        ),
        { ...operation, result: result ?? null, at: Date.now() },
      ].slice(-500);
    if (await saveState(env, state, state.version, previous)) {
      const next = { ...state, version: state.version + 1 };
      await publish(env, { type: "change", version: next.version });
      return { state: next, result };
    }
    if (expectedVersion !== null && !operation) break;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(80, 3 * (attempt + 1)) * Math.random()),
    );
  }
  const error = new Error(
    "Several changes are being saved at once. Your draft is safe; please try again.",
  );
  error.status = 409;
  throw error;
}
export { emptyState };
