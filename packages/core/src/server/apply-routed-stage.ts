import { elevationGain } from "../browser/elevation";
import { lineLengthM } from "../browser/geo";
import { walkingTimeMin } from "../browser/walking-time";
import type { RouteId, StageId } from "../browser/ids";
import type { Trip } from "../browser/trip";
import type { RoutedStage } from "./ports";

/**
 * Attaches a routed stage to its stage in the trip: route id, stats and snap distances.
 * Pure: returns a new trip. An unknown stage id is a programming error (the tool
 * already validated it), so it throws.
 */
export function applyRoutedStage(
  trip: Trip,
  stageId: StageId,
  routed: RoutedStage,
  routeId: RouteId,
): Trip {
  if (!trip.stages.some((s) => s.id === stageId)) {
    throw new Error(`unknown stage ${stageId}`);
  }
  const { gainM, lossM } = elevationGain(routed.line);
  const km = Math.round(lineLengthM(routed.line) / 10) / 100; // 2 decimals
  const stats = {
    km,
    gainM: Math.round(gainM),
    lossM: Math.round(lossM),
    walkingMin: walkingTimeMin(km, gainM, lossM),
  };
  return {
    ...trip,
    stages: trip.stages.map((s) =>
      s.id === stageId
        ? { ...s, routeId, stats, snapDistancesM: routed.snapDistancesM }
        : s,
    ),
  };
}
