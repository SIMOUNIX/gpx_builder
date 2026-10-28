import { expect, test } from "bun:test";
import { PACKAGE as browser } from "@gpx-builder/core/browser";
import { PACKAGE as server } from "@gpx-builder/core/server";
import { PACKAGE as store } from "@gpx-builder/store";
import { PACKAGE as adapters } from "@gpx-builder/adapters";
import { PACKAGE as agent } from "@gpx-builder/agent";

test("workspace packages resolve", () => {
  expect([browser, server, store, adapters, agent]).toEqual([
    "core/browser",
    "core/browser",
    "store",
    "adapters",
    "agent",
  ]);
});
