import {
  mintTripId,
  type ChatMessage,
  type LngLat,
  type Trip,
  type TripId,
} from "@gpx-builder/core/browser";
import { mockChat, mockRoute, mockTrips } from "./fixtures/trips";

// The only place components get server data from; M2 swaps the bodies for tRPC calls.
// In-memory so sending a message works in the browser mock.
const trips = [...mockTrips];
const chats = new Map(
  trips.map((t) => [t.tripId, mockChat(t) as ChatMessage[]]),
);

const userMessage = (text: string): ChatMessage => ({
  id: crypto.randomUUID(),
  role: "user",
  createdAt: new Date().toISOString(),
  parts: [{ type: "text", text }],
});

export const api = {
  /** Most recent first. */
  listTrips: async (): Promise<Trip[]> =>
    [...trips].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  getTrip: async (id: TripId): Promise<Trip | undefined> =>
    trips.find((t) => t.tripId === id),
  getChat: async (id: TripId): Promise<ChatMessage[]> => chats.get(id) ?? [],
  getRoute: async (id: TripId): Promise<LngLat[]> => {
    const trip = trips.find((t) => t.tripId === id);
    return trip ? mockRoute(trip) : [];
  },
  sendMessage: async (id: TripId, text: string) => {
    chats.set(id, [...(chats.get(id) ?? []), userMessage(text)]);
  },
  createTrip: async (text: string): Promise<Trip> => {
    const now = new Date().toISOString();
    const trip: Trip = {
      v: 1,
      tripId: mintTripId(),
      name: text.slice(0, 40),
      createdAt: now,
      updatedAt: now,
      brief: {},
      stages: [],
      waypoints: {},
      registry: { places: {}, pois: {} },
    };
    trips.push(trip);
    chats.set(trip.tripId, [userMessage(text)]);
    return trip;
  },
};
