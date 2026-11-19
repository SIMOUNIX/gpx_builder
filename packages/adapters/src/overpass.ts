import { z } from "zod";
import {
  PoiId,
  err,
  haversineM,
  ok,
  type LngLat,
  type PoiPort,
  type Position3,
  type RawPoi,
  type Result,
} from "@gpx-builder/core/server";
import { requestJson, type HttpOptions } from "./http";

const BASE_URL = "https://overpass.openstreetmap.fr/api/interpreter";
/** The server gives up a little before we do, so its own message arrives. */
const SERVER_TIMEOUT_SEC = 80;
const REQUEST_CAP_MS = 90_000;
/** Waits before the 1st and 2nd retry after a server error. */
const SERVER_ERROR_WAITS_SEC = [5, 15];
const RATE_LIMIT_WAIT_SEC = 5;

// ---- query ----

/** Keeps a point only once it is `minM` from the last kept one, and the last point always. */
export function simplify(
  line: readonly Position3[],
  minM: number,
): Position3[] {
  const kept: Position3[] = [];
  for (const p of line) {
    const last = kept.at(-1);
    if (!last || haversineM(last, p) >= minM) kept.push(p);
  }
  const end = line.at(-1);
  if (end && kept.at(-1) !== end) kept.push(end);
  return kept;
}

/** One combined query for every kind we offer. Waterways keep their geometry. */
export function queryFor(line: readonly Position3[], marginM: number): string {
  const pts = simplify(line, Math.max(100, marginM / 4))
    .map(([lng, lat]) => `${lat.toFixed(5)},${lng.toFixed(5)}`)
    .join(",");
  const near = `(around:${Math.round(marginM)},${pts})`;
  return `[out:json][timeout:${SERVER_TIMEOUT_SEC}];
(
  nwr${near}["amenity"~"^(drinking_water|restaurant|cafe|fast_food)$"];
  nwr${near}["man_made"="water_tap"];
  nwr${near}["drinking_water"="yes"];
  nwr${near}["natural"="spring"];
  nwr${near}["natural"="water"]["water"~"^(lake|pond)$"];
  node${near}["waterway"="waterfall"];
  nwr${near}["tourism"="picnic_site"];
  nwr${near}["leisure"="picnic_table"];
  nwr${near}["shop"~"^(supermarket|convenience|bakery)$"];
)->.points;
way${near}["waterway"~"^(stream|river)$"]->.lines;
.points out tags center;
.lines out tags geom;`;
}

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

export function createOverpassPois(
  deps: { http?: HttpOptions; endpoint?: string } = {},
): PoiPort {
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

  async function fetchCorridor(query: string): Promise<Result<RawPoi[]>> {
    for (let attempt = 0; ; attempt++) {
      const res = await requestJson(
        endpoint,
        { method: "POST", body: new URLSearchParams({ data: query }) },
        { timeoutMs: REQUEST_CAP_MS, ...deps.http, retries: 0 },
      );
      if (!res.ok) {
        // A timeout is not retried: the server was already too slow once.
        const wait =
          res.error.kind === "rate-limit"
            ? (res.error.retryAfterSec ?? RATE_LIMIT_WAIT_SEC)
            : res.error.kind === "unavailable"
              ? SERVER_ERROR_WAITS_SEC[attempt]
              : undefined;
        if (wait === undefined || attempt >= SERVER_ERROR_WAITS_SEC.length) {
          return res;
        }
        await sleep(wait * 1000);
        continue;
      }
      const body = Response.safeParse(res.value);
      // A busy server answers 200 with a remark and a partial list.
      if (!body.success || body.data.remark?.includes("runtime error")) {
        return err({
          kind: "unavailable",
          message: "Overpass could not answer this area",
        });
      }
      return ok(body.data.elements.flatMap((e) => toRawPoi(e) ?? []));
    }
  }

  return {
    near: ({ line, marginM }) =>
      inQueue(() => fetchCorridor(queryFor(line, marginM))),
  };
}
