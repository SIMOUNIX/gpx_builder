import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createOrsRouter, SNAP_RADIUS_M } from "./ors";
import { fakeFetch, json, memoryCache, noWait } from "./helpers.test-util";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"),
  );

const A: [number, number] = [2.7264157, 48.4153298];
const B: [number, number] = [2.7005, 48.4025];

const make = (f: ReturnType<typeof fakeFetch>, cache = memoryCache()) =>
  createOrsRouter({
    apiKey: "test-key",
    cache,
    http: { fetch: f.fn, ...noWait },
  });

test("routes a stage from a real recorded answer", async () => {
  const f = fakeFetch(json(fixture("ors-route-ok")));
  const r = await make(f).route({ waypoints: [A, B], profile: "foot-hiking" });
  if (!r.ok) throw new Error(r.error.message);
  expect(r.value.line).toHaveLength(110);
  expect(r.value.line[0]).toEqual([2.726432, 48.415326, 75]);
  expect(r.value.distanceM).toBe(3074.4);
  // snap = haversine from each input waypoint to its point on the path
  expect(r.value.snapDistancesM).toHaveLength(2);
  expect(r.value.snapDistancesM[0]).toBeGreaterThan(0);
  expect(r.value.snapDistancesM.every((d) => d < 50)).toBe(true);
});

test("sends the key, profile, elevation and snap radius", async () => {
  const f = fakeFetch(json(fixture("ors-route-ok")));
  await make(f).route({ waypoints: [A, B], profile: "foot-walking" });
  const call = f.calls[0]!;
  expect(call.url).toBe(
    "https://api.openrouteservice.org/v2/directions/foot-walking/geojson",
  );
  expect(new Headers(call.init.headers).get("authorization")).toBe("test-key");
  const body = JSON.parse(call.init.body as string);
  expect(body.elevation).toBe(true);
  expect(body.radiuses).toEqual([SNAP_RADIUS_M, SNAP_RADIUS_M]);
  // coordinates are rounded to 6 decimals (about 10 cm)
  expect(body.coordinates).toEqual([
    [2.726416, 48.41533],
    [2.7005, 48.4025],
  ]);
});

test("a point far from any path is not-found (ORS 2010, HTTP 404)", async () => {
  const f = fakeFetch(json(fixture("ors-route-nopoint"), 404));
  const r = await make(f).route({
    waypoints: [A, [-30, 40]],
    profile: "foot-hiking",
  });
  expect(r).toMatchObject({ ok: false, error: { kind: "not-found" } });
  if (!r.ok) expect(r.error.message).toContain("routable point");
});

test("a bad key is unavailable and says to check the key", async () => {
  const f = fakeFetch(json(fixture("ors-route-badkey"), 403));
  const r = await make(f).route({ waypoints: [A, B], profile: "foot-hiking" });
  expect(r).toMatchObject({ ok: false, error: { kind: "unavailable" } });
  if (!r.ok) expect(r.error.message).toContain("ORS_API_KEY");
});

test("error codes 2000-2008 are invalid, 2099 unavailable", async () => {
  const body = (code: number) => ({ error: { code, message: "m" } });
  const f = fakeFetch(json(body(2003), 400), json(body(2099), 500));
  const g = make(f);
  const a = await g.route({ waypoints: [A, B], profile: "foot-hiking" });
  expect(a).toMatchObject({ ok: false, error: { kind: "invalid" } });
  const b = await g.route({ waypoints: [A, B], profile: "foot-hiking" });
  expect(b).toMatchObject({ ok: false, error: { kind: "unavailable" } });
});

test("429 is rate-limit", async () => {
  const f = fakeFetch(json({ error: "Rate limit exceeded" }, 429));
  const r = await make(f).route({ waypoints: [A, B], profile: "foot-hiking" });
  expect(r).toMatchObject({ ok: false, error: { kind: "rate-limit" } });
});

test("refuses bad input without calling the API", async () => {
  const f = fakeFetch();
  const g = make(f);
  const many = Array.from({ length: 51 }, () => A);
  for (const q of [
    { waypoints: [A], profile: "foot-hiking" },
    { waypoints: many, profile: "foot-hiking" },
    { waypoints: [A, B], profile: "driving-car" },
  ]) {
    expect(await g.route(q)).toMatchObject({
      ok: false,
      error: { kind: "invalid" },
    });
  }
  expect(f.calls).toHaveLength(0);
});

test("an answer without matching way_points is unavailable", async () => {
  const bad = fixture("ors-route-ok");
  bad.features[0].properties.way_points = [0];
  const f = fakeFetch(json(bad));
  const r = await make(f).route({ waypoints: [A, B], profile: "foot-hiking" });
  expect(r).toMatchObject({ ok: false, error: { kind: "unavailable" } });
});

test("the same stage is served from the cache the second time", async () => {
  const f = fakeFetch(json(fixture("ors-route-ok")));
  const g = make(f);
  const a = await g.route({ waypoints: [A, B], profile: "foot-hiking" });
  const b = await g.route({ waypoints: [A, B], profile: "foot-hiking" });
  expect(b).toEqual(a);
  expect(f.calls).toHaveLength(1);
});

test("the profile is part of the cache key", async () => {
  const f = fakeFetch(
    json(fixture("ors-route-ok")),
    json(fixture("ors-route-ok")),
  );
  const g = make(f);
  await g.route({ waypoints: [A, B], profile: "foot-hiking" });
  await g.route({ waypoints: [A, B], profile: "foot-walking" });
  expect(f.calls).toHaveLength(2);
});
