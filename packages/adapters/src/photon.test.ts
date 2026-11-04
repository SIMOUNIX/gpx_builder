import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PlaceId } from "@gpx-builder/core/server";
import { createPhotonGeocoder } from "./photon";
import { fakeFetch, json, memoryCache, noWait } from "./helpers.test-util";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"),
  );

const make = (f: ReturnType<typeof fakeFetch>, cache = memoryCache()) =>
  createPhotonGeocoder({ cache, http: { fetch: f.fn, ...noWait } });

test("maps a way: id, label and OSM tag", async () => {
  const f = fakeFetch(json(fixture("photon-fontainebleau")));
  const r = await make(f).search({ query: "gare Fontainebleau-Avon" });
  if (!r.ok) throw new Error(r.error.message);
  expect(r.value[0]).toEqual({
    placeId: PlaceId.parse("geo:photon:way/262518389"),
    label: "Gare de Fontainebleau - Avon, Avon, Île-de-France, France",
    kind: "amenity=shelter",
    lngLat: [2.7264157, 48.4153298],
  });
  expect(String(r.value[2]?.placeId)).toBe("geo:photon:node/2681853477");
});

test("works outside France (Nepal, relation, non-latin name)", async () => {
  const f = fakeFetch(json(fixture("photon-kathmandu")));
  const r = await make(f).search({ query: "Kathmandu" });
  if (!r.ok) throw new Error(r.error.message);
  expect(r.value[0]).toMatchObject({
    placeId: PlaceId.parse("geo:photon:relation/12394677"),
    kind: "place=city",
  });
  expect(r.value[0]?.label).toContain("Nepal");
});

test("a peak keeps its natural=peak tag", async () => {
  const f = fakeFetch(json(fixture("photon-fuji")));
  const r = await make(f).search({ query: "Mount Fuji" });
  if (!r.ok) throw new Error(r.error.message);
  expect(r.value[0]?.kind).toBe("natural=peak");
});

test("nearHint becomes lat/lon and the limit is clamped", async () => {
  const f = fakeFetch(json({ features: [] }));
  await make(f).search({ query: "x", nearHint: [2.5, 48.5], limit: 99 });
  const url = new URL(f.calls[0]!.url);
  expect(url.searchParams.get("lat")).toBe("48.5");
  expect(url.searchParams.get("lon")).toBe("2.5");
  expect(url.searchParams.get("limit")).toBe("10");
});

test("empty query is invalid and makes no call", async () => {
  const f = fakeFetch();
  const r = await make(f).search({ query: "   " });
  expect(r).toMatchObject({ ok: false, error: { kind: "invalid" } });
  expect(f.calls).toHaveLength(0);
});

test("no match is an empty list, and unusable features are dropped", async () => {
  const f = fakeFetch(
    json({ features: [] }),
    json({ features: [{ nope: true }] }),
  );
  const g = make(f);
  expect(await g.search({ query: "zzz" })).toEqual({ ok: true, value: [] });
  expect(await g.search({ query: "yyy" })).toEqual({ ok: true, value: [] });
});

test("second identical search comes from the cache", async () => {
  const f = fakeFetch(json(fixture("photon-chamonix")));
  const cache = memoryCache();
  const g = make(f, cache);
  const a = await g.search({ query: "Chamonix" });
  const b = await g.search({ query: " chamonix " });
  expect(b).toEqual(a);
  expect(f.calls).toHaveLength(1);
});

test("errors are not cached", async () => {
  const f = fakeFetch(json({}, 429), json(fixture("photon-chamonix")));
  const cache = memoryCache();
  const g = make(f, cache);
  expect(await g.search({ query: "Chamonix" })).toMatchObject({ ok: false });
  expect(cache.size()).toBe(0);
  expect((await g.search({ query: "Chamonix" })).ok).toBe(true);
});
