import { expect, test } from "bun:test";
import {
  PlaceId,
  PoiId,
  err,
  type GeocodeCandidate,
  type RawPoi,
  type RoutedStage,
  type RoutingPort,
} from "@gpx-builder/core/server";
import {
  depsFor,
  emptyTrip,
  fakeGeocode,
  fakePois,
  fakeRouting,
  memoryTrips,
  run,
} from "../test-util";
import { createTools } from "./index";
import type { Failure } from "../results";

const gare = PlaceId.parse("geo:photon:node/1");
const village = PlaceId.parse("geo:photon:node/2");
const paris = PlaceId.parse("geo:photon:node/3");

const candidates: GeocodeCandidate[] = [
  {
    placeId: gare,
    label: "Gare, Avon, France",
    kind: "railway=station",
    lngLat: [2.7264, 48.4153],
  },
  {
    placeId: village,
    label: "Larchant, France",
    kind: "place=village",
    lngLat: [2.5897, 48.2882],
  },
  {
    placeId: paris,
    label: "Paris, France",
    kind: "place=city",
    lngLat: [2.3522, 48.8566],
  },
];

const routed: RoutedStage = {
  line: [
    [2.7264, 48.4153, 100],
    [2.7, 48.4, 150],
    [2.59, 48.288, 120],
  ],
  distanceM: 20000,
  snapDistancesM: [3, 12],
};

const fullBrief = {
  days: 2,
  maxKmPerDay: 25,
  maxGainPerDay: 800,
  start: { placeId: gare, publicTransport: true },
  end: { placeId: gare, publicTransport: true },
  overnight: "camp",
  travel: { from: paris, modes: ["train"], maxOneWayHours: 2 },
};

function setup(routing: RoutingPort = fakeRouting(routed)) {
  const trips = memoryTrips(emptyTrip());
  const geocode = fakeGeocode(candidates);
  const tools = createTools(depsFor(trips, geocode, routing));
  return { trips, geocode, routing, tools };
}

/** A trip with places known, a full brief and one itinerary. */
async function planned() {
  const s = setup();
  await run(s.tools.find_place, { query: "x" });
  await run(s.tools.submit_brief, { brief: fullBrief, name: "Fontainebleau" });
  const out = await run<{
    ok: true;
    stages: { stageId: string }[];
  }>(s.tools.submit_itinerary, {
    stages: [{ from: gare, to: village, overnight: "camp" }],
  });
  return { ...s, stageId: out.stages[0]!.stageId };
}

test("find_place returns ids and labels only, never coordinates", async () => {
  const { tools } = setup();
  const out = await run<{ ok: true; candidates: unknown[] }>(tools.find_place, {
    query: "gare",
  });
  expect(out.candidates).toHaveLength(3);
  expect(out.candidates[0]).toEqual({
    placeId: gare,
    label: "Gare, Avon, France",
    kind: "railway=station",
  });
  expect(JSON.stringify(out)).not.toContain("2.7264");
});

test("find_place remembers every id it showed", async () => {
  const { tools, trips } = setup();
  await run(tools.find_place, { query: "gare" });
  expect(trips.trip().registry.places[village]).toEqual({
    label: "Larchant, France",
    kind: "place=village",
    lngLat: [2.5897, 48.2882],
  });
});

test("nearHint is turned into coordinates for the geocoder", async () => {
  const { tools, geocode } = setup();
  await run(tools.find_place, { query: "gare" });
  await run(tools.find_place, { query: "boulangerie", nearHint: village });
  expect(geocode.calls[1]).toMatchObject({ nearHint: [2.5897, 48.2882] });
});

test("an unknown nearHint is an issue, not a search", async () => {
  const { tools, geocode } = setup();
  const out = await run<Failure>(tools.find_place, {
    query: "x",
    nearHint: village,
  });
  expect(out.issues?.[0]?.path).toBe("nearHint");
  expect(geocode.calls).toHaveLength(0);
});

test("a geocoder failure is reported, not thrown", async () => {
  const trips = memoryTrips(emptyTrip());
  const geocode = {
    search: async () => err({ kind: "rate-limit" as const, message: "slow" }),
  };
  const tools = createTools(depsFor(trips, geocode, fakeRouting(routed)));
  expect(await run(tools.find_place, { query: "x" })).toEqual({
    ok: false,
    error: "rate-limit: slow",
  });
});

