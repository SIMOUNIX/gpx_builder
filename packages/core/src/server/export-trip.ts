import { buildDerivedFiles } from "../browser/derived";
import type { Position3 } from "../browser/geo";
import type { RouteId, TripId } from "../browser/ids";
import { err, ok, type Result, type StoreError } from "../browser/result";
import type { TripStorePort } from "./ports";

/**
 * Writes the trip's GPX files: load the trip, read each routed stage's
 * geometry, build the files, write them. Returns the paths written, or an
 * empty list when the trip has no stages. Refuses (writes nothing, `unrouted`
 * with the stage ids) when any stage has no route. Stops at the first store error.
 */
export function exportTrip(
  store: TripStorePort,
  tripId: TripId,
): Result<string[], StoreError> {
  const loaded = store.load(tripId);
  if (!loaded.ok) return loaded;
  const trip = loaded.value;

  const unrouted = trip.stages.filter((s) => !s.routeId).map((s) => s.id);
  if (unrouted.length > 0) {
    return err({
      kind: "unrouted",
      message: `route these stages first: ${unrouted.join(", ")}`,
      stageIds: unrouted,
    });
  }

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
