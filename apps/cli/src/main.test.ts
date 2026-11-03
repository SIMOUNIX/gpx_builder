import { expect, test } from "bun:test";
import { mintTripId as fromBrowser } from "@gpx-builder/core/browser";
import { mintTripId as fromServer } from "@gpx-builder/core/server";
import { createTripStore } from "@gpx-builder/store";
import { PACKAGE as adapters } from "@gpx-builder/adapters";
import { PACKAGE as agent } from "@gpx-builder/agent";

test("workspace packages resolve", () => {
  expect(fromBrowser).toBe(fromServer);
  expect(typeof createTripStore).toBe("function");
  expect([adapters, agent]).toEqual(["adapters", "agent"]);
});