test("submit_brief merges partial answers and lists what is missing", async () => {
  const { tools, trips } = setup();
  await run(tools.find_place, { query: "x" });
  const first = await run<{ complete: boolean; missing: string[] }>(
    tools.submit_brief,
    { brief: { days: 2, start: { placeId: gare, publicTransport: true } } },
  );
  expect(first.complete).toBe(false);
  expect(first.missing).toContain("maxKmPerDay");
  expect(first.missing).not.toContain("days");

  const second = await run<{
    ok: true;
    complete: boolean;
    missing: string[];
  }>(tools.submit_brief, { brief: fullBrief, name: "Fontainebleau" });
  expect(second).toEqual({ ok: true, complete: true, missing: [] });
  expect(trips.trip().name).toBe("Fontainebleau");
  expect(trips.trip().brief.days).toBe(2);
});

test("submit_brief refuses a placeId it was never shown", async () => {
  const { tools, trips } = setup();
  const out = await run<Failure>(tools.submit_brief, {
    brief: { start: { placeId: gare, publicTransport: true } },
  });
  expect(out.issues?.[0]?.path).toBe("brief.start.placeId");
  expect(trips.trip().brief).toEqual({});
});

test("submit_itinerary needs a complete brief", async () => {
  const { tools } = setup();
  await run(tools.find_place, { query: "x" });
  const out = await run<Failure>(tools.submit_itinerary, {
    stages: [{ from: gare, to: village }],
  });
  expect(out.error).toContain("brief is incomplete");
});

test("submit_itinerary points at the bad input path", async () => {
  const { tools } = setup();
  await run(tools.find_place, { query: "x" });
  await run(tools.submit_brief, { brief: fullBrief });
  const unknown = PlaceId.parse("geo:photon:node/999");
  const out = await run<Failure>(tools.submit_itinerary, {
    stages: [
      { from: gare, to: village },
      { from: village, to: unknown, via: [unknown] },
    ],
  });
  expect(out.issues?.map((i) => i.path)).toEqual([
    "stages.1.to",
    "stages.1.via.0",
  ]);
});

test("submit_itinerary builds stages and shares a waypoint between meeting stages", async () => {
  const { tools, trips } = setup();
  await run(tools.find_place, { query: "x" });
  await run(tools.submit_brief, { brief: fullBrief });
  const out = await run<{ ok: true; stages: { stageId: string }[] }>(
    tools.submit_itinerary,
    {
      stages: [
        { from: gare, to: village, overnight: "camp" },
        { from: village, to: gare },
      ],
    },
  );
  const trip = trips.trip();
  expect(out.stages.map((s) => s.stageId)).toEqual(
    trip.stages.map((s) => s.id),
  );
  expect(trip.stages[0]!.id).toMatch(/^stage_1_/);
  expect(trip.stages[1]!.id).toMatch(/^stage_2_/);
  expect(trip.stages[0]!.to).toBe(trip.stages[1]!.from); // same place, same waypoint
  expect(trip.stages[1]!.to).toBe(trip.stages[0]!.from);
  expect(Object.keys(trip.waypoints)).toHaveLength(2);
  expect(trip.waypoints[trip.stages[0]!.from]).toMatchObject({
    kind: "place",
    ref: gare,
    lngLat: [2.7264, 48.4153],
  });
});

test("a second submit_itinerary replaces the first", async () => {
  const { tools, trips } = await planned();
  await run(tools.submit_itinerary, {
    stages: [
      { from: gare, to: village },
      { from: village, to: gare },
    ],
  });
  expect(trips.trip().stages).toHaveLength(2);
  expect(Object.keys(trips.trip().waypoints)).toHaveLength(2);
});

test("route sends coordinates in order and stores stats", async () => {
  const { tools, trips, routing, stageId } = await planned();
  const out = await run<{
    ok: true;
    km: number;
    gainM: number;
    lossM: number;
    routeId: string;
  }>(tools.route, { stageId });
  expect((routing as ReturnType<typeof fakeRouting>).calls[0]).toEqual({
    waypoints: [
      [2.7264, 48.4153],
      [2.5897, 48.2882],
    ],
    profile: "foot-hiking",
  });
  expect(out).toMatchObject({ ok: true, gainM: 50, lossM: 30 });
  expect(out.routeId).toMatch(/^route_[0-9a-f]{16}$/);
  const stage = trips.trip().stages[0]!;
  expect(stage.routeId).toBe(out.routeId as never);
  expect(stage.snapDistancesM).toEqual([3, 12]);
  expect(JSON.stringify(out)).not.toContain("snap");
});

