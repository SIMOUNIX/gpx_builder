import { expect, test } from "bun:test";
import {
  mintChatId,
  mintStageId,
  mintTripId,
  mintWaypointId,
  PlaceId,
  PoiId,
  RouteId,
  TripId,
} from "./ids";

test("minted ids parse and carry their prefix", () => {
  expect(mintTripId().startsWith("trip_")).toBe(true);
  expect(mintChatId().startsWith("chat_")).toBe(true);
  expect(mintStageId(2)).toMatch(/^stage_2_/);
  expect(mintWaypointId()).toMatch(/^wp_/);
});

test("ids reject the wrong shape", () => {
  expect(TripId.safeParse("trip_not-a-uuid").success).toBe(false);
  expect(TripId.safeParse(`chat_${crypto.randomUUID()}`).success).toBe(false);
  expect(PlaceId.safeParse("geo:ign:abc").success).toBe(true);
  expect(PoiId.safeParse("osm:node/123").success).toBe(true);
  expect(PoiId.safeParse("osm:thing/123").success).toBe(false);
  expect(RouteId.safeParse("route_0123456789abcdef").success).toBe(true);
  expect(RouteId.safeParse("route_xyz").success).toBe(false);
});
