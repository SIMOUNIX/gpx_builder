import type { LngLat, PlaceId, Position3, Result } from "../browser/index";

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

export interface SecretsPort {
  get(name: string): Promise<string | undefined>;
}
