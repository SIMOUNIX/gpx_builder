import { expect, test } from "bun:test";
import { elevationGain } from "./elevation";
import type { Position3 } from "./geo";

// Points ~11 m apart along a meridian (0.0001 deg of latitude), elevation linear within each leg.
function profile(
  legs: [from: number, to: number, points: number][],
): Position3[] {
  const line: Position3[] = [];
  for (const [from, to, n] of legs) {
    for (let i = 0; i < n; i++) {
      line.push([2, 48 + line.length * 0.0001, from + ((to - from) * i) / n]);
    }
  }
  return line;
}

test("one climb and one descent", () => {
  const { gainM, lossM } = elevationGain(
    profile([
      [0, 100, 180],
      [100, 0, 180],
    ]),
  );
  expect(gainM).toBeCloseTo(100, -1);
  expect(lossM).toBeCloseTo(100, -1);
});

test("noise under the hysteresis counts for nothing", () => {
  const flat: Position3[] = Array.from({ length: 400 }, (_, i) => [
    2,
    48 + i * 0.0001,
    500 + (i % 2 ? 1.5 : -1.5),
  ]);
  expect(elevationGain(flat)).toEqual({ gainM: 0, lossM: 0 });
});

test("up-down-up sums every leg above the threshold", () => {
  const { gainM, lossM } = elevationGain(
    profile([
      [0, 50, 180],
      [50, 20, 180],
      [20, 70, 180],
    ]),
  );
  expect(gainM).toBeCloseTo(100, -1);
  expect(lossM).toBeCloseTo(30, -1);
});

test("degenerate lines", () => {
  expect(elevationGain([])).toEqual({ gainM: 0, lossM: 0 });
  expect(elevationGain([[2, 48, 10]])).toEqual({ gainM: 0, lossM: 0 });
});
