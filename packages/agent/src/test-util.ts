import { createHash } from "node:crypto";
import {
  RouteId,
  err,
  mintTripId,
  ok,
  type GeocodeCandidate,
  type GeocodePort,
  type Position3,
  type RoutedStage,
  type RoutingPort,
  type Trip,
  type TripStorePort,
} from "@gpx-builder/core/server";
import type { AgentDeps } from "./deps";

/** In-memory store: the agent only knows the port, never the real one. */
export function memoryTrips(initial: Trip) {
  let trip = initial;
  const routes = new Map<string, Position3[]>();
  const derived: Record<string, string> = {};
  const store: TripStorePort = {
    create: () => ok(undefined),
    load: () => ok(trip),
    save: (t) => {
      trip = t;
      return ok(undefined);
    },
    writeRoute: (_id, line) => {
      const id = RouteId.parse(
        `route_${createHash("sha256").update(JSON.stringify(line)).digest("hex").slice(0, 16)}`,
      );
      routes.set(id, line);
      return ok(id);
    },
    readRoute: (_t, id) => {
      const line = routes.get(id);
      return line
        ? ok(line)
        : err({ kind: "not-found", message: `no route ${id}` });
    },
    writeDerived: (_t, files) => {
      Object.assign(derived, files);
      return ok(Object.keys(files).map((n) => `/trip/${n}`));
    },
  };
  return { store, trip: () => trip, derived };
}

export const emptyTrip = (): Trip => ({
  v: 1,
  tripId: mintTripId(),
  name: "Untitled trip",
  createdAt: "2026-11-04T10:00:00.000Z",
  updatedAt: "2026-11-04T10:00:00.000Z",
  brief: {},
  stages: [],
  waypoints: {},
  registry: { places: {}, pois: {} },
});

export const fakeGeocode = (
  candidates: GeocodeCandidate[],
): GeocodePort & { calls: unknown[] } => {
  const calls: unknown[] = [];
  return {
    calls,
    async search(q) {
      calls.push(q);
      return ok(candidates);
    },
  };
};

export const fakeRouting = (
  routed: RoutedStage,
): RoutingPort & { calls: unknown[] } => {
  const calls: unknown[] = [];
  return {
    calls,
    capabilities: { maxWaypoints: 50, profiles: ["foot-hiking"] },
    async route(q) {
      calls.push(q);
      return ok(routed);
    },
  };
};

export const depsFor = (
  trips: ReturnType<typeof memoryTrips>,
  geocode: GeocodePort,
  routing: RoutingPort,
): AgentDeps => ({
  tripId: trips.trip().tripId,
  trips: trips.store,
  geocode,
  routing,
});

/** Calls a tool's `execute` the way the loop would. */
export const run = async <T>(
  t: { execute?: (input: never, options: never) => unknown },
  input: unknown,
): Promise<T> =>
  (await t.execute!(
    input as never,
    { toolCallId: "t1", messages: [] } as never,
  )) as T;
