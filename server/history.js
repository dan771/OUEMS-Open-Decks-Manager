import { normalizeProfileFields } from "../public/lib/domain.js";

export const SNAPSHOT_LIMIT = 5;
export const HISTORY_LIMIT = 200;
export function audit(state, author, summary, before = null, scope = null) {
  const changes = [];
  function compare(a, b, path) {
    if (JSON.stringify(a) === JSON.stringify(b) || changes.length >= 30) return;
    if (
      a &&
      b &&
      typeof a === "object" &&
      typeof b === "object" &&
      !Array.isArray(a) &&
      !Array.isArray(b)
    ) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
        compare(a[key], b[key], `${path}.${key}`);
    } else if (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.every((x) => x?.id) &&
      b.every((x) => x?.id)
    ) {
      const previous = new Map(a.map((x) => [x.id, x]));
      const current = new Map(b.map((x) => [x.id, x]));
      for (const id of new Set([...previous.keys(), ...current.keys()]))
        compare(previous.get(id), current.get(id), `${path}[${id}]`);
    } else {
      const display = (v) =>
        v === undefined ? "(absent)" : JSON.stringify(v).slice(0, 700);
      changes.push({ path, before: display(a), after: display(b) });
    }
  }
  if (before) compare(before, state.terms, "boards");
  state.history ||= [];
  state.history.push({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    author,
    summary: String(summary).slice(0, 500),
    version: state.version + 1,
    changes,
    ...(typeof scope === "string"
      ? { termId: scope }
      : Array.isArray(scope)
        ? { termIds: scope }
        : {}),
  });
  state.history = state.history.slice(-HISTORY_LIMIT);
  // Keep audit data bounded without affecting the working boards.
  while (
    JSON.stringify(state.history).length > 150_000 &&
    state.history.length > 1
  )
    state.history.shift();
}
export function workspace(state, user) {
  const result = normalizeProfileFields(structuredClone(state));
  delete result.history;
  for (const key of ["operations", "storageFormat", "termIds", "commitId"])
    delete result[key];
  if (user.role === "viewer") {
    for (const term of result.terms) {
      // Viewers see the lineup and availability, without private form answers or team notes.
      delete term.sheetUrl;
      delete term.mapping;
      delete term.mappingHeaders;
      delete term.seen;
      delete term.importError;
      delete term.lastImport;
      for (const p of term.profiles) {
        delete p.fullName;
        delete p.original;
        delete p.transcript;
        p.comments = [];
      }
    }
  }
  return result;
}
export async function listSnapshots(env) {
  if (env.SNAPSHOT_STORE)
    return (await env.SNAPSHOT_STORE.load()).snapshots
      .map(({ data, ...info }) => info)
      .reverse();
  const rows = await env.DB.prepare(
    "SELECT id, created_at AS at, name, author, board_version AS version FROM app_snapshots ORDER BY sequence DESC",
  ).all();
  return rows.results;
}
export async function readSnapshot(env, id) {
  if (env.SNAPSHOT_STORE)
    return (await env.SNAPSHOT_STORE.load()).snapshots.find((s) => s.id === id);
  const result = await env.DB.batch([
    env.DB.prepare("SELECT * FROM app_snapshots WHERE id = ?").bind(id),
    env.DB.prepare(
      "SELECT data FROM app_snapshot_chunks WHERE snapshot_id = ? ORDER BY sequence",
    ).bind(id),
  ]);
  const row = result[0].results[0];
  if (!row) return null;
  let data = JSON.parse(row.data);
  if (data.chunked) {
    data = JSON.parse(result[1].results.map((chunk) => chunk.data).join(""));
  }
  return { id: row.id, name: row.name, data };
}
export async function saveSnapshot(
  env,
  state,
  name,
  author,
  id = crypto.randomUUID(),
) {
  name = String(name || "")
    .trim()
    .slice(0, 100);
  if (!name) throw new Error("Give this saved state a name.");
  const snapshot = {
    id,
    at: new Date().toISOString(),
    name,
    author,
    version: state.version,
    data: {
      schemaVersion: state.schemaVersion,
      terms: structuredClone(state.terms),
    },
  };
  const encoded = JSON.stringify(snapshot.data);
  if (env.SNAPSHOT_STORE) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await env.SNAPSHOT_STORE.load();
      if (current.snapshots.some((entry) => entry.id === snapshot.id))
        return snapshot.id;
      const next = {
        version: current.version + 1,
        snapshots: [...current.snapshots, snapshot].slice(-SNAPSHOT_LIMIT),
      };
      if (await env.SNAPSHOT_STORE.save(next, current.version))
        return snapshot.id;
    }
    throw new Error("Another state is being saved. Try again.");
  }
  const chunked = new TextEncoder().encode(encoded).byteLength > 1_800_000;
  const inserts = [];
  if (chunked) {
    for (let start = 0, sequence = 0; start < encoded.length; sequence++) {
      let end = Math.min(start + 400_000, encoded.length);
      if (end < encoded.length && /[\uD800-\uDBFF]/.test(encoded[end - 1]))
        end--;
      inserts.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO app_snapshot_chunks (snapshot_id, sequence, data) VALUES (?, ?, ?)",
        ).bind(snapshot.id, sequence, encoded.slice(start, end)),
      );
      start = end;
    }
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO app_snapshots (id, created_at, name, author, board_version, data) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(
      snapshot.id,
      snapshot.at,
      name,
      author,
      state.version,
      chunked ? '{"chunked":true}' : encoded,
    ),
    ...inserts,
    env.DB.prepare(
      "DELETE FROM app_snapshots WHERE id NOT IN (SELECT id FROM app_snapshots ORDER BY sequence DESC LIMIT ?)",
    ).bind(SNAPSHOT_LIMIT),
  ]);
  return snapshot.id;
}
