import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { TripId } from "@gpx-builder/core/browser";
import { setBackend } from "./backend";

setBackend({ url: "http://127.0.0.1:1", token: "t" });
const { invalidateTrip, trpc } = await import("./api");

const a = TripId.parse("trip_3b6f0c2a-3a52-4b8e-9d3f-1b6f0c2a7e11");
const b = TripId.parse("trip_4b6f0c2a-3a52-4b8e-9d3f-1b6f0c2a7e11");

test("invalidateTrip marks that trip's queries and the list stale, not another trip's", async () => {
  const qc = new QueryClient();
  const keys = {
    list: trpc.trips.list.queryKey(),
    get: trpc.trips.get.queryKey({ tripId: a }),
    route: trpc.trips.route.queryKey({ tripId: a }),
    chat: trpc.chats.messages.queryKey({ tripId: a }),
    other: trpc.trips.get.queryKey({ tripId: b }),
  };
  for (const k of Object.values(keys)) qc.setQueryData<unknown>(k, null);
  await invalidateTrip(qc, a);
  const stale = (k: readonly unknown[]) => qc.getQueryState(k)?.isInvalidated;
  expect([keys.list, keys.get, keys.route, keys.chat].map(stale)).toEqual([
    true,
    true,
    true,
    true,
  ]);
  expect(stale(keys.other)).toBe(false);
});
