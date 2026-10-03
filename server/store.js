import { emptyState, normalizeProfileFields } from "../public/lib/domain.js";
export async function loadState(env) {
  if (env.STORE) return normalizeProfileFields(await env.STORE.load());
  if (!env.DB) throw new Error("D1 database is not configured.");
  const row = await env.DB.prepare(
    "SELECT version, data FROM app_state WHERE id = 1",
  ).first();
  if (!row)
    throw new Error("Apply the D1 database migration before using the app.");
  return normalizeProfileFields({
    ...JSON.parse(row.data),
    version: row.version,
  });
}
export async function saveState(env, state, expectedVersion) {
  const next = { ...state, version: expectedVersion + 1 };
  const encoded = JSON.stringify(next);
  if (new TextEncoder().encode(encoded).byteLength > 1_900_000)
    throw new Error(
      "This small-workspace storage is full. Export a backup and ask an administrator to archive old terms before adding more data.",
    );
  if (env.STORE) return env.STORE.save(next, expectedVersion);
  const result = await env.DB.prepare(
    "UPDATE app_state SET version = ?, data = ? WHERE id = 1 AND version = ?",
  )
    .bind(next.version, encoded, expectedVersion)
    .run();
  return result.meta.changes === 1;
}
export async function mutate(env, fn, expectedVersion = null) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const state = await loadState(env);
    if (expectedVersion !== null && state.version !== expectedVersion) {
      const e = new Error(
        "The board changed while you were editing. Your changes were not saved. Review the latest board and try again.",
      );
      e.status = 409;
      throw e;
    }
    const result = await fn(state);
    if (await saveState(env, state, state.version))
      return { state: { ...state, version: state.version + 1 }, result };
    if (expectedVersion !== null) break;
  }
  const e = new Error(
    "Another user just saved a change. Refresh and try again.",
  );
  e.status = 409;
  throw e;
}
export { emptyState };
