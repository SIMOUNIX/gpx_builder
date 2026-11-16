import { expect, test } from "bun:test";
import {
  RouteId,
  StageId,
  Trip,
  WaypointId,
  mintTripId,
} from "../browser/index";
import { applyRoutedStage } from "./apply-routed-stage";

const a = WaypointId.parse("wp_aaaaaaaa");
const b = WaypointId.parse("wp_bbbbbbbb");
const s1 = StageId.parse("stage_1_aaaaaaaa");
const s2 = StageId.parse("stage_2_bbbbbbbb");
const routeId = RouteId.parse("route_0123456789abcdef");

const trip = Trip.parse({
  v: 1,
  tripId: mintTripId(),
  name: "t",
  createdAt: "2026-10-28T10:00:00.000Z",
  updatedAt: "2026-10-28T10:00:00.000Z",
  brief: {},
  stages: [
    { id: s1, from: a, to: b, via: [] },
    { id: s2, from: b, to: a, via: [] },
  ],
  waypoints: {},
  registry: { places: {}, pois: {} },
});

// ~1112 m along a meridian, climbing 10 m
const routed = {
  line: [
    [2, 48, 100],
    [2, 48.01, 110],
  ] as [number, number, number][],
  distanceM: 9999, // the router's figure must be ignored
  snapDistancesM: [3, 120],
};

test("sets route id, stats from our own geometry, and snap distances on one stage", () => {
  const out = applyRoutedStage(trip, s1, routed, routeId);
  expect(out.stages[0]).toMatchObject({
    routeId,
    stats: { km: 1.11, gainM: 10, lossM: 0, walkingMin: 18 },
    snapDistancesM: [3, 120],
  });
  expect(out.stages[1]).toEqual(trip.stages[1]!);
});

test("does not mutate the input trip", () => {
  const before = structuredClone(trip);
  applyRoutedStage(trip, s1, routed, routeId);
  expect(trip).toEqual(before);
});

test("an unknown stage throws", () => {
  expect(() =>
    applyRoutedStage(trip, StageId.parse("stage_9_cccccccc"), routed, routeId),
  ).toThrow("unknown stage");
});
