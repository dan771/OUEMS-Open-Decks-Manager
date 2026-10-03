import { parseCSV } from "../public/lib/domain.js";
export function sheetReference(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Paste a Google Sheets link.");
  }
  const m = url.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:\/|$)/);
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || !m)
    throw new Error("Use a docs.google.com/spreadsheets/d/… link.");
  const gid =
    url.searchParams.get("gid") ||
    new URLSearchParams(url.hash.slice(1)).get("gid");
  if (gid !== null && !/^\d+$/.test(gid))
    throw new Error("Invalid Sheet tab ID.");
  return { id: m[1], gid: gid === null ? null : Number(gid) };
}
const base64url = (data) =>
  btoa(
    typeof data === "string"
      ? data
      : String.fromCharCode(...new Uint8Array(data)),
  )
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
let tokenCache = null;
async function accessToken(secret, fetcher) {
  const account = typeof secret === "string" ? JSON.parse(secret) : secret;
  if (
    tokenCache?.email === account.client_email &&
    tokenCache.exp > Date.now() + 60000
  )
    return tokenCache.token;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const pem = account.private_key.replace(/-----[^-]+-----|\s/g, "");
  const bytes = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    bytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${payload}.${base64url(signature)}`,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      "Google service account authentication failed. Check the server secret.",
    );
  const data = await response.json();
  tokenCache = {
    email: account.client_email,
    token: data.access_token,
    exp: Date.now() + Number(data.expires_in) * 1000,
  };
  return data.access_token;
}
export async function readSheet(url, env = {}, fetcher = fetch) {
  const ref = sheetReference(url);
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const token = await accessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON, fetcher);
    const headers = { Authorization: `Bearer ${token}` };
    const meta = await fetcher(
      `https://sheets.googleapis.com/v4/spreadsheets/${ref.id}?fields=sheets.properties`,
      { headers, signal: AbortSignal.timeout(15000) },
    );
    if (!meta.ok)
      throw new Error(
        "Cannot read this Sheet. Enable the Sheets API and share the Sheet with the service account as Viewer.",
      );
    const data = await meta.json();
    const tab =
      ref.gid === null
        ? data.sheets[0]
        : data.sheets.find((s) => s.properties.sheetId === ref.gid);
    if (!tab)
      throw new Error(
        "That Sheet tab was not found. Check the gid in its link.",
      );
    const range = `'${tab.properties.title.replace(/'/g, "''")}'!A:ZZ`;
    const response = await fetcher(
      `https://sheets.googleapis.com/v4/spreadsheets/${ref.id}/values/${encodeURIComponent(range)}`,
      { headers, signal: AbortSignal.timeout(15000) },
    );
    if (!response.ok)
      throw new Error(
        "Google could not return the response rows. Try again shortly.",
      );
    return (await response.json()).values || [];
  }
  const response = await fetcher(
    `https://docs.google.com/spreadsheets/d/${ref.id}/export?format=csv${ref.gid === null ? "" : `&gid=${ref.gid}`}`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok)
    throw new Error(
      "This Sheet needs private access. Configure the read-only Google service account; keep the Sheet private.",
    );
  const content = await response.text();
  if (/^\s*<!doctype|^\s*<html/i.test(content))
    throw new Error(
      "Google returned a login page. Configure the read-only service account.",
    );
  if (content.length > 2_000_000)
    throw new Error(
      "This Sheet is too large for this small-team app. Use a separate response tab.",
    );
  return parseCSV(content);
}
