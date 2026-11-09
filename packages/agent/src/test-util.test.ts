import { expect, test } from "bun:test";
import { emptyTrip, memoryChats, memoryTrips } from "./test-util";

test("memoryTrips behaves like a store", () => {
  const { store, trip } = memoryTrips(emptyTrip());
  const id = trip().tripId;
  expect(store.create(trip()).ok).toBe(true);
  expect(store.list()).toMatchObject({ ok: true, value: [{ id }] });
  const line = [
    [0, 0, 0],
    [1, 1, 1],
  ] as never;
  const written = store.writeRoute(id, line);
  if (!written.ok) throw new Error("writeRoute failed");
  const routeId = written.value;
  expect(store.readRoute(id, routeId)).toEqual({ ok: true, value: line });
  expect(store.readRoute(id, "route_0000000000000000" as never).ok).toBe(false);
  expect(store.delete(id).ok).toBe(true);
});

test("memoryChats appends, loads and reports an empty chat", () => {
  const chats = memoryChats();
  expect(chats.load("chat_x" as never).ok).toBe(false);
  chats.append("chat_x" as never, { id: "m" } as never);
  expect(chats.all()).toHaveLength(1);
  expect(chats.load("chat_x" as never).ok).toBe(true);
});
