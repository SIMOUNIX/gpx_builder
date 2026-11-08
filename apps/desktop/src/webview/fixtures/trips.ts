import { Trip, type LngLat } from "@gpx-builder/core/browser";

// Hand-written mocks until the M2 backend exists. Trips are parsed so they can't drift from the contract.
const hex = (n: number, len: number) => n.toString(16).padStart(len, "0");

function makeTrip(
  n: number,
  name: string,
  stageStats: [km: number, gainM: number, lossM: number][],
  center: LngLat,
  date: string,
) {
  const wp = (i: number) => `wp_${hex(n * 16 + i, 8)}`;
  const waypoints = Object.fromEntries(
    Array.from({ length: stageStats.length + 1 }, (_, i) => [
      wp(i),
      {
        id: wp(i),
        kind: "user",
        label: i === 0 ? "Start" : `Camp ${i}`,
        lngLat: [center[0] + i * 0.05, center[1] + i * 0.02],
      },
    ]),
  );
  return Trip.parse({
    v: 1,
    tripId: `trip_${hex(n, 8)}-3a52-4b8e-9d3f-1b6f0c2a7e11`,
    name,
    createdAt: date,
    updatedAt: date,
    brief: {
      days: stageStats.length,
      notes: "Prefer quiet trails, water every 10 km.",
    },
    stages: stageStats.map(([km, gainM, lossM], i) => ({
      id: `stage_${i + 1}_${hex(n * 16 + i, 8)}`,
      from: wp(i),
      to: wp(i + 1),
      via: [],
      stats: { km, gainM, lossM },
    })),
    waypoints,
    registry: { places: {}, pois: {} },
  });
}

export const mockTrips: Trip[] = [
  makeTrip(
    1,
    "Fontainebleau loop",
    [
      [18.4, 320, 290],
      [15.1, 210, 240],
    ],
    [2.7, 48.4],
    "2026-11-05T09:00:00.000Z",
  ),
  makeTrip(
    2,
    "Chamonix to Courmayeur",
    [
      [22, 1400, 900],
      [19, 1100, 1500],
      [16, 600, 800],
    ],
    [6.87, 45.92],
    "2026-11-03T09:00:00.000Z",
  ),
  makeTrip(
    3,
    "Vercors weekend",
    [
      [14, 700, 650],
      [17, 900, 950],
    ],
    [5.5, 45.0],
    "2026-10-28T09:00:00.000Z",
  ),
  makeTrip(
    4,
    "GR20 north",
    [
      [12, 1100, 400],
      [11, 800, 900],
    ],
    [8.9, 42.4],
    "2026-10-20T09:00:00.000Z",
  ),
  makeTrip(
    5,
    "Cevennes crossing",
    [[20, 600, 700]],
    [3.6, 44.2],
    "2026-10-11T09:00:00.000Z",
  ),
  makeTrip(
    6,
    "Mont Blanc tour",
    [
      [25, 1600, 1200],
      [18, 900, 1300],
    ],
    [6.8, 45.8],
    "2026-09-30T09:00:00.000Z",
  ),
  makeTrip(
    7,
    "Pyrenees Aure valley",
    [[16, 1000, 800]],
    [0.3, 42.8],
    "2026-09-12T09:00:00.000Z",
  ),
];

export const mockChat = (trip: Trip) => [
  {
    id: "m1",
    role: "user" as const,
    createdAt: trip.createdAt,
    parts: [{ type: "text" as const, text: `Plan me a trip: ${trip.name}.` }],
  },
  {
    id: "m2",
    role: "assistant" as const,
    createdAt: trip.createdAt,
    parts: [
      {
        type: "text" as const,
        text: `Done. ${trip.stages.length} day(s), routed on foot-hiking paths. Open the map to see the route.`,
      },
    ],
  },
];
