import { expect, test } from "bun:test";
import { useUiStore } from "./ui-store";
import { tripTotals } from "./trip-stats";
import { mockTrips } from "./fixtures/trips";

test("setMapExpanded toggles the overlay", () => {
  useUiStore.getState().setMapExpanded(true);
  expect(useUiStore.getState().mapExpanded).toBe(true);
  useUiStore.getState().setMapExpanded(false);
  expect(useUiStore.getState().mapExpanded).toBe(false);
});

test("tripTotals sums stage stats", () => {
  expect(tripTotals(mockTrips[0]!)).toEqual({
    days: 2,
    km: 33.5,
    gainM: 530,
    lossM: 530,
  });
});
