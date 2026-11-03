import { createHash } from "node:crypto";
import { z } from "zod";
import { RouteId, type Position3 } from "@gpx-builder/core/server";

const RouteFile = z.object({
  geometry: z.object({
    coordinates: z.array(z.tuple([z.number(), z.number(), z.number()])),
  }),
});

/**
 * The exact bytes stored in routes/<routeId>.geojson. Canonical on purpose:
 * fixed key order, no whitespace, coordinates rounded to 6 decimals
 * (lng/lat) and 1 (elevation), so the same geometry always hashes the same.
 */
export function serializeRoute(line: readonly Position3[]): string {
  const round = (x: number, decimals: number) => Number(x.toFixed(decimals));
  const coordinates = line.map(([lng, lat, ele]) => [
    round(lng, 6),
    round(lat, 6),
    round(ele, 1),
  ]);
  return JSON.stringify({
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates },
  });
}

export function routeIdOf(bytes: string): RouteId {
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  return RouteId.parse(`route_${hash}`);
}

export function parseRoute(bytes: string): Position3[] {
  return RouteFile.parse(JSON.parse(bytes)).geometry.coordinates;
}
