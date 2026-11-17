import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Position3 } from "@gpx-builder/core/server";
import { createOverpassPois, tilesAlong } from "./overpass";
import { fakeFetch, json, memoryCache, noWait } from "./helpers.test-util";

const tile = JSON.parse(
  readFileSync(
    new URL("./fixtures/overpass-tile.json", import.meta.url),
    "utf8",
  ),
);
const empty = { elements: [] };

// A short walk in the Fontainebleau forest.
const line: Position3[] = [
  [2.6, 48.4, 0],
  [2.601, 48.4005, 0],
];

const make = (f: ReturnType<typeof fakeFetch>, cache = memoryCache()) =>
  createOverpassPois({
    cache,
    http: { fetch: f.fn, ...noWait },
    endpoint: "https://overpass.test/api",
  });

/** Answers every tile of `line` with the same recorded response. */
const tiles = tilesAlong(line).length;
const answers = (...first: Response[]) => [
  ...first,
  ...Array.from({ length: tiles - first.length }, () => json(empty)),
];

test("a short route needs the tiles around it, a long one needs more", () => {
  expect(tiles).toBe(2);
  const long: Position3[] = [
    [2.6, 48.4, 0],
    [2.8, 48.4, 0], // 15 km east, one straight segment
  ];
  const xs = new Set(tilesAlong(long).map((t) => t.x));
  expect(xs.size).toBeGreaterThanOrEqual(3);
});

test("maps nodes, ways and a waterway with its geometry", async () => {
  const f = fakeFetch(...answers(json(tile)));
  const r = await make(f).near({ line });
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

test("asks politely: one POST per tile, one at a time, with a User-Agent", async () => {
  const f = fakeFetch(...answers(json(tile)));
  await make(f).near({ line });
  expect(f.calls).toHaveLength(tiles);
  for (const c of f.calls) {
    expect(c.init.method).toBe("POST");
    expect((c.init.headers as Record<string, string>)["User-Agent"]).toBe(
      "gpx-builder",
    );
    expect(String(c.init.body)).toContain("data=");
  }
});

test("the second search over the same tiles comes from the cache", async () => {
  const f = fakeFetch(...answers(json(tile)));
  const cache = memoryCache();
  const pois = make(f, cache);
  const a = await pois.near({ line });
  const b = await pois.near({ line });
  expect(b).toEqual(a);
  expect(f.calls).toHaveLength(tiles);
});

test("a rate limit is waited out and retried", async () => {
  const waits: number[] = [];
  const f = fakeFetch(
    json({}, 429, { "retry-after": "7" }),
    ...answers(json(tile)),
  );
  const pois = createOverpassPois({
    cache: memoryCache(),
    http: { fetch: f.fn, sleep: async (ms) => void waits.push(ms) },
  });
  const r = await pois.near({ line });
  expect(r.ok).toBe(true);
  expect(waits).toContain(7000);
});

test("Overpass staying busy is an unavailable error, and nothing is cached", async () => {
  const f = fakeFetch(
    json({ elements: [], remark: "runtime error: Query timed out" }),
  );
  const cache = memoryCache();
  const r = await make(f, cache).near({ line });
  expect(r).toMatchObject({ ok: false, error: { kind: "unavailable" } });
  expect(cache.size()).toBe(0);
});

test("a server error gives an unavailable error", async () => {
  const f = fakeFetch(json({}, 504), json({}, 504), json({}, 504));
  const r = await make(f).near({ line });
  expect(r).toMatchObject({ ok: false, error: { kind: "unavailable" } });
});
