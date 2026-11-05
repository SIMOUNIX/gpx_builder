import { tool } from "ai";
import { z } from "zod";
import { StageId, applyRoutedStage } from "@gpx-builder/core/server";
import type { AgentDeps } from "../deps";
import { failAdapter, failIssues, failStore } from "../results";

const PROFILE = "foot-hiking";

export const route = (deps: AgentDeps) =>
  tool({
    description:
      "Route one stage on real paths and measure it. Returns distance (km), ascent and descent (metres) and a routeId. Check the numbers against the brief yourself.",
    inputSchema: z.object({ stageId: StageId }),
    async execute({ stageId }) {
      const loaded = deps.trips.load(deps.tripId);
      if (!loaded.ok) return failStore(loaded.error);
      const trip = loaded.value;

      const stage = trip.stages.find((s) => s.id === stageId);
      if (!stage) {
        return failIssues([
          { path: "stageId", message: `unknown stage ${stageId}` },
        ]);
      }

      // Coordinates stay on this side: the model only ever saw ids and labels.
      const points = [stage.from, ...stage.via, stage.to].map(
        (id) => trip.waypoints[id]?.lngLat,
      );
      const waypoints = points.flatMap((p) => (p ? [p] : []));
      if (waypoints.length !== points.length) {
        return {
          ok: false as const,
          error: `stage ${stageId} has a waypoint missing from the trip`,
        };
      }

      const routed = await deps.routing.route({ waypoints, profile: PROFILE });
      if (!routed.ok) return failAdapter(routed.error);

      const written = deps.trips.writeRoute(deps.tripId, routed.value.line);
      if (!written.ok) return failStore(written.error);

      const next = applyRoutedStage(trip, stageId, routed.value, written.value);
      const saved = deps.trips.save(next);
      if (!saved.ok) return failStore(saved.error);

      const { km, gainM, lossM } = next.stages.find(
        (s) => s.id === stageId,
      )!.stats!;
      return {
        ok: true as const,
        stageId,
        routeId: written.value,
        km,
        gainM,
        lossM,
      };
    },
  });
