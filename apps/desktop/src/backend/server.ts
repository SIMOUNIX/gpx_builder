import { createHash, timingSafeEqual } from "node:crypto";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { LanguageModel } from "ai";
import {
  createAppRouter,
  type ChatStorePort,
  type GeocodePort,
  type PoiPort,
  type RoutingPort,
  type TripStorePort,
} from "@gpx-builder/core/server";
import { createChatHandler } from "./api-chat";

export type ServerDeps = {
  trips: TripStorePort;
  chats: ChatStorePort;
  geocode: GeocodePort;
  routing: RoutingPort;
  pois: PoiPort;
  model: LanguageModel;
};

export type ServerOptions = {
  /** Random per launch; required in `Authorization: Bearer` on every request. */
  token: string;
  /** Exact origins of the webview. Anything else (or `null`) is refused. */
  allowedOrigins: string[];
  deps: ServerDeps;
  /** 0 = random free port. */
  port?: number;
};

const deny = (status: number, why: string) =>
  Response.json({ error: why }, { status });

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const digest = (s: string) => createHash("sha256").update(s).digest();
const sameToken = (a: string, b: string) =>
  timingSafeEqual(digest(a), digest(b));

/** Hardened loopback server. Callable from tests; knows nothing of Electrobun. */
export function startServer({
  token,
  allowedOrigins,
  deps,
  port = 0,
}: ServerOptions) {
  if (token.length < 32) throw new Error("token must be at least 32 chars");
  const router = createAppRouter(deps);
  const allowed = new Set(allowedOrigins);
  const chat = createChatHandler(deps);

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    // No Bun error page (it shows source and paths); a throw becomes a bare 500.
    development: false,
    error: () => deny(500, "internal error"),
    maxRequestBodySize: 64 * 1024,
    async fetch(req, srv) {
      // Host: blocks DNS rebinding.
      if (req.headers.get("host") !== `127.0.0.1:${srv.port}`)
        return deny(403, "bad host");

      // Origin: present means allowlisted; absent is fine only for safe methods.
      const origin = req.headers.get("origin");
      if (
        origin === null ? !SAFE_METHODS.has(req.method) : !allowed.has(origin)
      )
        return deny(403, "bad origin");
      const cors: Record<string, string> = origin
        ? { "access-control-allow-origin": origin, vary: "Origin" }
        : {};

      // Preflight carries no Authorization by design; the Origin check above is its gate.
      if (req.method === "OPTIONS")
        return new Response(null, {
          status: 204,
          headers: {
            ...cors,
            "access-control-allow-methods": "GET, POST",
            "access-control-allow-headers": "authorization, content-type",
            "access-control-max-age": "600",
          },
        });

      const auth = req.headers.get("authorization") ?? "";
      if (!auth.startsWith("Bearer ") || !sameToken(auth.slice(7), token))
        return deny(401, "bad token");

      const { pathname } = new URL(req.url);
      let res: Response;
      if (pathname === "/ping") res = Response.json({ ok: true });
      else if (pathname.startsWith("/api/file/"))
        res = await fetchRequestHandler({
          endpoint: "/api/file",
          req,
          router,
          createContext: () => ({}),
        });
      else if (pathname === "/api/chat") res = await chat(req);
      else return deny(404, "not found");

      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      return new Response(res.body, { status: res.status, headers });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  };
}
