import { scrypt, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt);
export const ROLES = ["administrator", "manager", "viewer"];
export const emptySecurity = () => ({
  version: 0,
  users: [],
  sessions: [],
  attempts: [],
});
const digest = (value) => createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("hex");
const lifetime = 8 * 60 * 60 * 1000;
export const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
export const localRequest = (request, env) =>
  env.LOCAL_DEV === "true" &&
  ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname);
export function secureTransport(request, env) {
  if (new URL(request.url).protocol !== "https:" && !localRequest(request, env))
    throw fail("HTTPS is required.", 403);
}
export const publicUser = ({ id, username, name, role, disabled }) => ({
  id,
  username,
  name,
  role,
  disabled,
});
export function username(value) {
  const name = String(value || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9@._+-]{2,99}$/.test(name))
    throw fail("Use a username of 3–100 letters, numbers or @ . _ + -.");
  return name;
}
export function validatePassword(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 256)
    throw fail("Use a password between 12 and 256 characters.");
  return value;
}
export async function passwordHash(password) {
  validatePassword(password);
  const salt = randomBytes(16).toString("hex");
  // OWASP's 32 MiB scrypt configuration; parameters are fixed server-side.
  const key = await derive(password, salt, 32, {
    N: 32768,
    r: 8,
    p: 3,
    maxmem: 48 * 1024 * 1024,
  });
  return `scrypt$${salt}$${key.toString("hex")}`;
}
async function matches(password, encoded) {
  const [, salt, expected] = (
    encoded || `scrypt$${"0".repeat(32)}$${"0".repeat(64)}`
  ).split("$");
  const key = await derive(password, salt, 32, {
    N: 32768,
    r: 8,
    p: 3,
    maxmem: 48 * 1024 * 1024,
  });
  return timingSafeEqual(key, Buffer.from(expected, "hex"));
}
export async function loadSecurity(env) {
  if (env.AUTH_STORE) return env.AUTH_STORE.load();
  const row = await env.DB.prepare(
    "SELECT version, data FROM app_security WHERE id = 1",
  ).first();
  if (!row)
    throw fail(
      "Apply the authentication database migration before signing in.",
      503,
    );
  return { ...JSON.parse(row.data), version: row.version };
}
export async function mutateSecurity(env, fn) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const data = await loadSecurity(env);
    const expected = data.version;
    const result = await fn(data);
    data.version++;
    const saved = env.AUTH_STORE
      ? await env.AUTH_STORE.save(data, expected)
      : (
          await env.DB.prepare(
            "UPDATE app_security SET version = ?, data = ? WHERE id = 1 AND version = ?",
          )
            .bind(data.version, JSON.stringify(data), expected)
            .run()
        ).meta.changes === 1;
    if (saved) return result;
  }
  throw fail("Another account update is in progress. Please try again.", 409);
}
function cookieName(request, env) {
  return localRequest(request, env) ? "ouems_session" : "__Host-ouems_session";
}
function cookieToken(request, env) {
  return (
    (request.headers.get("Cookie") || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(cookieName(request, env) + "="))
      ?.split("=")[1] || ""
  );
}
export function sessionCookie(request, env, value = "") {
  return `${cookieName(request, env)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${value ? lifetime / 1000 : 0}${localRequest(request, env) ? "" : "; Secure"}`;
}
export async function authenticate(request, env) {
  secureTransport(request, env);
  const raw = cookieToken(request, env);
  if (!/^[a-f0-9]{64}$/.test(raw))
    throw fail("Please sign in to continue.", 401);
  const data = await loadSecurity(env);
  const session = data.sessions.find(
    (s) => s.hash === digest(raw) && s.expires > Date.now(),
  );
  const user =
    session && data.users.find((u) => u.id === session.userId && !u.disabled);
  if (!user) throw fail("Your session has ended. Please sign in again.", 401);
  return { ...publicUser(user), csrf: session.csrf };
}
export function requireRole(user, roles) {
  if (!roles.includes(user.role))
    throw fail("You do not have permission to do this.", 403);
}
export function requireCsrf(request, user) {
  if (request.headers.get("X-CSRF-Token") !== user.csrf)
    throw fail(
      "This session could not verify the request. Refresh and try again.",
      403,
    );
}
async function throttle(request, env, name) {
  const now = Date.now();
  const ip = localRequest(request, env)
    ? "loopback"
    : request.headers.get("CF-Connecting-IP") || "unknown";
  await mutateSecurity(env, (data) => {
    data.attempts = data.attempts.filter((a) => a.expires > now);
    for (const [key, limit] of [
      [digest(`user:${name}`), 5],
      [digest(`ip:${ip}`), 20],
    ]) {
      let bucket = data.attempts.find((a) => a.key === key);
      if (bucket?.count >= limit || data.attempts.length >= 2000)
        throw fail("Too many sign-in attempts. Try again in 15 minutes.", 429);
      if (!bucket)
        data.attempts.push(
          (bucket = { key, count: 0, expires: now + 15 * 60 * 1000 }),
        );
      bucket.count++;
    }
  });
}
export async function signIn(request, env, input, setup = false) {
  const name = username(input.username);
  const password = validatePassword(input.password);
  await throttle(request, env, name);
  if (setup && !localRequest(request, env)) {
    const configured = env.ADMIN_SETUP_TOKEN;
    if (
      !configured ||
      configured.length < 32 ||
      digest(String(input.setupToken || "")) !== digest(configured)
    )
      throw fail("The administrator setup key is invalid.", 403);
  }
  const initial = await loadSecurity(env);
  const existing = initial.users.find((u) => u.username === name);
  if (
    !setup &&
    (!(await matches(password, existing?.password)) ||
      !existing ||
      existing.disabled)
  )
    throw fail("Incorrect username or password.", 401);
  const hash = setup ? await passwordHash(password) : null;
  const raw = token();
  const csrf = token();
  const user = await mutateSecurity(env, (data) => {
    let user = data.users.find((u) => u.username === name);
    if (setup) {
      if (data.users.length)
        throw fail("Administrator setup is already complete.", 409);
      data.users.push(
        (user = {
          id: crypto.randomUUID(),
          username: name,
          name: String(input.name || name)
            .trim()
            .slice(0, 100),
          role: "administrator",
          disabled: false,
          password: hash,
        }),
      );
    } else if (!user || user.disabled || user.password !== existing.password)
      throw fail("The account changed. Sign in again.", 401);
    data.sessions = data.sessions.filter((s) => s.expires > Date.now());
    // Bound retained sessions per user and across the workspace.
    const old = data.sessions.filter((s) => s.userId === user.id).slice(-4);
    data.sessions = data.sessions
      .filter((s) => s.userId !== user.id)
      .concat(old)
      .slice(-195);
    data.sessions.push({
      hash: digest(raw),
      userId: user.id,
      csrf,
      expires: Date.now() + lifetime,
    });
    data.attempts = data.attempts.filter(
      (a) => a.key !== digest(`user:${name}`),
    );
    return publicUser(user);
  });
  return { user, csrf, cookie: sessionCookie(request, env, raw) };
}
export async function signOut(request, env) {
  const hash = digest(cookieToken(request, env));
  await mutateSecurity(env, (data) => {
    data.sessions = data.sessions.filter((s) => s.hash !== hash);
  });
}
export async function manageUser(env, actor, input) {
  const hash = input.password ? await passwordHash(input.password) : null;
  if (!ROLES.includes(input.role))
    throw fail("Choose Administrator, Manager or Viewer.");
  return mutateSecurity(env, (data) => {
    requireRole(
      data.users.find((u) => u.id === actor.id && !u.disabled) || {},
      ["administrator"],
    );
    let user = input.id && data.users.find((u) => u.id === input.id);
    if (input.id && !user) throw fail("Account not found.");
    if (!user) {
      if (!hash) throw fail("A password is required for a new account.");
      if (data.users.length >= 100)
        throw fail("This workspace supports up to 100 accounts.");
      const name = username(input.username);
      if (data.users.some((u) => u.username === name))
        throw fail("That username is already in use.");
      data.users.push(
        (user = { id: crypto.randomUUID(), username: name, disabled: false }),
      );
    }
    if (
      user.role === "administrator" &&
      !user.disabled &&
      (input.role !== "administrator" || input.disabled) &&
      data.users.filter((u) => u.role === "administrator" && !u.disabled)
        .length === 1
    )
      throw fail("Keep at least one active administrator.");
    Object.assign(user, {
      name: String(input.name || user.username)
        .trim()
        .slice(0, 100),
      role: input.role,
      disabled: !!input.disabled,
    });
    if (hash) user.password = hash;
    data.sessions = data.sessions.filter((s) => s.userId !== user.id);
    return publicUser(user);
  });
}
export async function changePassword(env, actor, input) {
  validatePassword(input.currentPassword);
  const initial = (await loadSecurity(env)).users.find(
    (u) => u.id === actor.id,
  );
  if (!initial || !(await matches(input.currentPassword, initial.password)))
    throw fail("The current password is incorrect.", 403);
  const hash = await passwordHash(input.password);
  await mutateSecurity(env, (data) => {
    const user = data.users.find((u) => u.id === actor.id && !u.disabled);
    if (!user || user.password !== initial.password)
      throw fail("The account changed. Sign in again.", 409);
    user.password = hash;
    data.sessions = data.sessions.filter((s) => s.userId !== actor.id);
  });
}
