import { expect, test } from "bun:test";
import { gpx } from "@tmcw/togeojson";
import { DOMParser } from "@xmldom/xmldom";
import {
  buildDayGpx,
  buildMergedGpx,
  buildRouteGpx,
  buildWaypointsGpx,
} from "./gpx";
import type { Position3 } from "./geo";

const meta = { name: "Loop & <test>" };
const day1 = {
  name: "Day 1",
  line: [
    [2.7, 48.4, 100],
    [2.71, 48.41, 120.5],
  ] as Position3[],
};
const day2 = {
  name: "Day 2",
  line: [
    [2.71, 48.41, 120.5],
    [2.72, 48.42, 90],
  ] as Position3[],
};

type Fc = {
  features: {
    properties: Record<string, unknown> | null;
    geometry: { coordinates: unknown };
  }[];
};
// togeojson types want a DOM Document, which our lib setting (no DOM) lacks.
const read = (xml: string) =>
  gpx(new DOMParser().parseFromString(xml, "text/xml") as never) as Fc;

test("route.gpx: one track per day, coordinates and elevation survive a round trip", () => {
  const fc = read(buildRouteGpx(meta, [day1, day2]));
  expect(fc.features.map((f) => f.properties?.name)).toEqual([
    "Day 1",
    "Day 2",
  ]);
  expect(fc.features[0]!.geometry).toMatchObject({
    coordinates: [
      [2.7, 48.4, 100],
      [2.71, 48.41, 120.5],
    ],
  });
});

test("route-merged.gpx: a single track with every point", () => {
  const fc = read(buildMergedGpx(meta, [day1, day2]));
  expect(fc.features).toHaveLength(1);
  expect(fc.features[0]!.geometry.coordinates).toHaveLength(4);
});

test("day gpx has one track; waypoints gpx has wpt with sym and type", () => {
  expect(read(buildDayGpx(meta, day1)).features).toHaveLength(1);
  const fc = read(
    buildWaypointsGpx(meta, [
      {
        name: "Fontaine",
        lngLat: [2.7, 48.4],
        ele: 80,
        sym: "Drinking Water",
        type: "potable",
      },
    ]),
  );
  expect(fc.features[0]!.properties).toMatchObject({
    name: "Fontaine",
    sym: "Drinking Water",
    type: "potable",
  });
});

test("names are XML-escaped and ODbL copyright is present", () => {
  const xml = buildDayGpx(meta, day1);
  expect(xml).toContain("Loop &amp; &lt;test&gt;");
  expect(xml).toContain("OpenStreetMap contributors");
  expect(xml).not.toContain("<time>");
});
