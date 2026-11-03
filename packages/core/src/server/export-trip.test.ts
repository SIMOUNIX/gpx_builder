import { expect, test } from "bun:test";
import {
  RouteId,
  StageId,
  Trip,
  WaypointId,
  err,
  mintTripId,
  ok,
  type Position3,
} from "../browser/index";
import { exportTrip } from "./export-trip";
import type { TripStorePort } from "./ports";

const a = WaypointId.parse("wp_aaaaaaaa");
const r1 = RouteId.parse("route_1111111111111111");
const r2 = RouteId.parse("route_2222222222222222");
const line: Position3[] = [
  [2.7, 48.4, 100],
  [2.71, 48.41, 110],
];

const stage = (n: number, routeId?: RouteId) => ({
  id: StageId.parse(`stage_${n}_aaaaaaaa`),
  from: a,
  to: a,
  via: [],
  routeId,
});
const mkTrip = (stages: ReturnType<typeof stage>[]) =>
  Trip.parse({
    v: 1,
    tripId: mintTripId(),
    name: "Loop",
    createdAt: "2026-10-28T10:00:00.000Z",
    updatedAt: "2026-10-28T10:00:00.000Z",
    brief: {},
    stages,
    waypoints: {},
    registry: { places: {}, pois: {} },
  });

/** An in-memory store that records what was asked of it. */
function fakeStore(trip: Trip, failRead?: RouteId) {
  const calls = { reads: [] as RouteId[], written: [] as string[][] };
  const unused = () => {
    throw new Error("unused");
  };
  const store: TripStorePort = {
    create: unused,
    save: unused,
    writeRoute: unused,
    load: () => ok(trip),
    readRoute: (_id, routeId) => {
      calls.reads.push(routeId);
      return routeId === failRead
        ? err({ kind: "corrupt", message: "bad route" })
        : ok(line);
    },
    writeDerived: (_id, files) => {
      calls.written.push(Object.keys(files).sort());
      return ok(
        Object.keys(files)
          .sort()
          .map((n) => `/trip/${n}`),
      );
    },
  };
  return { store, calls };
}

test("loads each route once, builds the files, writes them, returns the paths", () => {
  const trip = mkTrip([stage(1, r1), stage(2, r1), stage(3, r2)]);
  const { store, calls } = fakeStore(trip);
  const r = exportTrip(store, trip.tripId);
  expect(calls.reads).toEqual([r1, r2]); // r1 shared by two stages, read once
  expect(calls.written).toEqual([
    ["day-1.gpx", "day-2.gpx", "day-3.gpx", "route-merged.gpx", "route.gpx"],
  ]);
  expect(r.ok && r.value).toEqual([
    "/trip/day-1.gpx",
    "/trip/day-2.gpx",
    "/trip/day-3.gpx",
    "/trip/route-merged.gpx",
    "/trip/route.gpx",
  ]);
});

test("a trip with no routed stage writes nothing and returns no paths", () => {
  const trip = mkTrip([stage(1)]);
  const { store, calls } = fakeStore(trip);
  expect(exportTrip(store, trip.tripId)).toEqual({ ok: true, value: [] });
  expect(calls.written).toEqual([]);
});

test("a failed route read is returned and nothing is written", () => {
  const trip = mkTrip([stage(1, r1), stage(2, r2)]);
  const { store, calls } = fakeStore(trip, r2);
  const r = exportTrip(store, trip.tripId);
  expect(r.ok).toBe(false);
  expect(!r.ok && r.error.kind).toBe("corrupt");
  expect(calls.written).toEqual([]);
});

test("a failed load is returned as is", () => {
  const trip = mkTrip([stage(1, r1)]);
  const { store } = fakeStore(trip);
  store.load = () => err({ kind: "not-found", message: "no trip" });
  const r = exportTrip(store, trip.tripId);
  expect(!r.ok && r.error.kind).toBe("not-found");
});
