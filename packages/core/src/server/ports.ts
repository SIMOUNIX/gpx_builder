import type {
  LngLat,
  PlaceId,
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

/** Owns the trip folders on disk. Synchronous: one process, one writer. */
export interface TripStorePort {
  create(trip: Trip): Result<void, StoreError>;
  load(tripId: TripId): Result<Trip, StoreError>;
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

export interface SecretsPort {
  get(name: string): Promise<string | undefined>;
}
