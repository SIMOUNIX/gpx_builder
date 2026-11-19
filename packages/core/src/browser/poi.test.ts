import { expect, test } from "bun:test";
import type { Position3 } from "./geo";
import { classifyPoi, detourAllowanceM, locateOnRoute } from "./poi";

// 0.1° of longitude at the equator is about 11 119 m.
const route: Position3[] = [
  [0, 0, 0],
  [0.1, 0, 0],
  [0.2, 0, 0],
];

test("detour allowance is 1% of the trip, between 200 m and 2 km", () => {
  expect(detourAllowanceM(5)).toBe(200); // 50 m -> raised to the minimum
  expect(detourAllowanceM(100)).toBe(1000);
  expect(detourAllowanceM(500)).toBe(2000); // 5 km -> capped
});

test("water is split into potable, treatable and unknown", () => {
  expect(classifyPoi({ amenity: "drinking_water" })).toEqual({
    kind: "water",
    tier: "potable",
  });
  expect(classifyPoi({ amenity: "fountain", drinking_water: "yes" })).toEqual({
    kind: "water",
    tier: "potable",
  });
  expect(classifyPoi({ man_made: "water_tap" })).toEqual({
    kind: "water",
    tier: "unknown",
  });
  const natural: Record<string, string>[] = [
    { waterway: "stream" },
    { waterway: "river" },
    { waterway: "waterfall" },
    { natural: "water", water: "lake" },
    { natural: "water", water: "pond" },
    { natural: "spring" },
  ];
  for (const tags of natural) {
    expect(classifyPoi(tags)).toEqual({ kind: "water", tier: "treatable" });
  }
});

test("a source marked undrinkable or seasonal is never potable", () => {
  expect(classifyPoi({ man_made: "water_tap", drinking_water: "no" })).toBe(
    undefined,
  );
  expect(classifyPoi({ amenity: "drinking_water", seasonal: "yes" })).toEqual({
    kind: "water",
    tier: "unknown",
  });
  expect(classifyPoi({ waterway: "stream", drinking_water: "no" })).toEqual({
    kind: "water",
    tier: "treatable",
  });
});

test("food, picnic and resupply kinds", () => {
  const kind = (tags: Record<string, string>) => classifyPoi(tags)?.kind;
  expect(kind({ amenity: "restaurant" })).toBe("food");
  expect(kind({ amenity: "cafe" })).toBe("food");
  expect(kind({ amenity: "fast_food" })).toBe("food");
  expect(kind({ tourism: "picnic_site" })).toBe("picnic");
  expect(kind({ leisure: "picnic_table" })).toBe("picnic");
  expect(kind({ shop: "supermarket" })).toBe("resupply");
  expect(kind({ shop: "convenience" })).toBe("resupply");
  expect(kind({ shop: "bakery" })).toBe("resupply");
  expect(kind({ shop: "jewelry" })).toBe(undefined);
  // a café that also offers drinking water is still food
  expect(kind({ amenity: "cafe", drinking_water: "yes" })).toBe("food");
});

test("a point is located by its distance to the route and km along it", () => {
  // 0.01° north of the middle of the route.
  const r = locateOnRoute([[0.1, 0.01]], route);
  expect(r.distanceM).toBeCloseTo(1112, -1);
  expect(r.alongM).toBeCloseTo(11119, -2);
  expect(r.lngLat[0]).toBeCloseTo(0.1, 9);
  expect(r.lngLat[1]).toBeCloseTo(0.01, 9);
});

test("a waterway is represented by its point closest to the route", () => {
  // Runs north-south, ends 0.005° (556 m) above the route.
  const stream: [number, number][] = [
    [0.05, 0.02],
    [0.05, 0.005],
  ];
  const r = locateOnRoute(stream, route);
  expect(r.distanceM).toBeCloseTo(556, -1);
  expect(r.lngLat[0]).toBeCloseTo(0.05, 9);
  expect(r.lngLat[1]).toBeCloseTo(0.005, 9);
});

test("a waterway the route crosses is at distance 0, even between vertices", () => {
  const stream: [number, number][] = [
    [0.15, 0.01],
    [0.15, -0.01],
  ];
  const r = locateOnRoute(stream, route);
  expect(r.distanceM).toBe(0);
  expect(r.lngLat[0]).toBeCloseTo(0.15, 6);
  expect(r.lngLat[1]).toBeCloseTo(0, 6);
  expect(r.alongM).toBeCloseTo(16679, -2);
});
