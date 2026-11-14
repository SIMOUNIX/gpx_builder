import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTRPCClient, httpLink } from "@trpc/client";
import { scriptedModel, type Script } from "@gpx-builder/agent/test-util";
import {
  chatIdOf,
  mintStageId,
  mintWaypointId,
  PlaceId,
  type GeocodePort,
  type AppRouter,
} from "@gpx-builder/core/server";
import { createChatStore, createTripStore } from "@gpx-builder/store";
import { createChatHandler } from "./api-chat";
import { startServer } from "./server";

const TOKEN = "t".repeat(32);
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
// The fake geocoder's answer is replaced per test.
let geo: GeocodePort["search"] = stub;
const trips = createTripStore({ tripsDir: join(dir, "trips") });
let server: ReturnType<typeof startServer>;
let trpc: ReturnType<typeof createTRPCClient<AppRouter>>;
beforeAll(() => {
  server = startServer({
    token: TOKEN,
    allowedOrigins: [ORIGIN],
    deps: {
      trips,
      chats: createChatStore({ dataDir: join(dir, "data") }),
      geocode: { search: (q) => geo(q) },
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

test("places.search returns the geocoder's candidates", async () => {
  const candidate = {
    placeId: PlaceId.parse("geo:photon:node/1"),
    label: "Chamonix",
    kind: "place=town",
    lngLat: [6.87, 45.92] as [number, number],
  };
  geo = async () => ({ ok: true, value: [candidate] });
  expect(await trpc.places.search.query({ query: " Chamonix " })).toEqual([
    candidate,
  ]);
});

test("places.search fails when the geocoder is unreachable", async () => {
  geo = async () => ({
    ok: false,
    error: { kind: "unavailable", message: "down" },
  });
  await expect(trpc.places.search.query({ query: "x" })).rejects.toThrow(
    "down",
  );
});

test("places.search needs the token", async () => {
  const res = await fetch(`${server.url}/api/file/places.search`, {
    headers: { origin: ORIGIN },
  });
  expect(res.status).toBe(401);
});

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

test("a weak token is refused at startup", () => {
  expect(() =>
    startServer({
      token: "short",
      allowedOrigins: [ORIGIN],
      deps: {} as never,
    }),
  ).toThrow("token");
});

test("errors carry no stack trace", async () => {
  const missing = "trip_00000000-0000-4000-8000-000000000000";
  const input = encodeURIComponent(JSON.stringify({ tripId: missing }));
  const res = await call(`/api/file/trips.get?input=${input}`);
  expect(res.status).toBe(404);
  expect(await res.text()).not.toContain("stack");
});

test("/api/chat rejects whitespace-only text and tells a damaged trip from a missing one", async () => {
  const { tripId } = await trpc.trips.create.mutate();
  expect((await post("/api/chat", { tripId, text: "  \n " })).status).toBe(400);

  // Damage trip.json on disk: not "no such trip", a real server error.
  const folder = readdirSync(join(dir, "trips")).find((f) =>
    f.endsWith(tripId.slice(5, 13)),
  )!;
  writeFileSync(join(dir, "trips", folder, "trip.json"), "{ nope");
  expect((await post("/api/chat", { tripId, text: "hi" })).status).toBe(500);
});

test("/api/chat streams a tool call's verdict", async () => {
  const { tripId } = await trpc.trips.create.mutate();
  // The stub geocoder throws, so the tool reports a failure.
  script = [
    { calls: [{ name: "find_place", input: { query: "Chamonix" } }] },
    { text: "done" },
  ];
  const c = chunks(
    await (await post("/api/chat", { tripId, text: "go" })).text(),
  );
  expect(c.find((x) => x.type === "tool-output-available")).toMatchObject({
    output: { ok: false },
  });
});

test("tRPC: route returns routed stages; export refuses unrouted ones; a corrupt trip is a 500", async () => {
  const { tripId } = await trpc.trips.create.mutate();
  const loaded = trips.load(tripId);
  if (!loaded.ok) throw new Error(loaded.error.message);
  const [from, to] = [mintWaypointId(), mintWaypointId()];
  const wp = (id: typeof from, label: string) => ({
    id,
    kind: "user" as const,
    label,
    lngLat: [6, 45] as [number, number],
  });
  const stage = { id: mintStageId(1), from, to, via: [] };
  const trip = {
    ...loaded.value,
    waypoints: { [from]: wp(from, "A"), [to]: wp(to, "B") },
    stages: [stage],
  };
  trips.save(trip);

  await expect(trpc.trips.export.mutate({ tripId })).rejects.toMatchObject({
    data: { code: "PRECONDITION_FAILED" },
  });

  const line: [number, number, number][] = [
    [6, 45, 1000],
    [6.1, 45.1, 1100],
  ];
  const routed = trips.writeRoute(tripId, line);
  if (!routed.ok) throw new Error(routed.error.message);
  trips.save({ ...trip, stages: [{ ...stage, routeId: routed.value }] });
  expect(await trpc.trips.route.query({ tripId })).toEqual([
    { stageId: stage.id, line },
  ]);

  // Garbage on disk is "broken", not "missing".
  const folder = readdirSync(join(dir, "trips")).find((d) =>
    d.includes(tripId.slice(5, 13)),
  )!;
  writeFileSync(join(dir, "trips", folder, "trip.json"), "{");
  await expect(trpc.trips.get.query({ tripId })).rejects.toMatchObject({
    data: { code: "INTERNAL_SERVER_ERROR" },
  });
  rmSync(join(dir, "trips", folder), { recursive: true });
});

test("a handler that throws becomes a bare 500", async () => {
  const boom = startServer({
    token: TOKEN,
    allowedOrigins: [ORIGIN],
    deps: {
      trips: {
        ...trips,
        load: () => {
          throw new Error("secret path /Users/x");
        },
      },
      chats: createChatStore({ dataDir: join(dir, "data") }),
      geocode: { search: stub },
      routing: {
        capabilities: { maxWaypoints: 50, profiles: [] },
        route: stub,
      },
      model,
    },
  });
  const res = await fetch(boom.url + "/api/chat", {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      origin: ORIGIN,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      tripId: "trip_00000000-0000-4000-8000-000000000000",
      text: "hi",
    }),
  });
  boom.stop();
  expect(res.status).toBe(500);
  expect(await res.text()).not.toContain("secret");
});

const handlerDeps = (over: object = {}) =>
  ({
    trips,
    chats: createChatStore({ dataDir: join(dir, "data") }),
    geocode: { search: stub },
    routing: { capabilities: { maxWaypoints: 50, profiles: [] }, route: stub },
    model,
    ...over,
  }) as never;
const chatReq = (tripId: string) =>
  new Request("http://x/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tripId, text: "hi" }),
  });

test("a quiet turn sends keep-alive pings", async () => {
  const { tripId } = await trpc.trips.create.mutate();
  const real = model.doStream;
  model.doStream = async (o) => {
    await Bun.sleep(120);
    return scriptedModel([{ text: "late" }]).doStream(o);
  };
  const res = await createChatHandler(handlerDeps(), 20)(chatReq(tripId));
  const text = await res.text(); // the stream runs while it is read
  model.doStream = real;
  expect(text).toContain("data-ping");
});

test("a store that throws mid-turn ends the stream with a generic error", async () => {
  const { tripId } = await trpc.trips.create.mutate();
  const chats = {
    ...createChatStore({ dataDir: join(dir, "data") }),
    append: () => {
      throw new Error("disk exploded at /Users/x");
    },
  };
  script = [{ text: "hi" }];
  const res = await createChatHandler(handlerDeps({ chats }))(chatReq(tripId));
  const text = await res.text();
  expect(text).toContain("the turn failed");
  expect(text).not.toContain("/Users/x");
});
