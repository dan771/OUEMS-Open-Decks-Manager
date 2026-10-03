import {
  applyAction,
  createTerm,
  discover,
  importRows,
  validateTerm,
} from "../public/lib/domain.js";
import { loadState, mutate } from "./store.js";
import { readSheet } from "./sheets.js";
import {
  authenticate,
  secureTransport,
  localRequest,
  loadSecurity,
  signIn,
  signOut,
  manageUser,
  changePassword,
  publicUser,
  requireRole,
  requireCsrf,
  fail,
  sessionCookie,
} from "./auth.js";
import {
  audit,
  workspace,
  listSnapshots,
  readSnapshot,
  saveSnapshot,
  SNAPSHOT_LIMIT,
  HISTORY_LIMIT,
} from "./history.js";
const json = (data, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
async function body(request, limit = 2_000_000) {
  if (Number(request.headers.get("content-length") || 0) > limit)
    throw fail("Request too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Invalid request.");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw fail("Request too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  try {
    const input = JSON.parse(text);
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error();
    return input;
  } catch {
    throw new Error("Invalid request.");
  }
}
export async function handleApi(request, env, ctx) {
  try {
    secureTransport(request, env);
    const url = new URL(request.url);
    const path = url.pathname;
    if (
      request.method !== "GET" &&
      request.headers.get("Origin") !== url.origin
    )
      return json({ error: "Only requests from this app are accepted." }, 403);
    if (path === "/api/auth/status" && request.method === "GET") {
      const security = await loadSecurity(env);
      return json({
        initialized: !!security.users.length,
        setupAvailable:
          localRequest(request, env) || !!(env.ADMIN_SETUP_TOKEN?.length >= 32),
        setupKeyRequired: !localRequest(request, env),
      });
    }
    if (
      ["/api/auth/login", "/api/auth/setup"].includes(path) &&
      request.method === "POST"
    ) {
      const input = await body(request, 4096);
      const signed = await signIn(request, env, input, path.endsWith("setup"));
      const response = json({ user: signed.user, csrf: signed.csrf });
      response.headers.set("Set-Cookie", signed.cookie);
      return response;
    }
    const user = await authenticate(request, env);
    const author = user.name || user.username;
    if (request.method !== "GET") requireCsrf(request, user);
    if (path === "/api/state" && request.method === "GET")
      return json({
        state: workspace(await loadState(env), user),
        user: publicUser(user),
        csrf: user.csrf,
        local: localRequest(request, env),
        privateSheets: !!env.GOOGLE_SERVICE_ACCOUNT_JSON,
      });
    if (path === "/api/export" && request.method === "GET") {
      requireRole(user, ["administrator"]);
      const response = json(await loadState(env));
      response.headers.set(
        "Content-Disposition",
        'attachment; filename="ouems-open-decks-backup.json"',
      );
      return response;
    }
    if (path === "/api/admin/users" && request.method === "GET") {
      requireRole(user, ["administrator"]);
      return json({ users: (await loadSecurity(env)).users.map(publicUser) });
    }
    if (path === "/api/admin/history" && request.method === "GET") {
      requireRole(user, ["administrator"]);
      return json({
        history: (await loadState(env)).history || [],
        snapshots: await listSnapshots(env),
        limit: SNAPSHOT_LIMIT,
        historyLimit: HISTORY_LIMIT,
      });
    }
    if (request.method !== "POST")
      return json({ error: "Endpoint not found." }, 404);
    const input = await body(request);
    if (path === "/api/auth/logout" || path === "/api/auth/password") {
      if (path.endsWith("password")) await changePassword(env, user, input);
      else await signOut(request, env);
      const response = json({ ok: true });
      response.headers.set("Set-Cookie", sessionCookie(request, env));
      return response;
    }
    if (path.startsWith("/api/admin/")) {
      requireRole(user, ["administrator"]);
      if (path === "/api/admin/users") {
        const account = await manageUser(env, user, input);
        await mutate(env, (state) =>
          audit(
            state,
            author,
            `${input.id ? "Updated" : "Created"} account ${account.username} (${account.role}${account.disabled ? ", disabled" : ""})`,
          ),
        );
        return json({ user: account });
      }
      if (!Number.isInteger(input.version))
        throw new Error("Missing board version. Refresh and try again.");
      const initial = await loadState(env);
      if (initial.version !== input.version)
        throw fail(
          "The board changed. Refresh before saving or restoring a state.",
          409,
        );
      if (path === "/api/admin/snapshots") {
        await saveSnapshot(env, initial, input.name, author);
        const out = await mutate(
          env,
          (state) =>
            audit(
              state,
              author,
              `Saved state: ${String(input.name).slice(0, 100)}`,
            ),
          input.version,
        );
        return json({ ...out, state: workspace(out.state, user) }, 201);
      }
      if (path === "/api/admin/restore") {
        const saved = await readSnapshot(env, input.id);
        if (!saved) throw new Error("Saved state not found.");
        await saveSnapshot(
          env,
          initial,
          `Before restoring ${saved.name}`.slice(0, 100),
          author,
        );
        const out = await mutate(
          env,
          (state) => {
            const before = structuredClone(state.terms);
            state.terms = structuredClone(saved.data.terms);
            audit(state, author, `Restored state: ${saved.name}`, before);
          },
          input.version,
        );
        return json({ ...out, state: workspace(out.state, user) });
      }
      return json({ error: "Endpoint not found." }, 404);
    }
    requireRole(user, ["administrator", "manager"]);
    if (path === "/api/preview") {
      validateTerm(input.code);
      const rows = input.rows || (await readSheet(input.sheetUrl, env));
      if (!Array.isArray(rows) || rows.some((r) => !Array.isArray(r)))
        throw new Error("Invalid response table.");
      return json({
        rows,
        detected: discover(rows, input.code, input.mapping),
      });
    }
    if (path === "/api/terms") {
      const rows = input.rows || (await readSheet(input.sheetUrl, env));
      const term = createTerm(input.code, input.sheetUrl || "", rows, {
        mapping: input.mapping,
        dates: input.dates,
        venue: input.venue,
      });
      const out = await mutate(
        env,
        (state) => {
          if (state.terms.some((t) => t.code === term.code && !t.demo))
            throw new Error(
              "An Open Decks board already exists for this term.",
            );
          state.terms.push(term);
          audit(state, author, `Created Open Decks ${term.code}`);
          return { termId: term.id };
        },
        input.version,
      );
      return json({ ...out, state: workspace(out.state, user) }, 201);
    }
    if (path === "/api/action") {
      if (!Number.isInteger(input.version))
        throw new Error("Missing board version. Refresh and try again.");
      if (["revert", "delete-board"].includes(input.type))
        requireRole(user, ["administrator"]);
      const out = await mutate(
        env,
        async (state) => {
          const before = structuredClone(state.terms);
          const term = state.terms.find((t) => t.id === input.termId);
          const night = term?.nights.find((n) => n.id === input.nightId);
          const destructive = ["delete-night", "delete-board"].includes(
            input.type,
          );
          const previous = destructive ? structuredClone(state) : null;
          const profile = term?.profiles.find(
            (p) =>
              p.id === input.profileId ||
              p.id ===
                term.instances.find((i) => i.id === input.instanceId)
                  ?.profileId,
          );
          applyAction(state, input, author);
          if (destructive)
            await saveSnapshot(
              env,
              previous,
              `Before deleting ${input.type === "delete-board" ? `Open Decks ${term.code}` : `${term.code} night ${night.date} (${night.venue || "Unnamed venue"})`}`.slice(
                0,
                100,
              ),
              author,
            );
          audit(
            state,
            author,
            `${input.type}: ${profile?.name || (night && input.type === "delete-night" ? `${term.code} ${night.date}` : term?.code) || "board"}`,
            before,
          );
        },
        input.version,
      );
      return json({ ...out, state: workspace(out.state, user) });
    }
    if (path === "/api/import") {
      const initial = await loadState(env);
      const term = initial.terms.find((t) => t.id === input.termId);
      if (!term) throw new Error("Board not found.");
      if (!term.sheetUrl && !input.rows)
        throw new Error(
          "This is a local/manual board. Add responses using CSV or the Add DJ button.",
        );
      let rows;
      try {
        rows = input.rows || (await readSheet(term.sheetUrl, env));
      } catch (e) {
        await mutate(env, (state) => {
          state.terms.find((t) => t.id === term.id).importError = e.message;
        });
        throw e;
      }
      const out = await mutate(env, (state) => {
        const result = importRows(
          state.terms.find((t) => t.id === term.id),
          rows,
        );
        if (result.added)
          audit(
            state,
            author,
            `Imported ${result.added} DJs into ${term.code}`,
          );
        return result;
      });
      return json({ ...out, state: workspace(out.state, user) });
    }
    return json({ error: "Endpoint not found." }, 404);
  } catch (e) {
    return json(
      { error: e.message || "Something went wrong." },
      e.status || 400,
    );
  }
}
export async function importAll(env) {
  const initial = await loadState(env);
  for (const term of initial.terms.filter((t) => t.sheetUrl)) {
    try {
      const rows = await readSheet(term.sheetUrl, env);
      await mutate(env, (state) => {
        const result = importRows(
          state.terms.find((t) => t.id === term.id),
          rows,
        );
        if (result.added)
          audit(
            state,
            "Automatic import",
            `Imported ${result.added} DJs into ${term.code}`,
          );
        return result;
      });
    } catch (e) {
      await mutate(env, (state) => {
        const current = state.terms.find((t) => t.id === term.id);
        if (current) current.importError = e.message;
      });
    }
  }
}
