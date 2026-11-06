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

test('the base rules ask in batches and accept "I don\'t care"', () => {
  const text = systemPrompt("brief");
  expect(text).toContain("ONE ask_user call");
  expect(text).toContain("Never insist");
});
