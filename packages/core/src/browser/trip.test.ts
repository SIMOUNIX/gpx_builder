import { expect, test } from "bun:test";
import { Brief, type BriefDraft } from "./brief";
import { renderDigest } from "./digest";
import { PlaceId, RouteId, StageId, WaypointId, mintTripId } from "./ids";
import { phase } from "./phase";
import { Trip } from "./trip";

const paris = PlaceId.parse("geo:ign:paris");
const gare = PlaceId.parse("geo:ign:gare");
const wpA = WaypointId.parse("wp_aaaaaaaa");
const wpB = WaypointId.parse("wp_bbbbbbbb");

const fullBrief: BriefDraft = {
  days: 2,
  maxKmPerDay: 25,
  maxGainPerDay: 800,
  start: { placeId: gare, publicTransport: true },
  end: { placeId: gare, publicTransport: true },
  overnight: "camp",
  travel: { from: paris, modes: ["train"], maxOneWayHours: 2 },
};

const trip = (brief: BriefDraft, withStage = false): Trip =>
  Trip.parse({
    v: 1,
    tripId: mintTripId(),
    name: "Fontainebleau loop",
    createdAt: "2026-10-28T10:00:00.000Z",
    updatedAt: "2026-10-28T10:00:00.000Z",
    brief,
    stages: withStage
      ? [
          {
            id: StageId.parse("stage_1_aaaaaaaa"),
            from: wpA,
            to: wpB,
            via: [],
            overnight: "camp",
            routeId: RouteId.parse("route_0123456789abcdef"),
            stats: { km: 21.3, gainM: 640, lossM: 610, walkingMin: 420 },
          },
        ]
      : [],
    waypoints: {
      [wpA]: {
        id: wpA,
        kind: "place",
        ref: gare,
        lngLat: [2.7, 48.4],
        label: "Fontainebleau-Avon",
      },
      [wpB]: { id: wpB, kind: "user", lngLat: [2.6, 48.3], label: "Camp spot" },
    },
    registry: {
      places: {
        [paris]: { label: "Paris", kind: "city", lngLat: [2.35, 48.85] },
        [gare]: {
          label: "Fontainebleau-Avon",
          kind: "station",
          lngLat: [2.7, 48.4],
        },
      },
      pois: {},
    },
  });

test("brief completeness: partial draft is not a Brief, full one is", () => {
  expect(Brief.safeParse({ days: 2 }).success).toBe(false);
  expect(Brief.safeParse(fullBrief).success).toBe(true);
});

test("phase is derived from trip state", () => {
  expect(phase(trip({ days: 2 }))).toBe("brief");
  expect(phase(trip(fullBrief))).toBe("plan");
  expect(phase(trip(fullBrief, true))).toBe("refine");
});

test("digest lists missing brief fields while in the brief phase", () => {
  const d = renderDigest(trip({ days: 2 }));
  expect(d).toContain("phase: brief");
  expect(d).toContain("- days: 2");
  expect(d).toContain(
    "missing: maxKmPerDay, maxGainPerDay, start, end, overnight, travel",
  );
  expect(d).toContain("- none");
});

test("digest shows stages with labels, ids and stats", () => {
  const d = renderDigest(trip(fullBrief, true));
  expect(d).toContain("phase: refine");
  expect(d).toContain(
    "start: Fontainebleau-Avon (geo:ign:gare), public transport: true",
  );
  expect(d).toContain(
    "travel: from Paris (geo:ign:paris) by train, max 2 h one way",
  );
  expect(d).toContain(
    "stage_1_aaaaaaaa: Fontainebleau-Avon (wp_aaaaaaaa) -> Camp spot (wp_bbbbbbbb), 21.3 km, D+ 640 m, D- 610 m, walking time 7 h 00 min, overnight: camp, route: route_0123456789abcdef",
  );
});
