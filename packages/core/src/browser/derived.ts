import type { Position3 } from "./geo";
import { buildDayGpx, buildMergedGpx, buildRouteGpx } from "./gpx";
import type { RouteId } from "./ids";
import type { Trip } from "./trip";

/**
 * The GPX files of a trip as { file name: content }: route.gpx (one track per
 * day), route-merged.gpx (one single track) and day-<n>.gpx. Pure.
 *
 * Unrouted stages are skipped, and a day keeps its number (stage order) even
 * if an earlier day is unrouted. A routed stage whose geometry is missing from
 * `routes` is a programming error (the caller loads every route first), so it throws.
 */
export function buildDerivedFiles(
  trip: Trip,
  routes: ReadonlyMap<RouteId, readonly Position3[]>,
): Record<string, string> {
  const days: { day: number; name: string; line: readonly Position3[] }[] = [];
  trip.stages.forEach((stage, i) => {
    if (!stage.routeId) return;
    const line = routes.get(stage.routeId);
    if (!line) throw new Error(`missing geometry for ${stage.routeId}`);
    days.push({ day: i + 1, name: `Day ${i + 1}`, line });
  });
  if (days.length === 0) return {};

  const meta = { name: trip.name };
  const files: Record<string, string> = {
    "route.gpx": buildRouteGpx(meta, days),
    "route-merged.gpx": buildMergedGpx(meta, days),
  };
  for (const d of days) {
    files[`day-${d.day}.gpx`] = buildDayGpx(
      { name: `${trip.name} - ${d.name}` },
      d,
    );
  }
  return files;
}
