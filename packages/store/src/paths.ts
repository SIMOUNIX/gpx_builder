import { homedir } from "node:os";
import { join } from "node:path";

export type Dirs = { dataDir: string; cacheDir: string; tripsDir: string };

/**
 * Everything lives under ~/.gpx_builder on every OS. An env var overrides
 * each directory on its own (tests use this); a settings panel will
 * replace the overrides later.
 */
export function resolveDirs(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): Dirs {
  const root = join(home, ".gpx_builder");
  return {
    dataDir: env.GPX_BUILDER_DATA_DIR || join(root, "data"),
    cacheDir: env.GPX_BUILDER_CACHE_DIR || join(root, "cache"),
    tripsDir: env.GPX_BUILDER_TRIPS_DIR || join(root, "trips"),
  };
}
