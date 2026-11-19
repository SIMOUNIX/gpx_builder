import type {
  ChatId,
  ChatMessage,
  LngLat,
  PlaceId,
  PoiId,
  Position3,
  Result,
  RouteId,
  StoreError,
  Trip,
  TripId,
} from "../browser/index";

export type GeocodeCandidate = {
  placeId: PlaceId;
  label: string;
  kind: string;
  lngLat: LngLat;
};

export interface GeocodePort {
  search(q: {
    query: string;
    nearHint?: LngLat;
    limit?: number;
  }): Promise<Result<GeocodeCandidate[]>>;
}

/**
 * The router's answer for one whole stage: a single path through every waypoint
 * of the stage in order (from, via..., to), not one piece between two neighbours.
 * Represent one day of the trip.
 */
export type RoutedStage = {
  line: Position3[];
  distanceM: number;
  /** How far each input waypoint moved to reach the path network. In case the waypoint is not on a valid path. */
  snapDistancesM: number[];
};

export interface RoutingPort {
  capabilities: { maxWaypoints: number; profiles: string[] };
  route(q: {
    waypoints: LngLat[];
    profile: string;
  }): Promise<Result<RoutedStage>>;
}

/** One OSM element near a route, as the source reports it. Classification is core's job. */
export type RawPoi = {
  poiId: PoiId;
  tags: Record<string, string>;
  /** One point, or the vertices of a waterway. */
  geometry: LngLat[];
};

export interface PoiPort {
  /** Every element within `marginM` metres of the route. */
  near(q: { line: Position3[]; marginM: number }): Promise<Result<RawPoi[]>>;
}

/** Owns the trip folders on disk. Synchronous: one process, one writer. */
export interface TripStorePort {
  create(trip: Trip): Result<void, StoreError>;
  load(tripId: TripId): Result<Trip, StoreError>;
  /** Every readable trip, most recently updated first. Unreadable folders are skipped. */
  list(): Result<{ id: TripId; name: string; updatedAt: string }[], StoreError>;
  /** Removes the trip folder and everything in it. `not-found` when there is no such trip. */
  delete(tripId: TripId): Result<void, StoreError>;
  /** Stamps `updatedAt` and keeps the previous version as trip.prev.json. */
  save(trip: Trip): Result<void, StoreError>;
  writeRoute(tripId: TripId, line: Position3[]): Result<RouteId, StoreError>;
  readRoute(tripId: TripId, routeId: RouteId): Result<Position3[], StoreError>;
  /**
   * Writes { file name: content } into the trip folder and returns the paths
   * written. Names must be plain file names; trip.json and trip.prev.json are refused.
   */
  writeDerived(
    tripId: TripId,
    files: Record<string, string>,
  ): Result<string[], StoreError>;
}

/** Owns the chat transcripts on disk. Synchronous: one process, one writer. */
export interface ChatStorePort {
  /** Appends one message, creating the chat on its first message. Refuses a quarantined chat. */
  append(chatId: ChatId, message: ChatMessage): Result<void, StoreError>;
  /** `not-found` when the chat doesn't exist, `corrupt` when it was quarantined. */
  load(chatId: ChatId): Result<ChatMessage[], StoreError>;
}

/** Remembers text for a while. Synchronous like the stores; a miss is `undefined`. */
export interface CachePort {
  get(key: string): string | undefined;
  set(key: string, value: string, ttlSec: number): void;
}

export interface SecretsPort {
  get(name: string): Promise<string | undefined>;
}
