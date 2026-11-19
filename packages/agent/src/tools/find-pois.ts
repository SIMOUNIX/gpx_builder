import { tool } from "ai";
import { z } from "zod";
import {
  PoiKind,
  StageId,
  WaterTier,
  classifyPoi,
  detourAllowanceM,
  locateOnRoute,
  type PoiClass,
  type PoiId,
} from "@gpx-builder/core/server";
import type { AgentDeps } from "../deps";
import { failIssues, failStore } from "../results";

const PER_GROUP = 5;
const CORRIDOR_CAP_M = 500;

const WATER_LABEL: Record<WaterTier, string> = {
  potable: "Drinking water",
  treatable: "Natural water",
  unknown: "Water tap",
};

/** A POI without a name is still listed, by what it is. */
function labelOf(tags: Record<string, string>, c: PoiClass): string {
  if (tags.name) return tags.name;
  if (c.tier) return WATER_LABEL[c.tier];
  const what = tags.amenity ?? tags.shop ?? tags.tourism ?? tags.leisure ?? "";
  const text = what.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type Found = { poiId: PoiId; name: string; distanceM: number; kmAlong: number };

export const findPois = (deps: AgentDeps) =>
  tool({
    description:
      "List POIs near a routed stage: water (potable, treatable or unknown), food, picnic and resupply, nearest first, at most 5 per group. Only POIs within the detour allowance of the route are listed; distanceM is the straight-line distance to the route, kmAlong the position along the stage. Use `kinds` to ask for some kinds only. Every stage must be routed first. Call it when the user asks or while refining, never automatically after routing.",
    inputSchema: z.object({
      stageId: StageId,
      kinds: z.array(z.enum(PoiKind)).min(1).optional(),
    }),
    async execute({ stageId, kinds }) {
      const loaded = deps.trips.load(deps.tripId);
      if (!loaded.ok) return failStore(loaded.error);
      const trip = loaded.value;

      const stage = trip.stages.find((s) => s.id === stageId);
      if (!stage) {
        return failIssues([
          { path: "stageId", message: `unknown stage ${stageId}` },
        ]);
      }
      const unrouted = trip.stages.filter((s) => !s.routeId).map((s) => s.id);
      if (unrouted.length > 0 || !stage.routeId) {
        return {
          ok: false as const,
          error: "every stage must be routed first",
          unrouted,
        };
      }

      const line = deps.trips.readRoute(deps.tripId, stage.routeId);
      if (!line.ok) return failStore(line.error);

      const tripKm = trip.stages.reduce((n, s) => n + (s.stats?.km ?? 0), 0);
      // ponytail: temporary cap, the 1% rule is too wide on big trips; replace with the redesigned allowance
      const allowanceM = Math.min(detourAllowanceM(tripKm), CORRIDOR_CAP_M);

      const raw = await deps.pois.near({
        line: line.value,
        marginM: allowanceM,
      });
      if (!raw.ok) {
        return {
          ok: false as const,
          error: `OpenStreetMap POI service unavailable (${raw.error.message}). Nothing was changed; tell the user and try again later.`,
        };
      }

      const wanted = new Set<string>(kinds ?? PoiKind);
      const near = raw.value.flatMap((p) => {
        const c = classifyPoi(p.tags);
        if (!c || !wanted.has(c.kind)) return [];
        const at = locateOnRoute(p.geometry, line.value);
        if (at.distanceM > allowanceM) return [];
        return [{ p, c, at, name: labelOf(p.tags, c) }];
      });
      near.sort((a, b) => a.at.distanceM - b.at.distanceM);

      // Parallel tool calls in one step share the trip file: reload after the
      // await and save with no await in between, or the last stale save wins.
      const fresh = deps.trips.load(deps.tripId);
      if (!fresh.ok) return failStore(fresh.error);
      const pois = { ...fresh.value.registry.pois };
      for (const { p, c, at, name } of near) {
        pois[p.poiId] = {
          name,
          kind: c.kind,
          ...(c.tier && { tier: c.tier }),
          lngLat: at.lngLat,
        };
      }
      const saved = deps.trips.save({
        ...fresh.value,
        registry: { ...fresh.value.registry, pois },
      });
      if (!saved.ok) return failStore(saved.error);

      const groups: Record<string, Found[]> = {};
      for (const { p, c, at, name } of near) {
        const group = c.tier ? `water.${c.tier}` : c.kind;
        (groups[group] ??= []).push({
          poiId: p.poiId,
          name,
          distanceM: Math.round(at.distanceM),
          kmAlong: Math.round(at.alongM / 100) / 10,
        });
      }
      const listed = Object.fromEntries(
        Object.entries(groups).map(([g, all]) => [
          g,
          { found: all.length, pois: all.slice(0, PER_GROUP) },
        ]),
      );
      return { ok: true as const, stageId, allowanceM, groups: listed };
    },
  });
