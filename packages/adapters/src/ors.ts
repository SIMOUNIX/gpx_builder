import { createHash } from "node:crypto";
import { z } from "zod";
import {
  err,
  haversineM,
  ok,
  type AdapterError,
  type CachePort,
  type RoutedStage,
  type RoutingPort,
} from "@gpx-builder/core/server";
import { requestJson, type Classify, type HttpOptions } from "./http";

const BASE_URL = "https://api.openrouteservice.org";
export const ROUTE_TTL_SEC = 7 * 24 * 3600;
/**
 * How far ORS may move a waypoint to reach a path (its default is 350 m, and a
 * point farther away fails outright). Wide on purpose: routing succeeds and the
 * snap distance tells us when a jump was suspicious.
 */
export const SNAP_RADIUS_M = 1000;
export const MAX_WAYPOINTS = 50;
const PROFILES = ["foot-hiking", "foot-walking"];

const Response = z.object({
  features: z
    .array(
      z.object({
        geometry: z.object({
          coordinates: z.array(z.tuple([z.number(), z.number(), z.number()])),
        }),
        properties: z.object({
          summary: z.object({ distance: z.number() }),
          way_points: z.array(z.number().int()),
        }),
      }),
    )
    .min(1),
});

// Codes from the ORS error-code page; HTTP status covers whatever they leave out.
const classify: Classify = (status, body) => {
  const error = (body as { error?: unknown } | undefined)?.error;
  const code =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown }).code
      : undefined;
  const message =
    typeof error === "object" && error !== null
      ? String((error as { message?: unknown }).message ?? `HTTP ${status}`)
      : typeof error === "string"
        ? error
        : `HTTP ${status}`;
  const as = (kind: AdapterError["kind"], m = message): AdapterError => ({
    kind,
    message: m,
  });
  if (code === 2009 || code === 2010) return as("not-found");
  if (typeof code === "number" && code >= 2000 && code <= 2008)
    return as("invalid");
  if (code === 2099) return as("unavailable");
  if (status === 401 || status === 403)
    return as("unavailable", `${message} (check ORS_API_KEY)`);
  return undefined; // generic status mapping
};

export function createOrsRouter(deps: {
  apiKey: string;
  cache: CachePort;
  http?: HttpOptions;
  baseUrl?: string;
}): RoutingPort {
  const base = deps.baseUrl ?? BASE_URL;
  return {
    capabilities: { maxWaypoints: MAX_WAYPOINTS, profiles: PROFILES },

    async route({ waypoints, profile }) {
      if (!PROFILES.includes(profile)) {
        return err({ kind: "invalid", message: `unknown profile ${profile}` });
      }
      if (waypoints.length < 2 || waypoints.length > MAX_WAYPOINTS) {
        return err({
          kind: "invalid",
          message: `a stage needs 2 to ${MAX_WAYPOINTS} waypoints, got ${waypoints.length}`,
        });
      }

      const rounded = waypoints.map(
        ([lng, lat]) => [+lng.toFixed(6), +lat.toFixed(6)] as const,
      );
      const key = `ors:v1:${createHash("sha256")
        .update(JSON.stringify([profile, rounded]))
        .digest("hex")}`;
      const hit = deps.cache.get(key);
      if (hit !== undefined) {
        try {
          return ok(JSON.parse(hit) as RoutedStage);
        } catch {
          // damaged entry: fall through and ask again
        }
      }

      const res = await requestJson(
        `${base}/v2/directions/${profile}/geojson`,
        {
          method: "POST",
          headers: {
            Authorization: deps.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            coordinates: rounded,
            elevation: true,
            instructions: false,
            radiuses: rounded.map(() => SNAP_RADIUS_M),
          }),
        },
        { ...deps.http, classify },
      );
      if (!res.ok) return res;

      const parsed = Response.safeParse(res.value);
      const feature = parsed.success ? parsed.data.features[0] : undefined;
      const line = feature?.geometry.coordinates;
      const wayPoints = feature?.properties.way_points;
      if (
        !feature ||
        !line ||
        !wayPoints ||
        wayPoints.length !== waypoints.length ||
        wayPoints.some((i) => line[i] === undefined)
      ) {
        return err({ kind: "unavailable", message: "unexpected ORS answer" });
      }

      const routed: RoutedStage = {
        line,
        distanceM: feature.properties.summary.distance,
        snapDistancesM: waypoints.map((w, i) =>
          haversineM(w, line[wayPoints[i]!]!),
        ),
      };
      deps.cache.set(key, JSON.stringify(routed), ROUTE_TTL_SEC);
      return ok(routed);
    },
  };
}
