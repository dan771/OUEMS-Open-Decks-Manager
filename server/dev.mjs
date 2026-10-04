import http from "node:http";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleApi, importAll } from "./api.js";
import { demoState } from "./demo.js";
import { emptySecurity } from "./auth.js";
import { guardPage, securityHeaders } from "./access.js";
import { WebSocketServer } from "ws";
import { CollaborationHub, authorizeLive } from "./realtime.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const local = path.join(root, ".local");
await mkdir(local, { recursive: true });
const stateName = process.env.LOCAL_STATE_NAME || "state.json";
if (!/^[a-zA-Z0-9._-]+\.json$/.test(stateName))
  throw new Error("Invalid local state filename.");
const filename = path.join(local, stateName);
let current;
try {
  current = JSON.parse(await readFile(filename, "utf8"));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
  current = demoState();
  await writeFile(filename, JSON.stringify(current, null, 2));
}
let queue = Promise.resolve();
async function fileStore(name, initial) {
  const target = path.join(local, name);
  let data;
  try {
    data = JSON.parse(await readFile(target, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    data = initial;
    await writeFile(target, JSON.stringify(data, null, 2));
  }
  let pending = Promise.resolve();
  return {
    load: async () => structuredClone(data),
    save: async (next, expected) => {
      const operation = pending.then(async () => {
        if (data.version !== expected) return false;
        await writeFile(target + ".tmp", JSON.stringify(next, null, 2));
        await rename(target + ".tmp", target);
        data = structuredClone(next);
        return true;
      });
      pending = operation.catch(() => {});
      return operation;
    },
  };
}
const env = {
  LOCAL_DEV: "true",
  AUTH_STORE: await fileStore(`auth-${stateName}`, emptySecurity()),
  SNAPSHOT_STORE: await fileStore(`snapshots-${stateName}`, {
    version: 0,
    snapshots: [],
  }),
  GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
  STORE: {
    load: async () => structuredClone(current),
    save: async (next, expected) => {
      const operation = queue.then(async () => {
        if (current.version !== expected) return false;
        await writeFile(filename + ".tmp", JSON.stringify(next, null, 2));
        await rename(filename + ".tmp", filename);
        current = structuredClone(next);
        return true;
      });
      queue = operation.catch(() => {});
      return operation;
    },
  },
};
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      const origin = `http://${req.headers.host}`;
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2_000_000) {
          res.writeHead(413);
          res.end();
          return;
        }
        chunks.push(chunk);
      }
      const request = new Request(new URL(req.url, origin), {
        method: req.method,
        headers: req.headers,
        body:
          req.method === "GET" || req.method === "HEAD"
            ? undefined
            : Buffer.concat(chunks),
      });
      const response = securityHeaders(await handleApi(request, env, {}));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const request = new Request(
      new URL(req.url, `http://${req.headers.host}`),
      { method: req.method, headers: req.headers },
    );
    const blocked = await guardPage(request, env);
    if (blocked) {
      const response = securityHeaders(blocked);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end();
      return;
    }
    const publicRoot = path.join(root, "public");
    const resource = path.resolve(
      publicRoot,
      "." + decodeURIComponent(url.pathname),
    );
    if (
      !resource.startsWith(publicRoot + path.sep) &&
      resource !== publicRoot
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    let file = resource;
    if (url.pathname === "/") file = path.join(publicRoot, "index.html");
    if (url.pathname === "/login") file = path.join(publicRoot, "login.html");
    try {
      const bytes = await readFile(file);
      const response = securityHeaders(
        new Response(null, {
          headers: {
            "Content-Type":
              mime[path.extname(file)] || "application/octet-stream",
          },
        }),
      );
      res.writeHead(200, Object.fromEntries(response.headers));
      res.end(bytes);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  } catch (e) {
    res.writeHead(500);
    res.end("Local server error");
    console.error(e.message);
  }
});
const sockets = new Set();
const room = new CollaborationHub({ getWebSockets: () => [...sockets] }, env);
env.LIVE = room;
const liveServer = new WebSocketServer({
  noServer: true,
  maxPayload: 2048,
  handleProtocols: (protocols) =>
    protocols.has("ouems-live") ? "ouems-live" : false,
});
server.on("upgrade", async (req, socket, head) => {
  try {
    const request = new Request(
      new URL(req.url, `http://${req.headers.host}`),
      { headers: req.headers },
    );
    if (new URL(request.url).pathname !== "/api/live")
      throw new Error("Unknown live endpoint");
    const identity = await authorizeLive(request, env);
    if (sockets.size >= 1000) throw new Error("Too many connections");
    liveServer.handleUpgrade(req, socket, head, (ws) => {
      let attachment;
      ws.serializeAttachment = (value) => {
        attachment = structuredClone(value);
      };
      ws.deserializeAttachment = () => structuredClone(attachment);
      sockets.add(ws);
      room.attach(ws, identity);
      ws.on("message", (data, binary) =>
        room
          .webSocketMessage(ws, binary ? data : data.toString())
          .catch(() => ws.close(1011, "Reconnect to the board")),
      );
      ws.on("close", (code) => {
        sockets.delete(ws);
        room.webSocketClose(ws, code);
      });
      ws.on("error", () => room.webSocketError(ws));
    });
  } catch (error) {
    socket.end(
      `HTTP/1.1 ${error.status || 400} Rejected\r\nConnection: close\r\n\r\n`,
    );
  }
});
server.listen(Number(process.env.PORT || 8787), "127.0.0.1", () =>
  console.log(
    `OUEMS Open Decks: http://localhost:${process.env.PORT || 8787} (local demo, data in .local/state.json)`,
  ),
);
const timer = setInterval(
  () => importAll(env).catch((e) => console.error("Import failed:", e.message)),
  5 * 60 * 1000,
);
timer.unref();