test("route rejects an unknown stage and reports router errors", async () => {
  const { tools, stageId } = await planned();
  const unknown = await run<Failure>(tools.route, {
    stageId: "stage_9_aaaaaaaa",
  });
  expect(unknown.issues?.[0]?.path).toBe("stageId");

  const failing: RoutingPort = {
    capabilities: { maxWaypoints: 50, profiles: ["foot-hiking"] },
    route: async () =>
      err({ kind: "not-found" as const, message: "no routable point" }),
  };
  const s = setup(failing);
  await run(s.tools.find_place, { query: "x" });
  await run(s.tools.submit_brief, { brief: fullBrief });
  const made = await run<{ stages: { stageId: string }[] }>(
    s.tools.submit_itinerary,
    { stages: [{ from: gare, to: village }] },
  );
  expect(
    await run(s.tools.route, { stageId: made.stages[0]!.stageId }),
  ).toEqual({ ok: false, error: "not-found: no routable point" });
  expect(stageId).toBeTruthy();
});

test("export_trip is client-side too: the host asks the user first", () => {
  const { tools } = setup();
  expect(tools.export_trip.execute).toBeUndefined();
});

test("ask_user is client-side: no execute, so the loop stops", () => {
  const { tools } = setup();
  expect(tools.ask_user.execute).toBeUndefined();
});

const tick = () => new Promise((r) => setTimeout(r, 0));

test("parallel route calls on different stages both keep their routeId", async () => {
  const slow: RoutingPort = {
    capabilities: { maxWaypoints: 50, profiles: ["foot-hiking"] },
    async route({ waypoints }) {
      await tick();
      return {
        ok: true as const,
        value: { ...routed, line: [...routed.line, [waypoints.length, 0, 0]] },
      };
    },
  };
  const s = setup(slow);
  await run(s.tools.find_place, { query: "x" });
  await run(s.tools.submit_brief, { brief: fullBrief });
  const made = await run<{ stages: { stageId: string }[] }>(
    s.tools.submit_itinerary,
    {
      stages: [
        { from: gare, to: village },
        { from: village, to: gare },
      ],
    },
  );
  await Promise.all(
    made.stages.map((st) => run(s.tools.route, { stageId: st.stageId })),
  );
  expect(s.trips.trip().stages.map((st) => !!st.routeId)).toEqual([true, true]);
});

test("parallel find_place calls keep every candidate in the registry", async () => {
  const trips = memoryTrips(emptyTrip());
  const geocode = {
    async search({ query }: { query: string }) {
      await tick();
      return {
        ok: true as const,
        value: [query === "a" ? candidates[0]! : candidates[1]!],
      };
    },
  };
  const tools = createTools(depsFor(trips, geocode, fakeRouting(routed)));
  await Promise.all([
    run(tools.find_place, { query: "a" }),
    run(tools.find_place, { query: "b" }),
  ]);
  expect(Object.keys(trips.trip().registry.places).sort()).toEqual([
    gare,
    village,
  ]);
});

test("route reports a stage whose waypoint is missing from the trip", async () => {
  const { tools, trips, stageId } = await planned();
  const t = trips.trip();
  const stage = t.stages[0]!;
  delete t.waypoints[stage.from];
  const out = await run<Failure>(tools.route, { stageId });
  expect(out.error).toContain("waypoint missing");
});

test("route reports a stage deleted while the router was busy", async () => {
  const s = await planned();
  const racing: RoutingPort = {
    capabilities: { maxWaypoints: 50, profiles: ["foot-hiking"] },
    async route() {
      s.trips.store.save({ ...s.trips.trip(), stages: [] });
      return { ok: true as const, value: routed };
    },
  };
  const tools = createTools(depsFor(s.trips, s.geocode, racing));
  const out = await run<Failure>(tools.route, { stageId: s.stageId });
  expect(out.issues?.[0]?.path).toBe("stageId");
});

// ---- find_pois ----

const raw = (
  id: number,
  tags: Record<string, string>,
  ...geometry: [number, number][]
): RawPoi => ({ poiId: PoiId.parse(`osm:node/${id}`), tags, geometry });

// The routed line runs from (2.7264, 48.4153) to (2.7, 48.4); its middle is (2.7132, 48.4077).
const around: RawPoi[] = [
  raw(1, { amenity: "drinking_water" }, [2.7132, 48.4087]), // ~110 m off
  raw(
    2,
    { waterway: "stream", name: "Ru du Pré" },
    [2.7132, 48.4177],
    [2.7132, 48.3977],
  ), // crosses
  raw(3, { amenity: "restaurant", name: "Chez Loin" }, [2.7132, 48.4177]), // ~1.1 km off
  raw(4, { man_made: "water_tap", drinking_water: "no" }, [2.7132, 48.4087]), // not drinkable
  raw(5, { shop: "bakery" }, [2.7132, 48.4082]),
  raw(6, { amenity: "bank" }, [2.7132, 48.4082]), // not one of our kinds
];

