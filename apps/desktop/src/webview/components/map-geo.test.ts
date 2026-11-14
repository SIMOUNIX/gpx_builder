import { expect, test } from "bun:test";
import { boundsOf, flyTarget, routesToGeoJSON, slopeRoutes } from "./map-geo";
import { BAND_COLORS } from "./profile-geo";

const routes = [
  {
    id: "a",
    points: [
      [1, 2],
      [3, 5],
    ] as [number, number][],
  },
  { id: "b", points: [] },
];

test("boundsOf frames all points, undefined when empty", () => {
  expect(boundsOf(routes)).toEqual([
    [1, 2],
    [3, 5],
  ]);
  expect(boundsOf([{ id: "b", points: [] }])).toBeUndefined();
});

test("routesToGeoJSON drops routes with fewer than 2 points", () => {
  expect(routesToGeoJSON(routes).features).toHaveLength(1);
});

test("slopeRoutes colours each segment with its band colour", () => {
  const r = slopeRoutes([
    {
      stageId: "s1",
      line: [
        [1, 2, 300],
        [3, 4, 310],
      ],
    },
  ]);
  expect(r).toEqual([
    {
      id: "s1",
      points: [
        [1, 2],
        [3, 4],
      ],
      color: BAND_COLORS.flat,
    },
  ]);
});

test("flyTarget zooms by kind, with a default for unknown kinds", () => {
  const lngLat: [number, number] = [6.87, 45.92];
  expect(flyTarget({ lngLat, kind: "place=city" })).toEqual({
    center: lngLat,
    zoom: 11,
  });
  expect(flyTarget({ lngLat, kind: "shop=bakery" }).zoom).toBe(12);
});
