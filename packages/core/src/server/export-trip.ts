import { buildDerivedFiles } from "../browser/derived";
import type { Position3 } from "../browser/geo";
import type { RouteId, TripId } from "../browser/ids";
import { ok, type Result, type StoreError } from "../browser/result";
import type { TripStorePort } from "./ports";

/**
 * Writes the trip's GPX files: load the trip, read each routed stage's
 * geometry, build the files, write them. Returns the paths written, or an
 * empty list (and writes nothing) when no stage is routed yet. Stops at the
 * first store error.
 */
export function exportTrip(
  store: TripStorePort,
  tripId: TripId,
): Result<string[], StoreError> {
  const loaded = store.load(tripId);
  if (!loaded.ok) return loaded;
  const trip = loaded.value;

  const routes = new Map<RouteId, Position3[]>();
  for (const stage of trip.stages) {
    if (!stage.routeId || routes.has(stage.routeId)) continue;
    const route = store.readRoute(tripId, stage.routeId);
    if (!route.ok) return route;
    routes.set(stage.routeId, route.value);
  }

  const files = buildDerivedFiles(trip, routes);
  return Object.keys(files).length === 0
    ? ok([])
    : store.writeDerived(tripId, files);
}
