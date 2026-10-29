import { expect, test } from "bun:test";
import { mintTripId as fromBrowser } from "@gpx-builder/core/browser";
import { mintTripId as fromServer } from "@gpx-builder/core/server";
import { PACKAGE as store } from "@gpx-builder/store";
import { PACKAGE as adapters } from "@gpx-builder/adapters";
import { PACKAGE as agent } from "@gpx-builder/agent";

test("workspace packages resolve", () => {
  expect(fromBrowser).toBe(fromServer);
  expect([store, adapters, agent]).toEqual(["store", "adapters", "agent"]);
});
