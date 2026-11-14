import type { LngLat, Position3 } from "@gpx-builder/core/browser";

export type MapRoute = { id: string; points: LngLat[]; color?: string };

// MapLibre paint colours can't use CSS variables or oklch, so hex it is.
export const ROUTE_COLORS = ["#7fcfae", "#f0b58a", "#b9a3ee"];

/** One map line per routed stage (`trips.route`), elevation dropped. */
export const stageRoutes = (
  stages: { stageId: string; line: Position3[] }[],
): MapRoute[] =>
  stages.map(({ stageId, line }) => ({
    id: stageId,
    points: line.map(([lng, lat]) => [lng, lat]),
  }));

export function routesToGeoJSON(routes: MapRoute[]) {
  return {
    type: "FeatureCollection" as const,
    features: routes
      .filter((r) => r.points.length > 1)
      .map((r, i) => ({
        type: "Feature" as const,
        properties: { color: r.color ?? ROUTE_COLORS[i % ROUTE_COLORS.length] },
        geometry: { type: "LineString" as const, coordinates: r.points },
      })),
  };
}

/** [[west, south], [east, north]], or undefined when there is nothing to frame. */
export function boundsOf(routes: MapRoute[]): [LngLat, LngLat] | undefined {
  const all = routes.flatMap((r) => r.points);
  if (all.length === 0) return undefined;
  const lngs = all.map((p) => p[0]);
  const lats = all.map((p) => p[1]);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

// Zoom by OSM `key=value` (GeocodeCandidate.kind): the scale at which that kind of place reads well.
const ZOOM_BY_KIND: Record<string, number> = {
  "place=country": 5,
  "place=state": 7,
  "place=county": 9,
  "place=city": 11,
  "place=town": 12,
  "place=village": 13,
  "place=hamlet": 14,
  "natural=peak": 13,
  "highway=residential": 15,
};
const DEFAULT_ZOOM = 12;

/** Where the camera lands for a search result ([lng, lat] centre). */
export const flyTarget = (c: { lngLat: LngLat; kind: string }) => ({
  center: c.lngLat,
  zoom: ZOOM_BY_KIND[c.kind] ?? DEFAULT_ZOOM,
});
