import { EARTH_RADIUS_M, type LngLat, type Position3 } from "./geo";

export const PoiKind = ["water", "food", "picnic", "resupply"] as const;
export type PoiKind = (typeof PoiKind)[number];
export const WaterTier = ["potable", "treatable", "unknown"] as const;
export type WaterTier = (typeof WaterTier)[number];

export type PoiClass = { kind: PoiKind; tier?: WaterTier };

const MIN_ALLOWANCE_M = 200;
export const MAX_ALLOWANCE_M = 2000;

/** 1% of the whole trip's length, at least 200 m and at most 2 km. */
export const detourAllowanceM = (tripKm: number): number =>
  Math.min(Math.max(tripKm * 10, MIN_ALLOWANCE_M), MAX_ALLOWANCE_M);

const FOOD = new Set(["restaurant", "cafe", "fast_food"]);
const RESUPPLY = new Set(["supermarket", "convenience", "bakery"]);
const TREATABLE_WATERWAY = new Set(["stream", "river", "waterfall"]);

/** OSM tags to what we offer a hiker; `undefined` when it is none of our kinds. */
export function classifyPoi(
  tags: Record<string, string>,
): PoiClass | undefined {
  if (FOOD.has(tags.amenity ?? "")) return { kind: "food" };
  if (tags.tourism === "picnic_site" || tags.leisure === "picnic_table") {
    return { kind: "picnic" };
  }
  if (RESUPPLY.has(tags.shop ?? "")) return { kind: "resupply" };

  const water = (tier: WaterTier): PoiClass => ({ kind: "water", tier });

  const natural =
    TREATABLE_WATERWAY.has(tags.waterway ?? "") ||
    tags.natural === "spring" ||
    (tags.natural === "water" && ["lake", "pond"].includes(tags.water ?? ""));
  const tap =
    tags.amenity === "drinking_water" || tags.man_made === "water_tap";

  if (natural && tags.drinking_water !== "yes") return water("treatable");
  if (tap || tags.drinking_water === "yes") {
    if (tags.drinking_water === "no") return undefined;
    // ponytail: seasonal sources fall to unknown, not dropped; they may only be off part of the year
    if (tags.seasonal === "yes") return water("unknown");
    const potable =
      tags.drinking_water === "yes" || tags.amenity === "drinking_water";
    return water(potable ? "potable" : "unknown");
  }
  return undefined;
}

// ---- where a POI sits relative to the route ----

type XY = [number, number];
const M_PER_DEG = (EARTH_RADIUS_M * Math.PI) / 180;

/** Closest point of segment a-b to p: parameter t in [0, 1] and distance. */
function toSegment(p: XY, a: XY, b: XY) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0
      ? 0
      : Math.min(
          1,
          Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2),
        );
  return { t, d: Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) };
}

/** Where segments a-b and c-d cross: parameters along each, or `undefined`. */
function crossing(a: XY, b: XY, c: XY, d: XY) {
  const r: XY = [b[0] - a[0], b[1] - a[1]];
  const s: XY = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (den === 0) return undefined;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : undefined;
}

/**
 * The point of `geometry` (one point, or a waterway's vertices) closest to the
 * route, its distance to the route and how far along the route it lies.
 * A waterway the route crosses is at distance 0, at the crossing.
 */
export function locateOnRoute(
  geometry: readonly LngLat[],
  line: readonly Position3[],
): { lngLat: LngLat; distanceM: number; alongM: number } {
  const [lng0, lat0] = line[0]!;
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const xy = ([lng, lat]: readonly number[]): XY => [
    (lng! - lng0) * kx,
    (lat! - lat0) * M_PER_DEG,
  ];
  const back = ([x, y]: XY): LngLat => [lng0 + x / kx, lat0 + y / M_PER_DEG];

  const route = line.map(xy);
  const geo = geometry.map(xy);
  const cum = [0];
  for (let i = 1; i < route.length; i++) {
    cum.push(
      cum[i - 1]! +
        Math.hypot(
          route[i]![0] - route[i - 1]![0],
          route[i]![1] - route[i - 1]![1],
        ),
    );
  }
  const along = (i: number, t: number) => cum[i]! + t * (cum[i + 1]! - cum[i]!);

  let best = { point: geo[0]!, d: Infinity, alongM: 0 };
  const consider = (point: XY, d: number, alongM: number) => {
    if (d < best.d) best = { point, d, alongM };
  };
  const onGeo = (j: number, t: number): XY => {
    const g = geo[j]!;
    const h = geo[j + 1]!;
    return [g[0] + t * (h[0] - g[0]), g[1] + t * (h[1] - g[1])];
  };

  // ponytail: O(points x route) per waterway, fine for stage-sized routes
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i]!;
    const b = route[i + 1]!;
    for (const g of geo) {
      const { t, d } = toSegment(g, a, b);
      consider(g, d, along(i, t));
    }
    for (let j = 0; j + 1 < geo.length; j++) {
      const hit = crossing(a, b, geo[j]!, geo[j + 1]!);
      if (hit) consider(onGeo(j, hit.u), 0, along(i, hit.t));
    }
  }
  // A route vertex can be closer to the middle of a waterway segment than any of its vertices.
  for (let j = 0; j + 1 < geo.length; j++) {
    for (let i = 0; i < route.length; i++) {
      const { t, d } = toSegment(route[i]!, geo[j]!, geo[j + 1]!);
      consider(onGeo(j, t), d, cum[i]!);
    }
  }
  return { lngLat: back(best.point), distanceM: best.d, alongM: best.alongM };
}
