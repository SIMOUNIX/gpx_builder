import { z } from "zod";
import {
  MAX_ALLOWANCE_M,
  PoiId,
  EARTH_RADIUS_M,
  err,
  haversineM,
  ok,
  type CachePort,
  type LngLat,
  type PoiPort,
  type Position3,
  type RawPoi,
  type Result,
} from "@gpx-builder/core/server";
import { requestJson, type HttpOptions } from "./http";

const BASE_URL = "https://overpass-api.de/api/interpreter";
const ZOOM = 12;
/** Middle of the 2 to 4 weeks the architecture allows. */
export const POI_TTL_SEC = 21 * 24 * 3600;
/** POIs up to the largest detour allowance from the route are wanted. */
const MARGIN_M = MAX_ALLOWANCE_M;
const STEP_M = 1000;
const RATE_LIMIT_RETRIES = 2;

// ---- tiles ----

const tileX = (lng: number) => Math.floor(((lng + 180) / 360) * 2 ** ZOOM);
const tileY = (lat: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** ZOOM,
  );
};
const lngOf = (x: number) => (x / 2 ** ZOOM) * 360 - 180;
const latOf = (y: number) =>
  (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** ZOOM))) * 180) / Math.PI;

type Tile = { x: number; y: number };

/** Every z12 tile within the margin of the route. */
export function tilesAlong(line: readonly Position3[]): Tile[] {
  const tiles = new Map<string, Tile>();
  const add = ([lng, lat]: readonly number[]) => {
    const dLat = (MARGIN_M / EARTH_RADIUS_M) * (180 / Math.PI);
    const dLng = dLat / Math.cos((lat! * Math.PI) / 180);
    for (let x = tileX(lng! - dLng); x <= tileX(lng! + dLng); x++) {
      for (let y = tileY(lat! + dLat); y <= tileY(lat! - dLat); y++) {
        tiles.set(`${x}/${y}`, { x, y });
      }
    }
  };
  line.forEach((p, i) => {
    add(p);
    // A long straight segment could skip a tile: sample it every kilometre.
    const prev = line[i - 1];
    if (!prev) return;
    const n = Math.floor(haversineM(prev, p) / STEP_M);
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      add([prev[0] + t * (p[0] - prev[0]), prev[1] + t * (p[1] - prev[1])]);
    }
  });
  return [...tiles.values()];
}

// ---- query and parsing ----

/** One combined query for every kind we offer. Waterways keep their geometry. */
const queryFor = ({ x, y }: Tile) => {
  const bbox = `${latOf(y + 1)},${lngOf(x)},${latOf(y)},${lngOf(x + 1)}`;
  return `[out:json][timeout:25][bbox:${bbox}];
(
  nwr["amenity"~"^(drinking_water|restaurant|cafe|fast_food)$"];
  nwr["man_made"="water_tap"];
  nwr["drinking_water"="yes"];
  nwr["natural"="spring"];
  nwr["natural"="water"]["water"~"^(lake|pond)$"];
  node["waterway"="waterfall"];
  nwr["tourism"="picnic_site"];
  nwr["leisure"="picnic_table"];
  nwr["shop"~"^(supermarket|convenience|bakery)$"];
)->.points;
way["waterway"~"^(stream|river)$"]->.lines;
.points out tags center;
.lines out tags geom;`;
};

const Element = z.object({
  type: z.enum(["node", "way", "relation"]),
  id: z.number(),
  tags: z.record(z.string(), z.string()).optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  center: z.object({ lat: z.number(), lon: z.number() }).optional(),
  geometry: z.array(z.object({ lat: z.number(), lon: z.number() })).optional(),
});
const Response = z.object({
  elements: z.array(z.unknown()),
  remark: z.string().optional(),
});

/** Elements we can't place or id are dropped. */
function toRawPoi(raw: unknown): RawPoi | undefined {
  const e = Element.safeParse(raw);
  if (!e.success) return undefined;
  const { type, id, tags, lat, lon, center, geometry } = e.data;
  const points: LngLat[] = geometry
    ? geometry.map((g) => [g.lon, g.lat])
    : lat !== undefined && lon !== undefined
      ? [[lon, lat]]
      : center
        ? [[center.lon, center.lat]]
        : [];
  const poiId = PoiId.safeParse(`osm:${type}/${id}`);
  if (!tags || points.length === 0 || !poiId.success) return undefined;
  return { poiId: poiId.data, tags, geometry: points };
}

export function createOverpassPois(deps: {
  cache: CachePort;
  http?: HttpOptions;
  endpoint?: string;
}): PoiPort {
  const endpoint = deps.endpoint ?? BASE_URL;
  const sleep =
    deps.http?.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  // Overpass asks for one request at a time: every call queues behind the last.
  let queue: Promise<unknown> = Promise.resolve();
  const inQueue = <T>(job: () => Promise<T>): Promise<T> => {
    const next = queue.then(job, job);
    queue = next.catch(() => undefined);
    return next;
  };

  async function fetchTile(tile: Tile): Promise<Result<RawPoi[]>> {
    for (let attempt = 0; ; attempt++) {
      const res = await requestJson(
        endpoint,
        { method: "POST", body: new URLSearchParams({ data: queryFor(tile) }) },
        { timeoutMs: 60_000, ...deps.http },
      );
      if (!res.ok) {
        if (res.error.kind !== "rate-limit" || attempt >= RATE_LIMIT_RETRIES) {
          return res;
        }
        await sleep((res.error.retryAfterSec ?? 5 * 2 ** attempt) * 1000);
        continue;
      }
      const body = Response.safeParse(res.value);
      // A busy server answers 200 with a remark and a partial list: never cache that.
      if (!body.success || body.data.remark?.includes("runtime error")) {
        return err({
          kind: "unavailable",
          message: "Overpass could not answer this area",
        });
      }
      return ok(body.data.elements.flatMap((e) => toRawPoi(e) ?? []));
    }
  }

  const tileOf = (tile: Tile) =>
    inQueue(async (): Promise<Result<RawPoi[]>> => {
      const key = `overpass:v1:${ZOOM}/${tile.x}/${tile.y}`;
      const hit = deps.cache.get(key);
      if (hit !== undefined) {
        try {
          return ok(JSON.parse(hit) as RawPoi[]);
        } catch {
          // damaged entry: fall through and ask again
        }
      }
      const fetched = await fetchTile(tile);
      if (fetched.ok) {
        deps.cache.set(key, JSON.stringify(fetched.value), POI_TTL_SEC);
      }
      return fetched;
    });

  return {
    async near({ line }) {
      const found = new Map<string, RawPoi>();
      for (const tile of tilesAlong(line)) {
        const res = await tileOf(tile);
        if (!res.ok) return res;
        // A way crossing a tile edge is in both tiles.
        for (const poi of res.value) found.set(poi.poiId, poi);
      }
      return ok([...found.values()]);
    },
  };
}
