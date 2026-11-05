import { tool } from "ai";
import { z } from "zod";
import { Brief, BriefDraft, type PlaceId } from "@gpx-builder/core/server";
import type { AgentDeps } from "../deps";
import { failIssues, failStore, type Issue } from "../results";

/** Top-level brief fields still missing. */
const missingOf = (brief: BriefDraft): string[] => {
  const parsed = Brief.safeParse(brief);
  return parsed.success
    ? []
    : [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
};

export const submitBrief = (deps: AgentDeps) =>
  tool({
    description:
      "Save what you know of the brief. Send only the fields the user has given you: they are merged into what is already stored, and the answer lists what is still missing. Every placeId must come from find_place. Optionally name the trip.",
    inputSchema: z.object({
      brief: BriefDraft,
      name: z.string().min(1).optional(),
    }),
    async execute({ brief, name }) {
      const loaded = deps.trips.load(deps.tripId);
      if (!loaded.ok) return failStore(loaded.error);
      const trip = loaded.value;

      const unknown: [string, PlaceId | undefined][] = [
        ["brief.start.placeId", brief.start?.placeId],
        ["brief.end.placeId", brief.end?.placeId],
        ["brief.travel.from", brief.travel?.from],
      ];
      const issues: Issue[] = unknown.flatMap(([path, id]) =>
        id !== undefined && !trip.registry.places[id]
          ? [{ path, message: `unknown placeId ${id}: call find_place first` }]
          : [],
      );
      if (issues.length > 0) return failIssues(issues);

      const merged: BriefDraft = { ...trip.brief, ...brief };
      const saved = deps.trips.save({
        ...trip,
        name: name ?? trip.name,
        brief: merged,
      });
      if (!saved.ok) return failStore(saved.error);

      const missing = missingOf(merged);
      return { ok: true as const, complete: missing.length === 0, missing };
    },
  });
