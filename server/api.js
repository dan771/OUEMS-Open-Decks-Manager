import {
  applyAction,
  createTerm,
  discover,
  importRows,
  validateTerm,
} from "../public/lib/domain.js";
import { loadState, mutate, stateVersion, changesSince } from "./store.js";
import {
  actionBasis,
  equal,
  conflictFields,
  setIds,
} from "../public/lib/collaboration.js";
import { authorizeLive, publish } from "./realtime.js";
import { createHash } from "node:crypto";
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
function actionSummary(action, profile, night, term) {
  const name = profile?.name || "DJ";
  const destination = night
    ? `${night.date}${action.period ? ` (${action.period === "late" ? "Late" : "Early"})` : ""}`
    : "Unassigned";
  switch (action.type) {
    case "move":
      return `Moved ${name} to ${destination}`;
    case "confirm":
      return `${action.confirmed ? "Confirmed" : "Cleared confirmation for"} ${name}`;
    case "edit":
      return `Updated ${name}`;
    case "comment":
      return `Commented on ${name}`;
    case "duplicate":
      return `Duplicated ${name}`;
    case "revert":
      return `Restored initial response for ${name}`;
    case "plan":
      return `Planned sets for ${night?.date}`;
    case "clear-plan":
      return `Cleared set timings for ${night?.date}`;
    case "configure":
      return `Configured ${night?.date}`;
    case "add-night":
      return `Added night ${action.date}`;
    case "add":
      return `Added DJ ${action.fields?.name || ""}`;
    case "delete-night":
      return `Deleted night ${night?.date}`;
    case "delete-board":
      return `Deleted Open Decks ${term?.code}`;
    default:
      return `Updated Open Decks ${term?.code || "board"}`;
  }
}
function mutationOptions(input, user, path) {
  let operation;
  if (input.operationId !== undefined) {
    if (
      typeof input.operationId !== "string" ||
      !/^[a-zA-Z0-9_-]{12,100}$/.test(input.operationId)
    )
      throw new Error("Invalid save identifier.");
    operation = {
      id: input.operationId,
      userId: user.id,
      fingerprint: createHash("sha256")
        .update(JSON.stringify({ path, input }))
        .digest("hex"),
    };
  }
  const independent = input.base && path === "/api/action";
  return {
    operation,
    expectedVersion:
      (independent && !["delete-board", "delete-night"].includes(input.type)) ||
      (operation && path === "/api/terms")
        ? null
        : (input.version ?? null),
    check: independent
      ? (state) => {
          const current = actionBasis(state, input);
          if (!equal(input.base, current)) {
            const error = fail(
              "The board changed in the same fields or placement you edited. Your draft is safe. Review the conflicting changes before saving.",
              409,
            );
            error.conflicts = conflictFields(input.base, current);
            throw error;
          }
        }
      : undefined,
  };
}
function appendResponses(term, rows) {
  if (!term)
    throw new Error(
      "The board was removed while responses were being checked.",
    );
  const lastImport = term.lastImport;
  const result = importRows(term, rows);
  if (!result.added) term.lastImport = lastImport;
  return result;
}
function snapshotId(user, input, purpose) {
  return input.operationId
    ? createHash("sha256")
        .update(`${user.id}:${input.operationId}:${purpose}`)
        .digest("hex")
    : undefined;
}
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
    if (path === "/api/live" && request.method === "GET") {
      if (!env.COLLABORATION)
        return json(
          {
            error:
              "Live updates are unavailable; the board will keep checking for changes.",
          },
          503,
        );
      const identity = await authorizeLive(request, env);
      const headers = new Headers(request.headers);
      headers.set("X-Live-Identity", JSON.stringify(identity));
      return env.COLLABORATION.get(
        env.COLLABORATION.idFromName("workspace"),
      ).fetch(new Request(request.url, { headers }));
    }
    if (path === "/api/activity" && request.method === "GET") {
      const state = await loadState(env);
      return json({
        activity: (state.history || [])
          .filter(
            (entry) =>
              entry.termId === url.searchParams.get("termId") ||
              entry.termIds?.includes(url.searchParams.get("termId")),
          )
          .slice(-60)
          .reverse()
          .map(({ id, at, author, summary, version }) => ({
            id,
            at,
            author,
            summary,
            version,
          })),
      });
    }
    if (path === "/api/state" && request.method === "GET") {
      const metadata = {
        user: publicUser(user),
        csrf: user.csrf,
        local: localRequest(request, env),
        privateSheets: !!env.GOOGLE_SERVICE_ACCOUNT_JSON,
      };
      if (
        url.searchParams.get("since") !== null &&
        url.searchParams.get("role") === user.role &&
        Number(url.searchParams.get("since")) === (await stateVersion(env))
      )
        return json({
          ...metadata,
          unchanged: true,
          version: Number(url.searchParams.get("since")),
        });
      if (
        url.searchParams.get("role") === user.role &&
        url.searchParams.has("since")
      ) {
        const patch = await changesSince(
          env,
          Number(url.searchParams.get("since")),
          user,
        );
        if (patch) return json({ ...metadata, patch });
      }
      return json({
        state: workspace(await loadState(env), user),
        ...metadata,
      });
    }
    if (path === "/api/export" && request.method === "GET") {
      requireRole(user, ["administrator"]);
      const exported = await loadState(env);
      for (const key of ["storageFormat", "termIds", "commitId", "operations"])
        delete exported[key];
      const response = json(exported);
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
      await publish(
        env,
        path.endsWith("password")
          ? { type: "revoke", userId: user.id }
          : { type: "revoke", sessionHash: user.sessionHash },
      );
      const response = json({ ok: true });
      response.headers.set("Set-Cookie", sessionCookie(request, env));
      return response;
    }
    if (path.startsWith("/api/admin/")) {
      requireRole(user, ["administrator"]);
      if (path === "/api/admin/users") {
        const account = await manageUser(env, user, input);
        await publish(env, { type: "revoke", userId: account.id });
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
      const options = mutationOptions(input, user, path);
      const receipt =
        options.operation &&
        initial.operations?.find(
          (entry) =>
            entry.id === options.operation.id && entry.userId === user.id,
        );
      if (receipt) {
        if (receipt.fingerprint !== options.operation.fingerprint)
          throw fail(
            "This save identifier was already used for a different change.",
            409,
          );
        return json(
          {
            state: workspace(initial, user),
            result: receipt.result,
            replayed: true,
          },
          path === "/api/admin/snapshots" ? 201 : 200,
        );
      }
      if (initial.version !== input.version)
        throw fail(
          "The board changed. Refresh before saving or restoring a state.",
          409,
        );
      if (path === "/api/admin/snapshots") {
        await saveSnapshot(
          env,
          initial,
          input.name,
          author,
          snapshotId(user, input, "snapshot"),
        );
        const out = await mutate(
          env,
          (state) =>
            audit(
              state,
              author,
              `Saved state: ${String(input.name).slice(0, 100)}`,
            ),
          options,
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
          snapshotId(user, input, "restore"),
        );
        const out = await mutate(
          env,
          (state) => {
            const before = structuredClone(state.terms);
            state.terms = structuredClone(saved.data.terms);
            state.epoch = (state.epoch || 0) + 1;
            audit(state, author, `Restored state: ${saved.name}`, before, [
              ...new Set([...before, ...state.terms].map((term) => term.id)),
            ]);
          },
          mutationOptions(input, user, path),
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
          audit(
            state,
            author,
            `Created Open Decks ${term.code}`,
            null,
            term.id,
          );
          return { termId: term.id };
        },
        mutationOptions(input, user, path),
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
          applyAction(
            state,
            input,
            author,
            input.operationId ? setIds(user.id, input.operationId) : undefined,
          );
          if (equal(before, state.terms)) return;
          if (destructive)
            await saveSnapshot(
              env,
              previous,
              `Before deleting ${input.type === "delete-board" ? `Open Decks ${term.code}` : `${term.code} night ${night.date} (${night.venue || "Unnamed venue"})`}`.slice(
                0,
                100,
              ),
              author,
              snapshotId(user, input, "deletion"),
            );
          audit(
            state,
            author,
            actionSummary(input, profile, night, term),
            before,
            input.termId,
          );
        },
        mutationOptions(input, user, path),
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
          const current = state.terms.find((t) => t.id === term.id);
          if (current) current.importError = e.message;
        });
        throw e;
      }
      const out = await mutate(env, (state) => {
        const result = appendResponses(
          state.terms.find((t) => t.id === term.id),
          rows,
        );
        if (result.added)
          audit(
            state,
            author,
            `Imported ${result.added} DJs into ${term.code}`,
            null,
            term.id,
          );
        return result;
      });
      return json({ ...out, state: workspace(out.state, user) });
    }
    return json({ error: "Endpoint not found." }, 404);
  } catch (e) {
    return json(
      {
        error: e.message || "Something went wrong.",
        ...(e.conflicts ? { conflicts: e.conflicts } : {}),
      },
      e.status ||
        (/D1_ERROR:.*(?:overloaded|busy|locked)/i.test(e.message || "")
          ? 503
          : 400),
    );
  }
}
export async function importAll(env) {
  const initial = await loadState(env);
  for (const term of initial.terms.filter((t) => t.sheetUrl)) {
    try {
      const rows = await readSheet(term.sheetUrl, env);
      await mutate(env, (state) => {
        const result = appendResponses(
          state.terms.find((t) => t.id === term.id),
          rows,
        );
        if (result.added)
          audit(
            state,
            "Automatic import",
            `Imported ${result.added} DJs into ${term.code}`,
            null,
            term.id,
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
