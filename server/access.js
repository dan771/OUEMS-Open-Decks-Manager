import { authenticate } from "./auth.js";

const publicPaths = new Set([
  "/login",
  "/login.html",
  "/login.js",
  "/styles.css",
  "/assets/ouems-logo.png",
  "/assets/site-icon.png",
  "/assets/space-grotesk.woff2",
  "/assets/archivo-black.woff2",
]);
export async function guardPage(request, env) {
  const path = new URL(request.url).pathname;
  if (publicPaths.has(path)) return null;
  try {
    await authenticate(request, env);
    return null;
  } catch (e) {
    if (request.method === "GET" || request.method === "HEAD")
      return new Response(null, {
        status: 303,
        headers: { Location: "/login", "Cache-Control": "no-store" },
      });
    return new Response("Sign in required", { status: e.status || 401 });
  }
}
export function securityHeaders(response) {
  if (response.status === 101) return response;
  const secured = new Response(response.body, response);
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    "Strict-Transport-Security": "max-age=31536000",
  };
  for (const [key, value] of Object.entries(headers))
    secured.headers.set(key, value);
  return secured;
}
