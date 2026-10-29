import { Brief } from "./brief";
import type { Trip } from "./trip";

export type Phase = "brief" | "plan" | "refine";

/** Derived from trip state, never from the transcript. */
export function phase(trip: Trip): Phase {
  if (trip.stages.length > 0) return "refine";
  return Brief.safeParse(trip.brief).success ? "plan" : "brief";
}
