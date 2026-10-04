import { handleApi } from "./server/api.js";
import { guardPage, securityHeaders } from "./server/access.js";
export { CollaborationHub } from "./server/realtime.js";
export { WorkspaceService } from "./server/workspace-service.js";
const workspace = (env) =>
  env.WORKSPACE.get(env.WORKSPACE.idFromName("workspace"));
export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    // Upgrade directly into the hibernating hub. Proxying a WebSocket through
    // WorkspaceService would keep that service active for the connection's life.
    if (path === "/api/live")
      return securityHeaders(await handleApi(request, env, ctx));
    if (path.startsWith("/api/"))
      return securityHeaders(await workspace(env).fetch(request));
    const blocked = await guardPage(request, env);
    if (blocked) return securityHeaders(blocked);
    // The asset binding resolves /login to login.html and handles its canonical URL.
    return securityHeaders(await env.ASSETS.fetch(request));
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      workspace(env)
        .fetch("https://workspace.internal/scheduled", { method: "POST" })
        .then((response) => {
          if (!response.ok) throw new Error("Scheduled import failed.");
        }),
    );
  },
};
