import { expect, test } from "bun:test";
import {
  bandOf,
  gradePct,
  type Band,
  pointAtDistance,
  profileBands,
  profileSamples,
  slopeSegments,
  type ProfileSample,
} from "./profile-geo";

// Along the equator 1° of longitude is 111.195 km (R = 6371 km).
const DEG = 111.195;
const stages = [
  {
    stageId: "s1",
    line: [
      [0, 0, 100],
      [1, 0, 200],
    ] as [number, number, number][],
  },
  {
    stageId: "s2",
    line: [
      [1, 0, 200],
      [2, 0, 150],
    ] as [number, number, number][],
  },
];

test("a stage without elevation adds no samples but still counts as distance", () => {
  const s = profileSamples([
    {
      stageId: "s1",
      line: [
        [0, 0, NaN],
        [1, 0, NaN],
      ],
    },
    ...stages.slice(1),
  ]);
  expect(s.map((p) => p.elevationM)).toEqual([200, 150]);
  expect(s[0]?.distanceKm).toBeCloseTo(DEG, 1);
  expect(profileSamples([{ stageId: "s1", line: [] }])).toEqual([]);
});

test("one day restarts at 0 km and holds only that stage", () => {
  const s = profileSamples(stages, "s2");
  expect(s.map((p) => p.elevationM)).toEqual([200, 150]);
  expect(s[0]?.distanceKm).toBe(0);
  expect(s[1]?.distanceKm).toBeCloseTo(DEG, 1);
});

test("whole trip accumulates distance across stages", () => {
  const s = profileSamples(stages);
  expect(s.map((p) => p.elevationM)).toEqual([100, 200, 200, 150]);
  expect(s.map((p) => p.distanceKm)).toEqual([
    0,
    expect.closeTo(DEG, 1),
    expect.closeTo(DEG, 1),
    expect.closeTo(2 * DEG, 1),
  ]);
  expect(s[3]?.point).toEqual([2, 0]);
});

test("pointAtDistance hits the start, interpolates between samples, clamps at the end", () => {
  const s = profileSamples(stages, "s1");
  expect(pointAtDistance(s, 0)).toEqual([0, 0]);
  expect(pointAtDistance(s, DEG / 2)).toEqual([expect.closeTo(0.5, 3), 0]);
  expect(pointAtDistance(s, s[1]!.distanceKm)).toEqual([1, 0]);
  expect(pointAtDistance(s, 999)).toEqual([1, 0]);
  expect(pointAtDistance(s, -5)).toEqual([0, 0]);
  expect(pointAtDistance([], 1)).toBeUndefined();
});

// Samples every 0.05 km (50 m) with the given elevations, bypassing haversine so grades are exact.
const at = (...elevs: number[]): ProfileSample[] =>
  elevs.map((elevationM, i) => ({
    distanceKm: i * 0.05,
    elevationM,
    point: [i, 0],
    stageId: "s",
  }));

test("bandOf: thresholds belong to the steeper band, both signs", () => {
  const cases: [number, Band][] = [
    [8.01, "steep-up"],
    [8, "steep-up"],
    [7.99, "up"],
    [3, "up"],
    [2.99, "flat"],
    [0, "flat"],
    [-2.99, "flat"],
    [-3, "down"],
    [-7.99, "down"],
    [-8, "steep-down"],
    [-20, "steep-down"],
  ];
  for (const [g, band] of cases) expect([g, bandOf(g)]).toEqual([g, band]);
});

test("gradePct: constant slope reads the same everywhere, flat and constant elevation read 0", () => {
  const slope = at(0, 5, 10, 15, 20, 25); // 5 m per 50 m = 10%
  for (let i = 0; i < slope.length; i++)
    expect(gradePct(slope, i)).toBeCloseTo(10);
  expect(gradePct(at(100, 100, 100, 100), 1)).toBe(0);
  expect(gradePct(at(100), 0)).toBe(0);
});

test("gradePct: averages over 100 m, so a one-sample spike does not colour the route", () => {
  const spike = at(0, 0, 50, 0, 0); // +50 m in one 50 m step, then back
  expect(Math.abs(gradePct(spike, 2))).toBeLessThan(1);
  // At the first sample the window is clamped to the line's start.
  expect(gradePct(at(0, 5, 10), 0)).toBeCloseTo(10);
});

test("gradePct: sparse samples widen the window to the neighbours", () => {
  const sparse: ProfileSample[] = [0, 0.3, 0.6].map((d, i) => ({
    distanceKm: d,
    elevationM: i * 30, // 30 m per 300 m = 10%
    point: [i, 0],
    stageId: "s",
  }));
  expect(gradePct(sparse, 1)).toBeCloseTo(10);
});

test("gradePct: a window never crosses into another stage", () => {
  const s = [...at(0, 0, 0), ...at(100, 100, 100)].map((p, i) => ({
    ...p,
    distanceKm: i * 0.05,
    stageId: i < 3 ? "a" : "b",
  }));
  expect(gradePct(s, 2)).toBe(0);
  expect(gradePct(s, 3)).toBe(0);
});

test("profileBands merges consecutive segments of one band", () => {
  // 0.1 km flat, then 10% climb for 0.15 km, then flat.
  const s = at(0, 0, 0, 5, 10, 15, 15, 15, 15, 15);
  const bands = profileBands(s);
  // The 100 m averaging eases the climb in and out through "up".
  expect(bands.map((b) => b.band)).toEqual([
    "flat",
    "up",
    "steep-up",
    "up",
    "flat",
  ]);
  expect(bands[0]?.fromKm).toBe(0);
  expect(bands.at(-1)?.toKm).toBeCloseTo(0.45);
  for (let i = 1; i < bands.length; i++)
    expect(bands[i]?.fromKm).toBe(bands[i - 1]?.toKm);
  expect(profileBands(at(5))).toEqual([]);
});

test("slopeSegments splits a stage by band and shares its joints", () => {
  const climb: [number, number, number][] = [
    [0, 0, 0],
    [0.001, 0, 0],
    [0.002, 0, 0],
    [0.003, 0, 40],
    [0.004, 0, 80],
    [0.005, 0, 120],
  ];
  const segs = slopeSegments([{ stageId: "s1", line: climb }]);
  expect(segs.map((s) => s.band)).toEqual(["flat", "steep-up"]);
  expect(segs.every((s) => s.stageId === "s1")).toBe(true);
  expect(segs[0]!.points.at(-1)).toEqual(segs[1]!.points[0]);
  expect(segs[1]!.points.at(-1)).toEqual([0.005, 0]);
});

test("slopeSegments draws a stage without elevation as one neutral line", () => {
  const segs = slopeSegments([
    {
      stageId: "s1",
      line: [
        [0, 0, NaN],
        [1, 0, NaN],
      ],
    },
  ]);
  expect(segs).toEqual([
    {
      stageId: "s1",
      band: "flat",
      points: [
        [0, 0],
        [1, 0],
      ],
    },
  ]);
});
