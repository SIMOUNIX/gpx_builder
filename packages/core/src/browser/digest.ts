import { Brief } from "./brief";
import type { PlaceId, WaypointId } from "./ids";
import { phase } from "./phase";
import type { Trip } from "./trip";

/** The planner's view of the present, regenerated from trip.json every turn. */
export function renderDigest(trip: Trip): string {
  const place = (id: PlaceId) =>
    `${trip.registry.places[id]?.label ?? "?"} (${id})`;
  const wp = (id: WaypointId) => `${trip.waypoints[id]?.label ?? "?"} (${id})`;
  const b = trip.brief;
  const lines = [
    `Trip ${trip.tripId} "${trip.name}" - phase: ${phase(trip)}`,
    "",
    "Brief:",
  ];

  if (b.days !== undefined) lines.push(`- days: ${b.days}`);
  if (b.maxKmPerDay !== undefined)
    lines.push(`- max km per day: ${b.maxKmPerDay}`);
  if (b.maxGainPerDay !== undefined)
    lines.push(`- max D+ per day: ${b.maxGainPerDay} m`);
  if (b.start)
    lines.push(
      `- start: ${place(b.start.placeId)}, public transport: ${b.start.publicTransport}`,
    );
  if (b.end)
    lines.push(
      `- end: ${place(b.end.placeId)}, public transport: ${b.end.publicTransport}`,
    );
  if (b.overnight) lines.push(`- overnight: ${b.overnight}`);
  if (b.travel) {
    lines.push(
      `- travel: from ${place(b.travel.from)} by ${b.travel.modes.join("/")}, max ${b.travel.maxOneWayHours} h one way`,
    );
  }
  if (b.startDate) lines.push(`- start date: ${b.startDate}`);
  if (b.maxWaterGapKm !== undefined)
    lines.push(`- max water gap: ${b.maxWaterGapKm} km`);
  if (b.season) lines.push(`- season: ${b.season}`);
  if (b.fitness) lines.push(`- fitness: ${b.fitness}`);
  if (b.notes) lines.push(`- notes: ${b.notes}`);

  const parsed = Brief.safeParse(b);
  if (!parsed.success) {
    const missing = [
      ...new Set(parsed.error.issues.map((i) => String(i.path[0]))),
    ];
    lines.push(`- missing: ${missing.join(", ")}`);
  }

  lines.push("", "Stages:");
  if (trip.stages.length === 0) lines.push("- none");
  for (const s of trip.stages) {
    const stats = s.stats
      ? `${s.stats.km} km, D+ ${s.stats.gainM} m, D- ${s.stats.lossM} m`
      : "not routed";
    lines.push(
      `- ${s.id}: ${wp(s.from)} -> ${wp(s.to)}, ${stats}, overnight: ${s.overnight ?? "none"}, route: ${s.routeId ?? "none"}`,
    );
  }
  return lines.join("\n");
}
