import { expect, test } from "bun:test";
import { systemPrompt } from "./system";

test("every phase keeps the base rules and adds its own section", () => {
  for (const [phase, marker] of [
    ["brief", "gather the brief"],
    ["plan", "plan the itinerary"],
    ["refine", "Current phase: refine"],
  ] as const) {
    const text = systemPrompt(phase);
    expect(text).toContain("You never see or write coordinates");
    expect(text).toContain(marker);
  }
});
