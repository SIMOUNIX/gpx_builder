import { z } from "zod";
import {
  PlaceId,
  err,
  ok,
  type CachePort,
  type GeocodeCandidate,
  type GeocodePort,
} from "@gpx-builder/core/server";
import { requestJson, type HttpOptions } from "./http";

const BASE_URL = "https://photon.komoot.io/api/";
export const GEOCODE_TTL_SEC = 30 * 24 * 3600;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

const Feature = z.object({
  geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
  properties: z.object({
    osm_type: z.enum(["N", "W", "R"]),
    osm_id: z.number(),
    osm_key: z.string(),
    osm_value: z.string(),
    name: z.string().optional(),
    street: z.string().optional(),
    housenumber: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
  }),
});
const Response = z.object({ features: z.array(z.unknown()) });

const OSM_TYPE = { N: "node", W: "way", R: "relation" } as const;

/** Maps one Photon feature; features we can't name or id are dropped. */
function toCandidate(raw: unknown): GeocodeCandidate | undefined {
  const f = Feature.safeParse(raw);
  if (!f.success) return undefined;
  const p = f.data.properties;
  const head =
    p.name ?? [p.street, p.housenumber].filter(Boolean).join(" ") ?? "";
  if (head === "") return undefined;
  const label = [...new Set([head, p.city, p.state, p.country])]
    .filter(Boolean)
    .join(", ");
  const placeId = PlaceId.safeParse(
    `geo:photon:${OSM_TYPE[p.osm_type]}/${p.osm_id}`,
  );
  if (!placeId.success) return undefined;
  return {
    placeId: placeId.data,
    label,
    kind: `${p.osm_key}=${p.osm_value}`,
    lngLat: f.data.geometry.coordinates,
  };
}

export function createPhotonGeocoder(deps: {
  cache: CachePort;
  http?: HttpOptions;
  baseUrl?: string;
}): GeocodePort {
  const base = deps.baseUrl ?? BASE_URL;
  return {
    async search({ query, nearHint, limit }) {
      const q = query.trim();
      if (q === "") return err({ kind: "invalid", message: "empty query" });
      const n = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

      const url = new URL(base);
      url.searchParams.set("q", q);
      url.searchParams.set("limit", String(n));
      if (nearHint) {
        url.searchParams.set("lon", String(nearHint[0]));
        url.searchParams.set("lat", String(nearHint[1]));
      }

      const key = `photon:v1:${url.search.toLowerCase()}`;
      const hit = deps.cache.get(key);
      if (hit !== undefined) {
        try {
          return ok(JSON.parse(hit) as GeocodeCandidate[]);
        } catch {
          // damaged entry: fall through and ask again
        }
      }

      const res = await requestJson(url.toString(), {}, deps.http);
      if (!res.ok) return res;
      const body = Response.safeParse(res.value);
      if (!body.success) {
        return err({
          kind: "unavailable",
          message: "unexpected Photon answer",
        });
      }
      const found = body.data.features.flatMap((f) => toCandidate(f) ?? []);
      deps.cache.set(key, JSON.stringify(found), GEOCODE_TTL_SEC);
      return ok(found);
    },
  };
}
