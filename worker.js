import { handleApi, importAll } from "./server/api.js";
import { guardPage, securityHeaders } from "./server/access.js";
export { CollaborationHub } from "./server/realtime.js";
export default {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname.startsWith("/api/"))
      return securityHeaders(await handleApi(request, env, ctx));
    const blocked = await guardPage(request, env);
    if (blocked) return securityHeaders(blocked);
    // The asset binding resolves /login to login.html and handles its canonical URL.
    return securityHeaders(await env.ASSETS.fetch(request));
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(importAll(env));
  },
};
