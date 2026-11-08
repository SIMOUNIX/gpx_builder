import { tool } from "ai";
import { z } from "zod";
import { PlaceId } from "@gpx-builder/core/server";
import type { AgentDeps } from "../deps";
import { failAdapter, failIssues, failStore } from "../results";

export const findPlace = (deps: AgentDeps) =>
  tool({
    description:
      "Look up a place by name (town, station, hut, peak, trailhead). Returns candidates with a placeId; use those ids everywhere else. Coordinates are never shown. Pass `nearHint`, a placeId you already have, to prefer results close to it.",
    inputSchema: z.object({
      query: z.string().min(1),
      nearHint: PlaceId.optional(),
    }),
    async execute({ query, nearHint }) {
      const loaded = deps.trips.load(deps.tripId);
      if (!loaded.ok) return failStore(loaded.error);
      const trip = loaded.value;

      let near: [number, number] | undefined;
      if (nearHint !== undefined) {
        near = trip.registry.places[nearHint]?.lngLat;
        if (!near) {
          return failIssues([
            { path: "nearHint", message: `unknown placeId ${nearHint}` },
          ]);
        }
      }

      const found = await deps.geocode.search({ query, nearHint: near });
      if (!found.ok) return failAdapter(found.error);

      // Parallel tool calls in one step share the trip file: reload after the
      // await and save with no await in between, or the last stale save wins.
      const fresh = deps.trips.load(deps.tripId);
      if (!fresh.ok) return failStore(fresh.error);

      // Remember every id the model is shown, so it still resolves in later turns.
      const places = { ...fresh.value.registry.places };
      for (const c of found.value) {
        places[c.placeId] = { label: c.label, kind: c.kind, lngLat: c.lngLat };
      }
      const saved = deps.trips.save({
        ...fresh.value,
        registry: { ...fresh.value.registry, places },
      });
      if (!saved.ok) return failStore(saved.error);

      return {
        ok: true as const,
        candidates: found.value.map(({ placeId, label, kind }) => ({
          placeId,
          label,
          kind,
        })),
      };
    },
  });
