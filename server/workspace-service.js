import { handleApi, importAll } from "./api.js";

// SQLite-backed Durable Objects are available on Workers Free with a 30-second
// CPU allowance. Keep scrypt, imports and workspace serialization here rather
// than inside the public Worker's 10 ms CPU budget. D1 remains the data store.
export class WorkspaceService {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.accountQueue = Promise.resolve();
  }

  async fetch(request) {
    const url = new URL(request.url);
    // Only the scheduled Worker calls this internal URL. The public gateway
    // forwards /api/* exclusively, and cannot expose this handler to browsers.
    if (
      url.origin === "https://workspace.internal" &&
      url.pathname === "/scheduled" &&
      request.method === "POST"
    ) {
      await importAll(this.env);
      return new Response(null, { status: 204 });
    }
    if (!url.pathname.startsWith("/api/"))
      return new Response("Not found", { status: 404 });
    // Preserve the original URL, cookies, Origin, CSRF and CF-Connecting-IP so
    // the same authentication and permissions apply after internal forwarding.
    if (
      request.method === "POST" &&
      (url.pathname.startsWith("/api/auth/") ||
        url.pathname === "/api/admin/users")
    ) {
      // Bound scrypt's 32 MiB working memory to one account operation at a time
      // within the 128 MiB isolate, even when all organisers sign in together.
      const response = this.accountQueue.then(() =>
        handleApi(request, this.env, this.ctx),
      );
      this.accountQueue = response.then(
        () => {},
        () => {},
      );
      return response;
    }
    return handleApi(request, this.env, this.ctx);
  }
}
