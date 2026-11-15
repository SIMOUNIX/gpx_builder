import {
  haversineM,
  type LngLat,
  type Position3,
} from "@gpx-builder/core/browser";

export type ProfileSample = {
  distanceKm: number;
  elevationM: number;
  point: LngLat;
  stageId: string;
};

/** Samples along the stage lines, distance accumulating stage to stage; with `stageId`, that day alone from 0 km. */
export function profileSamples(
  stages: { stageId: string; line: Position3[] }[],
  stageId?: string,
): ProfileSample[] {
  const out: ProfileSample[] = [];
  let offset = 0;
  for (const { line, stageId: id } of stageId
    ? stages.filter((s) => s.stageId === stageId)
    : stages) {
    let d = 0;
    line.forEach(([lng, lat, elevationM], i) => {
      const prev = line[i - 1];
      if (prev) d += haversineM(prev, [lng, lat]) / 1000;
      // No elevation: no sample, but the distance above still counts.
      if (Number.isFinite(elevationM))
        out.push({
          distanceKm: offset + d,
          elevationM,
          point: [lng, lat],
          stageId: id,
        });
    });
    offset += d;
  }
  return out;
}

/** Map point at `km` along the profile, interpolated between samples and clamped to its ends. */
export function pointAtDistance(
  samples: ProfileSample[],
  km: number,
): LngLat | undefined {
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last) return undefined;
  if (km <= first.distanceKm) return first.point;
  if (km >= last.distanceKm) return last.point;
  const i = samples.findIndex((s) => s.distanceKm >= km);
  const a = samples[i - 1]!;
  const b = samples[i]!;
  const t = (km - a.distanceKm) / (b.distanceKm - a.distanceKm);
  return [
    a.point[0] + t * (b.point[0] - a.point[0]),
    a.point[1] + t * (b.point[1] - a.point[1]),
  ];
}

export type Band = "steep-up" | "up" | "flat" | "down" | "steep-down";

// Hex, not CSS variables or oklch: MapLibre can't read those. Top to bottom, as the legend lists them.
export const BANDS: { band: Band; color: string; label: string }[] = [
  { band: "steep-up", color: "#dc2626", label: "> +8%" },
  { band: "up", color: "#f97316", label: "+3 to +8%" },
  { band: "flat", color: "#9ca3af", label: "−3 to +3%" },
  { band: "down", color: "#7dd3fc", label: "−8 to −3%" },
  { band: "steep-down", color: "#2563eb", label: "< −8%" },
];
export const BAND_COLORS = Object.fromEntries(
  BANDS.map((b) => [b.band, b.color]),
) as Record<Band, string>;

/** Exactly ±3% and ±8% belong to the steeper band. */
export const bandOf = (grade: number): Band =>
  grade >= 8
    ? "steep-up"
    : grade >= 3
      ? "up"
      : grade > -3
        ? "flat"
        : grade > -8
          ? "down"
          : "steep-down";

const HALF_WINDOW_KM = 0.05 - 1e-9; // grade is measured over 100 m around the sample; the epsilon absorbs float error

/** Grade in % at sample `i`, over 100 m centred on it (at least the neighbours when sparse, clamped to the stage's ends). */
export function gradePct(samples: ProfileSample[], i: number): number {
  const s = samples[i]!;
  let a = i;
  let b = i;
  while (
    samples[a - 1]?.stageId === s.stageId &&
    s.distanceKm - samples[a]!.distanceKm < HALF_WINDOW_KM
  )
    a--;
  while (
    samples[b + 1]?.stageId === s.stageId &&
    samples[b]!.distanceKm - s.distanceKm < HALF_WINDOW_KM
  )
    b++;
  const runM = (samples[b]!.distanceKm - samples[a]!.distanceKm) * 1000;
  return runM === 0
    ? 0
    : ((samples[b]!.elevationM - samples[a]!.elevationM) / runM) * 100;
}

/** Runs of consecutive samples sharing a band; a segment takes the mean grade of its two ends. */
function runs(samples: ProfileSample[]) {
  const out: { band: Band; from: number; to: number }[] = [];
  for (let i = 0; i + 1 < samples.length; i++) {
    if (samples[i]!.stageId !== samples[i + 1]!.stageId) continue; // stage joint: zero length
    const band = bandOf((gradePct(samples, i) + gradePct(samples, i + 1)) / 2);
    const last = out.at(-1);
    if (last?.band === band && last.to === i) last.to = i + 1;
    else out.push({ band, from: i, to: i + 1 });
  }
  return out;
}

/** Distance spans of one band along the profile, for the chart background. */
export const profileBands = (samples: ProfileSample[]) =>
  runs(samples).map(({ band, from, to }) => ({
    band,
    fromKm: samples[from]!.distanceKm,
    toKm: samples[to]!.distanceKm,
  }));

/** Each stage cut into band-coloured lines for the map. A stage without elevation is one neutral line. */
export function slopeSegments(
  stages: { stageId: string; line: Position3[] }[],
): { stageId: string; band: Band; points: LngLat[] }[] {
  return stages.flatMap((stage) => {
    const samples = profileSamples([stage]);
    // ponytail: a point with no elevation inside a stage is skipped, its gap drawn as a chord in the neighbours' band.
    if (samples.length < 2)
      return [
        {
          stageId: stage.stageId,
          band: "flat" as const,
          points: stage.line.map(([lng, lat]): LngLat => [lng, lat]),
        },
      ];
    return runs(samples).map(({ band, from, to }) => ({
      stageId: stage.stageId,
      band,
      points: samples.slice(from, to + 1).map((s) => s.point),
    }));
  });
}
