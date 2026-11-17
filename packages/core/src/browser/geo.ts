import { z } from "zod";

export const LngLat = z.tuple([z.number(), z.number()]);
export type LngLat = z.infer<typeof LngLat>;

/** [lng, lat, elevation in metres] */
export type Position3 = [number, number, number];

export const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function haversineM(a: readonly number[], b: readonly number[]): number {
  const [lng1 = 0, lat1 = 0] = a;
  const [lng2 = 0, lat2 = 0] = b;
  const h =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) *
      Math.cos(rad(lat2)) *
      Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function lineLengthM(line: readonly Position3[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++)
    total += haversineM(line[i - 1]!, line[i]!);
  return total;
}
