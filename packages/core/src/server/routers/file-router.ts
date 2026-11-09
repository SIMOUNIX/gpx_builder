import {
  chatIdOf,
  mintTripId,
  type Position3,
  type StageId,
  type Trip,
  type TripId,
} from "../../browser/index";
import { exportTrip } from "../export-trip";
import { fail, t, tripInput, type AppRouterDeps } from "./base";

/** Trips and their files: create, read, geometry, export. No LLM involved. */
export function createFileRouter({ trips, now }: AppRouterDeps) {
  const load = (tripId: TripId): Trip => {
    const r = trips.load(tripId);
    return r.ok ? r.value : fail(r.error);
  };

  return t.router({
    trips: t.router({
      /** Every readable trip, most recently updated first. */
      list: t.procedure.query((): Trip[] => {
        const listed = trips.list();
        if (!listed.ok) return fail(listed.error);
        return listed.value.flatMap(({ id }) => {
          const r = trips.load(id);
          return r.ok ? [r.value] : []; // went away between list and load
        });
      }),
      get: t.procedure
        .input(tripInput)
        .query(({ input }) => load(input.tripId)),
      /** An empty "Untitled trip"; its chat shares its uuid. */
      create: t.procedure.mutation((): Trip => {
        const at = (now?.() ?? new Date()).toISOString();
        const tripId = mintTripId();
        const trip: Trip = {
          v: 1,
          tripId,
          chatId: chatIdOf(tripId),
          name: "Untitled trip",
          createdAt: at,
          updatedAt: at,
          brief: {},
          stages: [],
          waypoints: {},
          registry: { places: {}, pois: {} },
        };
        const r = trips.create(trip);
        return r.ok ? trip : fail(r.error);
      }),
      /** Geometry of each routed stage, in stage order. */
      route: t.procedure
        .input(tripInput)
        .query(({ input }): { stageId: StageId; line: Position3[] }[] =>
          load(input.tripId).stages.flatMap((s) => {
            if (!s.routeId) return [];
            const r = trips.readRoute(input.tripId, s.routeId);
            return r.ok ? [{ stageId: s.id, line: r.value }] : fail(r.error);
          }),
        ),
      /** Writes the GPX files; the user pressed export, so no y/N. Returns the paths. */
      export: t.procedure.input(tripInput).mutation(({ input }): string[] => {
        const r = exportTrip(trips, input.tripId);
        return r.ok ? r.value : fail(r.error);
      }),
    }),
  });
}
