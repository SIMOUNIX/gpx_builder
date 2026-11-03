import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gpx } from "@tmcw/togeojson";
import { DOMParser } from "@xmldom/xmldom";
import {
  StageId,
  Trip,
  WaypointId,
  applyRoutedStage,
  exportTrip,
  mintTripId,
  type Position3,
  type Result,
  type StoreError,
} from "@gpx-builder/core/server";
import { createTripStore } from "./trip-store";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gpx-export-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const must = <T>(r: Result<T, StoreError>): T => {
  if (!r.ok) throw new Error(`${r.error.kind}: ${r.error.message}`);
  return r.value;
};
const kind = <T>(r: Result<T, StoreError>) => (r.ok ? "ok" : r.error.kind);

const a = WaypointId.parse("wp_aaaaaaaa");
const stageId = StageId.parse("stage_1_aaaaaaaa");
const line: Position3[] = [
  [2.7, 48.4, 100],
  [2.71, 48.41, 120.5],
];

const trip = Trip.parse({
  v: 1,
  tripId: mintTripId(),
  name: "Fontainebleau loop",
  createdAt: "2026-10-28T10:00:00.000Z",
  updatedAt: "2026-10-28T10:00:00.000Z",
  brief: {},
  stages: [{ id: stageId, from: a, to: a, via: [] }],
  waypoints: {},
  registry: { places: {}, pois: {} },
});

test("exportTrip with the real store: route, save, export, read the GPX back", () => {
  const store = createTripStore({ tripsDir: dir });
  must(store.create(trip));

  const routeId = must(store.writeRoute(trip.tripId, line));
  const routed = applyRoutedStage(
    trip,
    stageId,
    { line, distanceM: 0, snapDistancesM: [0, 0] },
    routeId,
  );
  must(store.save(routed));

  const paths = must(exportTrip(store, trip.tripId));

  const folder = join(dir, readdirSync(dir)[0]!);
  expect(paths).toEqual(
    ["day-1.gpx", "route-merged.gpx", "route.gpx"].map((n) => join(folder, n)),
  );
  const fc = gpx(
    new DOMParser().parseFromString(
      readFileSync(join(folder, "route.gpx"), "utf8"),
      "text/xml",
    ) as never,
  ) as { features: { geometry: { coordinates: unknown } }[] };
  expect(fc.features[0]!.geometry.coordinates).toEqual(line);
});

test("writeDerived overwrites existing files and leaves no temp file", () => {
  const store = createTripStore({ tripsDir: dir });
  must(store.create(trip));
  must(store.writeDerived(trip.tripId, { "route.gpx": "one" }));
  must(store.writeDerived(trip.tripId, { "route.gpx": "two" }));
  const folder = join(dir, readdirSync(dir)[0]!);
  expect(readFileSync(join(folder, "route.gpx"), "utf8")).toBe("two");
  expect(readdirSync(folder).sort()).toEqual(["route.gpx", "trip.json"]);
});

test("writeDerived refuses unsafe or reserved names and writes nothing", () => {
  const store = createTripStore({ tripsDir: dir });
  must(store.create(trip));
  const folder = join(dir, readdirSync(dir)[0]!);
  const before = readFileSync(join(folder, "trip.json"), "utf8");
  for (const name of [
    "trip.json",
    "trip.prev.json",
    "../evil.gpx",
    "sub/x.gpx",
    ".hidden",
    "",
  ]) {
    expect(kind(store.writeDerived(trip.tripId, { [name]: "x" }))).toBe(
      "invalid",
    );
  }
  expect(
    kind(store.writeDerived(trip.tripId, { "ok.gpx": "x", "../bad": "y" })),
  ).toBe("invalid");
  expect(readdirSync(folder)).toEqual(["trip.json"]);
  expect(readFileSync(join(folder, "trip.json"), "utf8")).toBe(before);
});

test("writeDerived on an unknown trip is not-found", () => {
  const store = createTripStore({ tripsDir: dir });
  writeFileSync(join(dir, "stray.txt"), "x");
  expect(kind(store.writeDerived(mintTripId(), { "a.gpx": "x" }))).toBe(
    "not-found",
  );
});
