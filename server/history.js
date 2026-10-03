import { normalizeProfileFields } from "../public/lib/domain.js";

export const SNAPSHOT_LIMIT = 5;
export const HISTORY_LIMIT = 200;
export function audit(state, author, summary, before = null) {
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
      for (const id of new Set([...a.map((x) => x.id), ...b.map((x) => x.id)]))
        compare(
          a.find((x) => x.id === id),
          b.find((x) => x.id === id),
          `${path}[${id}]`,
        );
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
    summary,
    version: state.version + 1,
    changes,
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
  const row = await env.DB.prepare("SELECT * FROM app_snapshots WHERE id = ?")
    .bind(id)
    .first();
  return row && { id: row.id, name: row.name, data: JSON.parse(row.data) };
}
export async function saveSnapshot(env, state, name, author) {
  name = String(name || "")
    .trim()
    .slice(0, 100);
  if (!name) throw new Error("Give this saved state a name.");
  const snapshot = {
    id: crypto.randomUUID(),
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
  if (new TextEncoder().encode(encoded).byteLength > 1_900_000)
    throw new Error("This saved state exceeds the storage limit.");
  if (env.SNAPSHOT_STORE) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await env.SNAPSHOT_STORE.load();
      const next = {
        version: current.version + 1,
        snapshots: [...current.snapshots, snapshot].slice(-SNAPSHOT_LIMIT),
      };
      if (await env.SNAPSHOT_STORE.save(next, current.version))
        return snapshot.id;
    }
    throw new Error("Another state is being saved. Try again.");
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO app_snapshots (id, created_at, name, author, board_version, data) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(snapshot.id, snapshot.at, name, author, state.version, encoded),
    env.DB.prepare(
      "DELETE FROM app_snapshots WHERE id NOT IN (SELECT id FROM app_snapshots ORDER BY sequence DESC LIMIT ?)",
    ).bind(SNAPSHOT_LIMIT),
  ]);
  return snapshot.id;
}
