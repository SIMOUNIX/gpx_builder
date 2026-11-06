import type { Trip } from "@gpx-builder/core/browser";

export function tripTotals(trip: Trip) {
  const stats = trip.stages.flatMap((s) => (s.stats ? [s.stats] : []));
  const sum = (k: "km" | "gainM" | "lossM") =>
    stats.reduce((a, s) => a + s[k], 0);
  return {
    days: trip.stages.length,
    km: Math.round(sum("km") * 10) / 10,
    gainM: sum("gainM"),
    lossM: sum("lossM"),
  };
}
