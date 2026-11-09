import { z } from "zod";

// Prefixed ids: the kind is visible in logs and in the model's context.

const uuidId = (prefix: string) =>
  z
    .string()
    .refine(
      (s) =>
        s.startsWith(`${prefix}_`) &&
        z.uuid().safeParse(s.slice(prefix.length + 1)).success,
      `expected ${prefix}_<uuid>`,
    );

export const TripId = uuidId("trip").brand<"TripId">();
export type TripId = z.infer<typeof TripId>;

export const ChatId = uuidId("chat").brand<"ChatId">();
export type ChatId = z.infer<typeof ChatId>;

export const StageId = z
  .string()
  .regex(/^stage_\d+_[0-9a-f]{8}$/)
  .brand<"StageId">();
export type StageId = z.infer<typeof StageId>;

export const PlaceId = z
  .string()
  .regex(/^geo:[a-z0-9-]+:.+$/)
  .brand<"PlaceId">();
export type PlaceId = z.infer<typeof PlaceId>;

export const PoiId = z
  .string()
  .regex(/^osm:(node|way|relation)\/\d+$/)
  .brand<"PoiId">();
export type PoiId = z.infer<typeof PoiId>;

export const WaypointId = z
  .string()
  .regex(/^wp_[0-9a-f]{8}$/)
  .brand<"WaypointId">();
export type WaypointId = z.infer<typeof WaypointId>;

// Format only: store computes the hash of the written geometry file.
export const RouteId = z
  .string()
  .regex(/^route_[0-9a-f]{16}$/)
  .brand<"RouteId">();
export type RouteId = z.infer<typeof RouteId>;

const short = () => crypto.randomUUID().slice(0, 8);

export const mintTripId = () => TripId.parse(`trip_${crypto.randomUUID()}`);
export const mintChatId = () => ChatId.parse(`chat_${crypto.randomUUID()}`);
export const chatIdOf = (tripId: TripId): ChatId =>
  ChatId.parse(`chat_${tripId.slice("trip_".length)}`);
export const mintStageId = (n: number) =>
  StageId.parse(`stage_${n}_${short()}`);
export const mintWaypointId = () => WaypointId.parse(`wp_${short()}`);
