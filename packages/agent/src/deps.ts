import type {
  GeocodePort,
  PoiPort,
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
  pois: PoiPort;
};
