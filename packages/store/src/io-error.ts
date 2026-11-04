import type { StoreError } from "@gpx-builder/core/server";

export const ioError = (e: unknown, path?: string): StoreError => ({
  kind: "io",
  message: e instanceof Error ? e.message : String(e),
  path,
});
