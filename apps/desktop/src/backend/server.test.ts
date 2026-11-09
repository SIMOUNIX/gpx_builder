import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTRPCClient, httpLink } from "@trpc/client";
import { scriptedModel, type Script } from "@gpx-builder/agent/test-util";
import { chatIdOf, type AppRouter } from "@gpx-builder/core/server";
import { createChatStore, createTripStore } from "@gpx-builder/store";
import { startServer } from "./server";

const TOKEN = "test-token";
const ORIGIN = "http://localhost:5173";
const dir = mkdtempSync(join(tmpdir(), "gpx-server-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// The fake model's script is replaced per test.
let script: Script[] = [];
const model = scriptedModel([]);
model.doStream = async (o) => scriptedModel(script).doStream(o);

const stub = (): never => {
  throw new Error("not used");
};
let server: ReturnType<typeof startServer>;
let trpc: ReturnType<typeof createTRPCClient<AppRouter>>;
beforeAll(() => {
  server = startServer({
    token: TOKEN,
    allowedOrigins: [ORIGIN],
    deps: {
      trips: createTripStore({ tripsDir: join(dir, "trips") }),
      chats: createChatStore({ dataDir: join(dir, "data") }),
      geocode: { search: stub },
      routing: {
        capabilities: { maxWaypoints: 50, profiles: [] },
        route: stub,
      },
      model,
    },
  });
  trpc = createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: `${server.url}/api/file`,
        headers: { authorization: `Bearer ${TOKEN}` },
        fetch: (url, init) =>
          fetch(url, {
            ...init,
            headers: { ...(init?.headers as object), origin: ORIGIN },
          }),
      }),
    ],
  });
});
afterAll(() => server.stop());

const call = (path: string, headers: Record<string, string> = {}, init = {}) =>
  fetch(server.url + path, {
    headers: { authorization: `Bearer ${TOKEN}`, origin: ORIGIN, ...headers },
    ...init,
  });

