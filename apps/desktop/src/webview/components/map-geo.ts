import type { LngLat } from "@gpx-builder/core/browser";

export type MapRoute = { id: string; points: LngLat[]; color?: string };

// MapLibre paint colours can't use CSS variables or oklch, so hex it is.
export const ROUTE_COLORS = ["#7fcfae", "#f0b58a", "#b9a3ee"];

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
