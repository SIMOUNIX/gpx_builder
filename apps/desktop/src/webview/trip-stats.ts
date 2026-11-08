import { phase, type Trip } from "@gpx-builder/core/browser";

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

/** Sidebar status line, derived from trip state. */
export function tripStatus(trip: Trip) {
  const p = phase(trip);
  if (p === "brief") return "Gathering brief";
  if (p === "plan") return "Ready to plan";
  const { days, km } = tripTotals(trip);
  return `${days} d · ${km} km`;
}

/** "just now", "3h ago", "2d ago", then the date. */
export function timeAgo(iso: string, now = Date.now()) {
  const m = Math.floor((now - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 60 * 24) return `${Math.floor(m / 60)}h ago`;
  if (m < 60 * 24 * 7) return `${Math.floor(m / (60 * 24))}d ago`;
  return iso.slice(0, 10);
}
