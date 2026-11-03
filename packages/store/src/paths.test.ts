import { expect, test } from "bun:test";
import { resolveDirs } from "./paths";

test("defaults live under ~/.gpx_builder", () => {
  expect(resolveDirs({}, "/Users/me")).toEqual({
    dataDir: "/Users/me/.gpx_builder/data",
    cacheDir: "/Users/me/.gpx_builder/cache",
    tripsDir: "/Users/me/.gpx_builder/trips",
  });
});

test("env vars override each directory on its own", () => {
  expect(
    resolveDirs(
      { GPX_BUILDER_DATA_DIR: "/d", GPX_BUILDER_TRIPS_DIR: "/t" },
      "/Users/me",
    ),
  ).toEqual({
    dataDir: "/d",
    cacheDir: "/Users/me/.gpx_builder/cache",
    tripsDir: "/t",
  });
});

test("an empty env var counts as unset", () => {
  expect(resolveDirs({ GPX_BUILDER_CACHE_DIR: "" }, "/h").cacheDir).toBe(
    "/h/.gpx_builder/cache",
  );
});
