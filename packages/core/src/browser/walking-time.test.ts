import { expect, test } from "bun:test";
import { walkingTimeMin } from "./walking-time";

test("flat: 4 km at 4 km/h is 60 min", () => {
  expect(walkingTimeMin(4, 0, 0)).toBe(60);
});

test("climbing: vertical time dominates, half the horizontal is added", () => {
  // 2 km = 30 min horizontal; 600 m up = 120 min; 120 + 15
  expect(walkingTimeMin(2, 600, 0)).toBe(135);
});

test("descending: 500 m/h, horizontal dominates", () => {
  // 8 km = 120 min; 250 m down = 30 min; 120 + 15
  expect(walkingTimeMin(8, 0, 250)).toBe(135);
});

test("gain and loss add up on the vertical side", () => {
  // 1 km = 15 min; 300 m up = 60 min + 500 m down = 60 min -> 120 + 7.5
  expect(walkingTimeMin(1, 300, 500)).toBe(128); // rounded
});

test("descending: vertical dominates when steep", () => {
  // 1 km = 15 min; 1000 m down = 120 min; 120 + 7.5
  expect(walkingTimeMin(1, 0, 1000)).toBe(128);
});
