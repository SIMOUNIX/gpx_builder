import {
  haversineM,
  type LngLat,
  type Position3,
} from "@gpx-builder/core/browser";

export type ProfileSample = {
  distanceKm: number;
  elevationM: number;
  point: LngLat;
};

/** Samples along the stage lines, distance accumulating stage to stage; with `stageId`, that day alone from 0 km. */
export function profileSamples(
  stages: { stageId: string; line: Position3[] }[],
  stageId?: string,
): ProfileSample[] {
  const out: ProfileSample[] = [];
  let offset = 0;
  for (const { line } of stageId
    ? stages.filter((s) => s.stageId === stageId)
    : stages) {
    let d = 0;
    line.forEach(([lng, lat, elevationM], i) => {
      const prev = line[i - 1];
      if (prev) d += haversineM(prev, [lng, lat]) / 1000;
      // No elevation: no sample, but the distance above still counts.
      if (Number.isFinite(elevationM))
        out.push({ distanceKm: offset + d, elevationM, point: [lng, lat] });
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
