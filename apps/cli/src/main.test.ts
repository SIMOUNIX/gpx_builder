import { expect, test } from "bun:test";
import { mintTripId as fromBrowser } from "@gpx-builder/core/browser";
import { mintTripId as fromServer } from "@gpx-builder/core/server";
import { createTripStore } from "@gpx-builder/store";
import { createPhotonGeocoder } from "@gpx-builder/adapters";
import { PACKAGE as agent } from "@gpx-builder/agent";

test("workspace packages resolve", () => {
  expect(fromBrowser).toBe(fromServer);
  expect(typeof createTripStore).toBe("function");
  expect(typeof createPhotonGeocoder).toBe("function");
  expect(agent).toBe("agent");
});
