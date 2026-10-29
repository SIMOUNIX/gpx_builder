import { z } from "zod";
import { LngLat } from "./geo";
import { PlaceId } from "./ids";

const Endpoint = z.object({ placeId: PlaceId, publicTransport: z.boolean() });

export const OvernightKind = z.enum(["camp", "shelter", "hut", "gite"]);
export type OvernightKind = z.infer<typeof OvernightKind>;

export const Brief = z.object({
  days: z.int().positive(),
  maxKmPerDay: z.number().positive(),
  maxGainPerDay: z.number().nonnegative(),
  start: Endpoint,
  end: Endpoint,
  overnight: z.enum([...OvernightKind.options, "any"]),
  travel: z.object({
    from: PlaceId,
    modes: z.array(z.enum(["train", "car", "bus", "any"])).min(1),
    maxOneWayHours: z.number().positive(),
  }),
  startDate: z.iso.date().optional(),
  maxWaterGapKm: z.number().positive().optional(),
  season: z.enum(["spring", "summer", "autumn", "winter"]).optional(),
  fitness: z.enum(["low", "medium", "high"]).optional(),
  notes: z.string().optional(),
});
export type Brief = z.infer<typeof Brief>;

/** What the trip stores while the brief is still being gathered. */
export const BriefDraft = Brief.partial();
export type BriefDraft = z.infer<typeof BriefDraft>;

/** Global setting; each Brief's `travel.from` defaults to it. Lives in settings.json (owned by store). */
export const HomePlace = z.object({
  placeId: PlaceId,
  label: z.string(),
  lngLat: LngLat,
});
export type HomePlace = z.infer<typeof HomePlace>;
