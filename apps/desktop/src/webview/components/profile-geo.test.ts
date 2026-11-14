import { expect, test } from "bun:test";
import { pointAtDistance, profileSamples } from "./profile-geo";

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
