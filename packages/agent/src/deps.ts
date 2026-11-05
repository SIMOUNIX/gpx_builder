import type {
  GeocodePort,
  RoutingPort,
  TripId,
  TripStorePort,
} from "@gpx-builder/core/server";

/** What the tools act on. The model never passes a trip id: the chat is bound to one trip. */
export type AgentDeps = {
  tripId: TripId;
  trips: TripStorePort;
  geocode: GeocodePort;
  routing: RoutingPort;
};
