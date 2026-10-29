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

export type RouteLeg = {
  line: Position3[];
  distanceM: number;
  /** How far each input waypoint moved to reach the path network. */
  snapDistancesM: number[];
};

export interface RoutingPort {
  capabilities: { maxWaypoints: number; profiles: string[] };
  route(q: { waypoints: LngLat[]; profile: string }): Promise<Result<RouteLeg>>;
}

export interface SecretsPort {
  get(name: string): Promise<string | undefined>;
}