const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  call(
    path,
    { "content-type": "application/json", ...headers },
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

/** The data payloads of an SSE body. */
const chunks = (sse: string) =>
  sse
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map(
      (l) => JSON.parse(l.slice(6)) as { type: string; [k: string]: unknown },
    );

test("ping answers with a token and an allowed origin", async () => {
  const res = await call("/ping");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test("a wrong Host is rejected", async () => {
  // fetch won't let us lie about Host, so speak raw HTTP.
  const port = new URL(server.url).port;
  const s = await Bun.connect({
    hostname: "127.0.0.1",
    port: Number(port),
    socket: {
      data(sock, d) {
        got += d.toString();
        sock.end();
      },
      close() {},
    },
  });
  let got = "";
  s.write(
    `GET /ping HTTP/1.1\r\nHost: evil.example:${port}\r\nAuthorization: Bearer ${TOKEN}\r\nConnection: close\r\n\r\n`,
  );
  await Bun.sleep(100);
  expect(got).toStartWith("HTTP/1.1 403");
});

test("a missing or wrong token is rejected", async () => {
  expect((await call("/ping", { authorization: "" })).status).toBe(401);
  expect((await call("/ping", { authorization: "Bearer nope" })).status).toBe(
    401,
  );
  expect((await call("/ping", { authorization: TOKEN })).status).toBe(401);
});

test("a POST with a missing, null or foreign Origin is rejected", async () => {
  const body = { tripId: "trip_x", text: "hi" };
  for (const origin of [undefined, "null", "http://evil.example"]) {
    const res = await fetch(server.url + "/api/chat", {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        ...(origin && { origin }),
      },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(403);
  }
  // A foreign Origin is refused even on a safe method; a missing one is fine there.
  expect((await call("/ping", { origin: "null" })).status).toBe(403);
  const noOrigin = await fetch(server.url + "/ping", {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  expect(noOrigin.status).toBe(200);
});

test("CORS: preflight for the allowed origin only, never a wildcard", async () => {
  const ok = await fetch(server.url + "/api/chat", {
    method: "OPTIONS",
    headers: { origin: ORIGIN },
  });
  expect(ok.status).toBe(204);
  expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  const bad = await fetch(server.url + "/api/chat", {
    method: "OPTIONS",
    headers: { origin: "http://evil.example" },
  });
  expect(bad.status).toBe(403);
  expect(bad.headers.get("access-control-allow-origin")).toBeNull();
});

test("tRPC: create, get, list (newest first), route, export, chat messages", async () => {
  const a = await trpc.trips.create.mutate();
  expect(a.name).toBe("Untitled trip");
  expect(a.chatId).toBe(chatIdOf(a.tripId));
  await Bun.sleep(5);
  const b = await trpc.trips.create.mutate();

  expect((await trpc.trips.get.query({ tripId: a.tripId })).tripId).toBe(
    a.tripId,
  );
  const listed = await trpc.trips.list.query();
  expect(listed.map((t) => t.tripId)).toEqual([b.tripId, a.tripId]);

  expect(await trpc.trips.route.query({ tripId: a.tripId })).toEqual([]);
  expect(await trpc.trips.export.mutate({ tripId: a.tripId })).toEqual([]);
  expect(await trpc.chats.messages.query({ tripId: a.tripId })).toEqual([]);

  const missing =
    "trip_00000000-0000-4000-8000-000000000000" as typeof a.tripId;
  await expect(trpc.trips.get.query({ tripId: missing })).rejects.toMatchObject(
    {
      data: { code: "NOT_FOUND" },
    },
  );
});

test("/api/chat streams text, then an ask_user resumes on the next call", async () => {
  const { tripId } = await trpc.trips.create.mutate();

  script = [
    {
      text: "Let me ask.",
      calls: [{ name: "ask_user", input: { question: "How many days?" } }],
    },
  ];
  const first = await post("/api/chat", { tripId, text: "plan a hike" });
  expect(first.status).toBe(200);
  expect(first.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  const c1 = chunks(await first.text());
  const text = c1.filter((c) => c.type === "text-delta").map((c) => c.delta);
  expect(text.join("")).toBe("Let me ask.");
  expect(c1.map((c) => c.type)).toContain("tool-input-available");
  expect(c1.at(-2)).toMatchObject({
    type: "data-pending",
    data: { tool: "ask_user", question: "How many days?" },
  });

  script = [{ text: "Two days then." }];
  const second = await post("/api/chat", { tripId, text: "2" });
  const c2 = chunks(await second.text());
  expect(c2.some((c) => c.type === "data-pending")).toBe(false);
  expect(c2.filter((c) => c.type === "text-delta").map((c) => c.delta)).toEqual(
    ["Two days then."],
  );

  // The answer became the ask_user result, not a second user message.
  const roles = (await trpc.chats.messages.query({ tripId })).map(
    (m) => m.role,
  );
  expect(roles).toEqual(["user", "assistant", "tool", "assistant"]);
});

test("/api/chat refuses bad bodies, unknown trips and a second concurrent turn", async () => {
  expect((await post("/api/chat", { nope: 1 })).status).toBe(400);
  const ghost = "trip_00000000-0000-4000-8000-000000000000";
  expect((await post("/api/chat", { tripId: ghost, text: "hi" })).status).toBe(
    404,
  );
  const get = await call("/api/chat");
  expect(get.status).toBe(405);

  const { tripId } = await trpc.trips.create.mutate();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const slow = scriptedModel([{ text: "slow" }]);
  const real = model.doStream;
  model.doStream = async (o) => {
    await gate;
    return slow.doStream(o);
  };
  const running = post("/api/chat", { tripId, text: "go" });
  await Bun.sleep(50);
  expect((await post("/api/chat", { tripId, text: "again" })).status).toBe(409);
  release();
  expect((await running).status).toBe(200);
  model.doStream = real;
});

test("/api/chat reports a model failure as an error chunk", async () => {
  const { tripId } = await trpc.trips.create.mutate();
  script = [{ fail: "529 overloaded" }];
  const res = await post("/api/chat", { tripId, text: "hi" });
  const c = chunks(await res.text());
  expect(c.find((x) => x.type === "error")).toMatchObject({
    errorText: expect.stringContaining("529 overloaded"),
  });
});
