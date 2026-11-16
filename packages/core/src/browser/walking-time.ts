/** DIN 33466 walking time in minutes: 4 km/h horizontal, 300 m/h up, 500 m/h down; the larger of the two plus half the smaller. */
export function walkingTimeMin(km: number, gainM: number, lossM: number) {
  const horizontal = (km / 4) * 60;
  const vertical = (gainM / 300 + lossM / 500) * 60;
  return Math.round(
    Math.max(horizontal, vertical) + Math.min(horizontal, vertical) / 2,
  );
}
