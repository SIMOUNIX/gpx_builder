import { expect, test } from "bun:test";
import { gpx } from "@tmcw/togeojson";
import { DOMParser } from "@xmldom/xmldom";
import { buildDerivedFiles } from "./derived";
import type { Position3 } from "./geo";
import { RouteId, StageId, WaypointId, mintTripId } from "./ids";
import { Trip } from "./trip";

const a = WaypointId.parse("wp_aaaaaaaa");
const r1 = RouteId.parse("route_1111111111111111");
const r3 = RouteId.parse("route_3333333333333333");

const stage = (n: number, routeId?: RouteId) => ({
  id: StageId.parse(`stage_${n}_aaaaaaaa`),
  from: a,
  to: a,
  via: [],
  routeId,
});

const trip = Trip.parse({
  v: 1,
  tripId: mintTripId(),
  name: "Loop",
  createdAt: "2026-10-28T10:00:00.000Z",
  updatedAt: "2026-10-28T10:00:00.000Z",
  brief: {},
  stages: [stage(1, r1), stage(2), stage(3, r3)], // day 2 is unrouted
  waypoints: {},
  registry: { places: {}, pois: {} },
});

const day1: Position3[] = [
  [2.7, 48.4, 100],
  [2.71, 48.41, 110],
];
const day3: Position3[] = [
  [2.72, 48.42, 120],
  [2.73, 48.43, 130],
  [2.74, 48.44, 125],
];
const routes = new Map([
  [r1, day1],
  [r3, day3],
]);

type Fc = {
  features: {
    properties: Record<string, unknown> | null;
    geometry: { coordinates: unknown[] };
  }[];
};
const read = (xml: string) =>
  gpx(new DOMParser().parseFromString(xml, "text/xml") as never) as Fc;

test("builds route, merged and one file per routed day, numbered by stage order", () => {
  const files = buildDerivedFiles(trip, routes);
  expect(Object.keys(files).sort()).toEqual([
    "day-1.gpx",
    "day-3.gpx",
    "route-merged.gpx",
    "route.gpx",
  ]);

  const route = read(files["route.gpx"]!);
  expect(route.features.map((f) => f.properties?.name)).toEqual([
    "Day 1",
    "Day 3",
  ]);

  const merged = read(files["route-merged.gpx"]!);
  expect(merged.features).toHaveLength(1);
  expect(merged.features[0]!.geometry.coordinates).toHaveLength(5);

  expect(read(files["day-3.gpx"]!).features[0]!.geometry.coordinates).toEqual(
    day3,
  );
});

test("a trip with no routed stage has no derived files", () => {
  const unrouted = { ...trip, stages: [stage(1)] };
  expect(buildDerivedFiles(unrouted, new Map())).toEqual({});
});

test("missing geometry for a routed stage throws", () => {
  expect(() => buildDerivedFiles(trip, new Map([[r1, day1]]))).toThrow(
    "missing geometry",
  );
});
