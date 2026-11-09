import { expect, test } from "bun:test";
import { useUiStore } from "./ui-store";
import { timeAgo, tripStatus, tripTotals } from "./trip-stats";
import { mockChat, mockTrips } from "./fixtures/trips";

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

test("timeAgo and tripStatus", () => {
  const now = Date.parse("2026-11-08T12:00:00.000Z");
  expect(timeAgo("2026-11-08T11:59:30.000Z", now)).toBe("just now");
  expect(timeAgo("2026-11-08T09:00:00.000Z", now)).toBe("3h ago");
  expect(timeAgo("2026-11-06T12:00:00.000Z", now)).toBe("2d ago");
  expect(tripStatus(mockTrips[0]!)).toBe("2 d · 33.5 km");
});

test("selectStage sets and clears the selection", () => {
  useUiStore.getState().selectStage("stage_1_aaaaaaaa" as never);
  expect(useUiStore.getState().selectedStageId).toBe(
    "stage_1_aaaaaaaa" as never,
  );
  useUiStore.getState().selectStage(null);
  expect(useUiStore.getState().selectedStageId).toBeNull();
});

test("mockChat is a user question then an assistant answer", () => {
  const chat = mockChat(mockTrips[0]!);
  expect(chat.map((m) => m.role)).toEqual(["user", "assistant"]);
  expect(chat[1]!.parts[0]!.text).toContain("2 day(s)");
});
