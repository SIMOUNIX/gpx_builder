import { tool } from "ai";
import { z } from "zod";
import {
  Brief,
  OvernightKind,
  PlaceId,
  mintStageId,
  mintWaypointId,
  type Stage,
  type Waypoint,
  type WaypointId,
} from "@gpx-builder/core/server";
import type { AgentDeps } from "../deps";
import { failIssues, failStore, type Issue } from "../results";

export const submitItinerary = (deps: AgentDeps) =>
  tool({
    description:
      "Set the whole itinerary: one entry per day, in order, each going from a place to a place (optionally through `via` places). It replaces any earlier itinerary. Every placeId must come from find_place. Returns the stage ids to route.",
    inputSchema: z.object({
      stages: z
        .array(
          z.object({
            from: PlaceId,
            to: PlaceId,
            via: z.array(PlaceId).optional(),
            overnight: OvernightKind.optional(),
          }),
        )
        .min(1),
    }),
    async execute({ stages }) {
      const loaded = deps.trips.load(deps.tripId);
      if (!loaded.ok) return failStore(loaded.error);
      const trip = loaded.value;

      if (!Brief.safeParse(trip.brief).success) {
        return {
          ok: false as const,
          error: "the brief is incomplete: finish it with submit_brief first",
        };
      }

      const issues: Issue[] = [];
      stages.forEach((s, i) => {
        const refs: [string, PlaceId][] = [
          [`stages.${i}.from`, s.from],
          [`stages.${i}.to`, s.to],
          ...(s.via ?? []).map((v, j): [string, PlaceId] => [
            `stages.${i}.via.${j}`,
            v,
          ]),
        ];
        for (const [path, id] of refs) {
          if (!trip.registry.places[id]) {
            issues.push({
              path,
              message: `unknown placeId ${id}: call find_place first`,
            });
          }
        }
      });
      if (issues.length > 0) return failIssues(issues);

      // One waypoint per place, shared by the stages that meet there.
      const waypoints: Record<WaypointId, Waypoint> = {};
      const byPlace = new Map<PlaceId, WaypointId>();
      const waypointOf = (placeId: PlaceId): WaypointId => {
        const known = byPlace.get(placeId);
        if (known) return known;
        const place = trip.registry.places[placeId]!; // checked above
        const id = mintWaypointId();
        waypoints[id] = {
          id,
          kind: "place",
          ref: placeId,
          lngLat: place.lngLat,
          label: place.label,
        };
        byPlace.set(placeId, id);
        return id;
      };

      const built: Stage[] = stages.map((s, i) => ({
        id: mintStageId(i + 1),
        from: waypointOf(s.from),
        to: waypointOf(s.to),
        via: (s.via ?? []).map(waypointOf),
        overnight: s.overnight,
      }));

      const saved = deps.trips.save({ ...trip, stages: built, waypoints });
      if (!saved.ok) return failStore(saved.error);

      return {
        ok: true as const,
        stages: built.map((s, i) => ({
          stageId: s.id,
          from: stages[i]!.from,
          to: stages[i]!.to,
        })),
      };
    },
  });