async function routedStage(pois = fakePois(around)) {
  const trips = memoryTrips(emptyTrip());
  const tools = createTools(
    depsFor(trips, fakeGeocode(candidates), fakeRouting(routed), pois),
  );
  await run(tools.find_place, { query: "x" });
  await run(tools.submit_brief, { brief: fullBrief });
  const out = await run<{ ok: true; stages: { stageId: string }[] }>(
    tools.submit_itinerary,
    { stages: [{ from: gare, to: village }] },
  );
  const stageId = out.stages[0]!.stageId;
  await run(tools.route, { stageId });
  return { trips, tools, pois, stageId };
}

type Listed = {
  ok: true;
  allowanceM: number;
  groups: Record<
    string,
    {
      found: number;
      pois: {
        poiId: string;
        name: string;
        distanceM: number;
        kmAlong: number;
      }[];
    }
  >;
};

test("find_pois lists the POIs within the allowance, grouped, nearest first", async () => {
  const { tools, stageId } = await routedStage();
  const out = await run<Listed>(tools.find_pois, { stageId });
  expect(out.allowanceM).toBe(200);
  expect(Object.keys(out.groups).sort()).toEqual([
    "resupply",
    "water.potable",
    "water.treatable",
  ]);
  expect(out.groups["water.potable"]!.pois[0]).toMatchObject({
    poiId: "osm:node/1",
    name: "Drinking water",
  });
  expect(out.groups["resupply"]!.pois[0]).toMatchObject({ name: "Bakery" });
  // the stream crosses the route
  expect(out.groups["water.treatable"]!.pois[0]).toMatchObject({
    name: "Ru du Pré",
    distanceM: 0,
  });
  expect(JSON.stringify(out)).not.toContain("2.71"); // no coordinates
});

test("find_pois stores what it found in the registry, with the water tier", async () => {
  const { tools, trips, stageId } = await routedStage();
  await run(tools.find_pois, { stageId });
  const { pois } = trips.trip().registry;
  expect(Object.keys(pois).sort()).toEqual([
    "osm:node/1",
    "osm:node/2",
    "osm:node/5",
  ]);
  expect(pois[PoiId.parse("osm:node/1")]).toMatchObject({
    kind: "water",
    tier: "potable",
  });
  // a waterway is stored at its crossing with the route
  const stream = pois[PoiId.parse("osm:node/2")]!;
  expect(stream.lngLat[0]).toBeCloseTo(2.7132, 3);
  expect(stream.lngLat[1]).toBeCloseTo(48.4077, 3);
  expect(pois[PoiId.parse("osm:node/5")]!.tier).toBeUndefined();
});

test("find_pois only returns the kinds asked for", async () => {
  const { tools, stageId } = await routedStage();
  const out = await run<Listed>(tools.find_pois, {
    stageId,
    kinds: ["resupply"],
  });
  expect(Object.keys(out.groups)).toEqual(["resupply"]);
});

test("find_pois shows 5 per group and says how many there are", async () => {
  const many = Array.from({ length: 8 }, (_, i) =>
    raw(100 + i, { amenity: "cafe" }, [2.7132, 48.4078 + i * 0.0001]),
  );
  const { tools, stageId } = await routedStage(fakePois(many));
  const out = await run<Listed>(tools.find_pois, { stageId });
  expect(out.groups["food"]!.found).toBe(8);
  expect(out.groups["food"]!.pois).toHaveLength(5);
});

test("find_pois waits until every stage is routed", async () => {
  const { tools, trips, pois } = await routedStage();
  await run(tools.submit_itinerary, {
    stages: [
      { from: gare, to: village },
      { from: village, to: gare },
    ],
  });
  const first = trips.trip().stages[0]!.id;
  await run(tools.route, { stageId: first });
  const out = await run<Failure & { unrouted: string[] }>(tools.find_pois, {
    stageId: first,
  });
  expect(out.ok).toBe(false);
  expect(out.unrouted).toEqual([trips.trip().stages[1]!.id]);
  expect((pois as ReturnType<typeof fakePois>).calls).toHaveLength(0);
});

test("find_pois rejects an unknown stage", async () => {
  const { tools } = await routedStage();
  const out = await run<Failure>(tools.find_pois, {
    stageId: "stage_9_deadbeef",
  });
  expect(out.issues?.[0]?.path).toBe("stageId");
});

test("an unavailable Overpass is a clear message and changes nothing", async () => {
  const down = {
    near: async () =>
      err({ kind: "unavailable" as const, message: "HTTP 504" }),
  };
  const { tools, trips, stageId } = await routedStage(down as never);
  const before = trips.trip();
  const out = await run<Failure>(tools.find_pois, { stageId });
  expect(out.ok).toBe(false);
  expect(out.error).toContain("unavailable");
  expect(out.error).toContain("try again later");
  expect(trips.trip()).toBe(before);
});
