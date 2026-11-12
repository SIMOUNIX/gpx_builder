import { expect, test } from "bun:test";
import { boundsOf, routesToGeoJSON, stageRoutes } from "./map-geo";

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

test("stageRoutes makes one 2D line per stage", () => {
  expect(
    stageRoutes([
      {
        stageId: "s1",
        line: [
          [1, 2, 300],
          [3, 4, 310],
        ],
      },
    ]),
  ).toEqual([
    {
      id: "s1",
      points: [
        [1, 2],
        [3, 4],
      ],
    },
  ]);
});
