import { haversineM, type Position3 } from "./geo";

// Tuning constants. Fixed by design: the 20 m step and 4 m hysteresis; the window is our choice.
const STEP_M = 20;
const HYSTERESIS_M = 4;
const WINDOW = 5; // samples, i.e. 100 m

function resample(line: readonly Position3[]): number[] {
  // function that re sample elevation every STEP_M meters because line could sparse
  const dist = [0];
  for (let i = 1; i < line.length; i++)
    dist.push(dist[i - 1]! + haversineM(line[i - 1]!, line[i]!));
  const total = dist[dist.length - 1]!;
  const out: number[] = [];
  let seg = 1;
  for (let d = 0; d <= total; d += STEP_M) {
    while (seg < dist.length - 1 && dist[seg]! < d) {
      seg++;
    }
    const span = dist[seg]! - dist[seg - 1]!;
    const t = span === 0 ? 0 : (d - dist[seg - 1]!) / span;
    out.push(line[seg - 1]![2] + t * (line[seg]![2] - line[seg - 1]![2]));
  }
  return out;
}

function smooth(values: number[]): number[] {
  const half = Math.floor(WINDOW / 2);
  return values.map((_, i) => {
    const win = values.slice(Math.max(0, i - half), i + half + 1);
    return win.reduce((a, b) => a + b, 0) / win.length;
  });
}

/** D+ / D-: resample every 20 m, smooth, then count only climbs/descents above the 4 m hysteresis. */
export function elevationGain(line: readonly Position3[]): {
  gainM: number;
  lossM: number;
} {
  if (line.length < 2) return { gainM: 0, lossM: 0 };
  const e = smooth(resample(line));
  let gain = 0;
  let loss = 0;
  let base = e[0]!; // start of the current leg
  let ext = base; // furthest point of the current leg
  let dir = 0;
  for (const x of e) {
    if (dir === 0) {
      if (x - base >= HYSTERESIS_M || base - x >= HYSTERESIS_M) {
        dir = x > base ? 1 : -1;
        ext = x;
      }
    } else if (dir === 1) {
      if (x > ext) ext = x;
      else if (ext - x >= HYSTERESIS_M) {
        gain += ext - base;
        base = ext;
        ext = x;
        dir = -1;
      }
    } else if (x < ext) ext = x;
    else if (x - ext >= HYSTERESIS_M) {
      loss += base - ext;
      base = ext;
      ext = x;
      dir = 1;
    }
  }
  if (dir === 1) gain += ext - base;
  if (dir === -1) loss += base - ext;
  return { gainM: gain, lossM: loss };
}
