import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Position3 } from "@gpx-builder/core/server";
import { createOverpassPois, queryFor, simplify } from "./overpass";
import { fakeFetch, json, noWait } from "./helpers.test-util";

const recorded = JSON.parse(
  readFileSync(
    new URL("./fixtures/overpass-tile.json", import.meta.url),
    "utf8",
  ),
);

// A short walk in the Fontainebleau forest.
const line: Position3[] = [
  [2.6, 48.4, 0],
  [2.601, 48.4005, 0],
];
const MARGIN_M = 200;

const make = (f: ReturnType<typeof fakeFetch>) =>
  createOverpassPois({
    http: { fetch: f.fn, ...noWait },
    endpoint: "https://overpass.test/api",
  });

test("simplify keeps both ends and drops points closer than the spacing", () => {
  // about 11 m between points, 100 m spacing
  const dense: Position3[] = Array.from({ length: 50 }, (_, i) => [
    2.6 + i * 0.00015,
    48.4,
    0,
  ]);
  const out = simplify(dense, 100);
  expect(out[0]).toBe(dense[0]);
  expect(out.at(-1)).toBe(dense.at(-1));
  expect(out.length).toBeLessThan(12);
  expect(simplify(line, 100)).toEqual(line);
});

test("the query is one corridor of the margin around the route", () => {
  const q = queryFor(line, MARGIN_M);
  expect(q).toContain("(around:200,48.40000,2.60000,48.40050,2.60100)");
  expect(q).toContain("timeout:80");
  expect(q).not.toContain("bbox");
});

test("maps nodes, ways and a waterway with its geometry", async () => {
  const r = await make(fakeFetch(json(recorded))).near({
    line,
    marginM: MARGIN_M,
  });
  if (!r.ok) throw new Error(r.error.message);

  expect(r.value).toHaveLength(30);
  const stream = r.value.find((p) => p.tags.waterway === "stream")!;
  expect(String(stream.poiId)).toMatch(/^osm:way\/\d+$/);
  expect(stream.geometry.length).toBeGreaterThan(1);
  const tap = r.value.find((p) => p.tags.amenity === "drinking_water")!;
  expect(tap.geometry).toHaveLength(1);
  const cafeWay = r.value.find(
    (p) => p.tags.amenity === "cafe" && p.poiId.startsWith("osm:way"),
  )!;
  expect(cafeWay.geometry).toHaveLength(1); // its centre
});

test("asks politely: one POST per stage, with a User-Agent", async () => {
  const f = fakeFetch(json(recorded));
  await make(f).near({ line, marginM: MARGIN_M });
  expect(f.calls).toHaveLength(1);
  const init = f.calls[0]!.init;
  expect(init.method).toBe("POST");
  expect((init.headers as Record<string, string>)["User-Agent"]).toBe(
    "gpx-builder",
  );
  expect(String(init.body)).toContain("data=");
});

test("a rate limit is waited out and retried", async () => {
  const waits: number[] = [];
  const f = fakeFetch(json({}, 429, { "retry-after": "7" }), json(recorded));
  const pois = createOverpassPois({
    http: { fetch: f.fn, sleep: async (ms) => void waits.push(ms) },
  });
  expect((await pois.near({ line, marginM: MARGIN_M })).ok).toBe(true);
  expect(waits).toEqual([7000]);
});

test("a server error is retried after 5 s then 15 s, then given up", async () => {
  const waits: number[] = [];
  const f = fakeFetch(json({}, 502), json({}, 502), json({}, 502));
  const pois = createOverpassPois({
    http: { fetch: f.fn, sleep: async (ms) => void waits.push(ms) },
  });
  const r = await pois.near({ line, marginM: MARGIN_M });
  expect(r).toMatchObject({ ok: false, error: { kind: "unavailable" } });
  expect(f.calls).toHaveLength(3);
  expect(waits).toEqual([5000, 15000]);
});

test("a request that takes too long is not retried", async () => {
  const slow = new DOMException("slow", "TimeoutError");
  const f = fakeFetch(slow, json(recorded));
  const r = await make(f).near({ line, marginM: MARGIN_M });
  expect(r).toMatchObject({ ok: false, error: { kind: "timeout" } });
  expect(f.calls).toHaveLength(1);
});

test("Overpass staying busy is an unavailable error, not retried", async () => {
  const f = fakeFetch(
    json({ elements: [], remark: "runtime error: Query timed out" }),
  );
  const r = await make(f).near({ line, marginM: MARGIN_M });
  expect(r).toMatchObject({ ok: false, error: { kind: "unavailable" } });
  expect(f.calls).toHaveLength(1);
});

test("calls are made one at a time", async () => {
  let open = 0;
  let most = 0;
  const pois = createOverpassPois({
    http: {
      fetch: async () => {
        most = Math.max(most, ++open);
        await new Promise((r) => setTimeout(r, 5));
        open--;
        return json({ elements: [] });
      },
    },
  });
  await Promise.all([
    pois.near({ line, marginM: MARGIN_M }),
    pois.near({ line, marginM: MARGIN_M }),
  ]);
  expect(most).toBe(1);
});

test("elements that cannot be read or placed are dropped", async () => {
  const f = fakeFetch(
    json({
      elements: [
        "not an element",
        { type: "node", id: 1, tags: { amenity: "cafe" } }, // no position
        { type: "node", id: 2, lat: 48.4, lon: 2.6, tags: { amenity: "cafe" } },
      ],
    }),
  );
  const r = await make(f).near({ line, marginM: MARGIN_M });
  if (!r.ok) throw new Error(r.error.message);
  expect(r.value.map((p) => String(p.poiId))).toEqual(["osm:node/2"]);
});

test("without an injected sleep the wait really happens", async () => {
  const f = fakeFetch(json({}, 429, { "retry-after": "0" }), json(recorded));
  const pois = createOverpassPois({ http: { fetch: f.fn } });
  expect((await pois.near({ line, marginM: MARGIN_M })).ok).toBe(true);
  expect(f.calls).toHaveLength(2);
});
