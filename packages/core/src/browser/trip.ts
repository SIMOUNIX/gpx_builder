import { z } from "zod";
import { BriefDraft, OvernightKind } from "./brief";
import { LngLat } from "./geo";
import {
  ChatId,
  PlaceId,
  PoiId,
  RouteId,
  StageId,
  TripId,
  WaypointId,
} from "./ids";
import { WaterTier } from "./poi";

export const Waypoint = z.object({
  id: WaypointId,
  kind: z.enum(["place", "poi", "user", "snap"]),
  ref: z.union([PlaceId, PoiId]).optional(),
  lngLat: LngLat, // only ever in trip.json, never in model context
  label: z.string(),
});
export type Waypoint = z.infer<typeof Waypoint>;

export const Stage = z.object({
  id: StageId,
  from: WaypointId,
  to: WaypointId,
  via: z.array(WaypointId),
  overnight: OvernightKind.optional(),
  routeId: RouteId.optional(),
  /** Written by the trip service when the stage is routed. */
  stats: z
    .object({
      km: z.number(),
      gainM: z.number(),
      lossM: z.number(),
      /** DIN 33466 estimate; absent on stages routed before it existed. */
      walkingMin: z.number().optional(),
    })
    .optional(),
  /** One per waypoint, in the order [from, ...via, to]: how far the router moved it onto a path. */
  snapDistancesM: z.array(z.number()).optional(),
});
export type Stage = z.infer<typeof Stage>;

export const Trip = z.object({
  v: z.literal(1),
  tripId: TripId,
  chatId: ChatId.optional(),
  name: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  brief: BriefDraft,
  stages: z.array(Stage),
  waypoints: z.record(WaypointId, Waypoint),
  /** Everything an id the model saw once still resolves to. */
  registry: z.object({
    places: z.record(
      PlaceId,
      z.object({ label: z.string(), kind: z.string(), lngLat: LngLat }),
    ),
    pois: z.record(
      PoiId,
      z.object({
        name: z.string(),
        kind: z.string(),
        /** Water only. */
        tier: z.enum(WaterTier).optional(),
        lngLat: LngLat,
      }),
    ),
  }),
});
export type Trip = z.infer<typeof Trip>;
