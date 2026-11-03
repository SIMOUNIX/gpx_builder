import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  RouteId,
  Trip,
  TripId,
  err,
  ok,
  type Position3,
  type Result,
  type StoreError,
  type TripStorePort,
} from "@gpx-builder/core/server";
import { sweepStaleTmp, writeFileAtomic } from "./atomic";
import { parseRoute, routeIdOf, serializeRoute } from "./route-file";

const KNOWN_V = 1;
const TRIP_FILE = "trip.json";
const PREV_FILE = "trip.prev.json";
// Derived files are plain names inside the trip folder: no separators, no leading dot.
const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const RESERVED = new Set([TRIP_FILE, PREV_FILE]);

const shortId = (id: string) => id.slice("trip_".length, "trip_".length + 8);

/**
 * `<yyyy-mm>-<slug>-<8 hex of tripId>`. The suffix is only a lookup hint:
 * identity is the tripId inside trip.json, so renaming the folder is safe.
 */
export function folderName(trip: Trip): string {
  const slug =
    trip.name
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "trip";
  return `${trip.createdAt.slice(0, 7)}-${slug}-${shortId(trip.tripId)}`;
}

const ioError = (e: unknown, path?: string): StoreError => ({
  kind: "io",
  message: e instanceof Error ? e.message : String(e),
  path,
});

const serialize = (trip: Trip) => `${JSON.stringify(trip, null, 2)}\n`;

function readTripFile(
  dir: string,
): Result<{ trip: Trip; text: string }, StoreError> {
  const path = join(dir, TRIP_FILE);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    return err(ioError(e, path));
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return err({
      kind: "corrupt",
      message: "trip.json is not valid JSON",
      path,
    });
  }
  const v = (json as { v?: unknown } | null)?.v;
  if (typeof v === "number" && v > KNOWN_V) {
    return err({
      kind: "newer-version",
      message: `trip.json has v${v}, this app knows up to v${KNOWN_V}`,
      path,
    });
  }
  const parsed = Trip.safeParse(json);
  if (!parsed.success) {
    return err({
      kind: "invalid",
      message: z.prettifyError(parsed.error),
      path,
    });
  }
  return ok({ trip: parsed.data, text });
}

/**
 * Finds a trip folder by tripId. The folder-name suffix is a fast hint; the
 * id inside trip.json is what counts, with a scan as fallback so a renamed
 * folder is still found. Two folders with one tripId is an error, never a pick.
 */
function find(tripsDir: string, tripId: TripId): Result<string, StoreError> {
  if (!existsSync(tripsDir)) {
    return err({
      kind: "not-found",
      message: `no trips folder at ${tripsDir}`,
    });
  }
  const names = readdirSync(tripsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const isMine = (name: string) => {
    try {
      const raw = readFileSync(join(tripsDir, name, TRIP_FILE), "utf8");
      return (
        (JSON.parse(raw) as { tripId?: unknown } | null)?.tripId === tripId
      );
    } catch {
      return false; // an unreadable sibling must not break the lookup
    }
  };
  const hint = `-${shortId(tripId)}`;
  const hinted = names.filter((n) => n.endsWith(hint));
  let matches = hinted.filter(isMine);
  if (matches.length === 0) {
    matches = names.filter((n) => !hinted.includes(n) && isMine(n));
  }
  if (matches.length > 1) {
    return err({
      kind: "duplicate",
      message: `${matches.length} folders hold ${tripId}: ${matches.join(", ")}`,
    });
  }
  const [only] = matches;
  if (only !== undefined) return ok(join(tripsDir, only));
  if (hinted[0] !== undefined) {
    const path = join(tripsDir, hinted[0], TRIP_FILE);
    return err({ kind: "corrupt", message: `${path} is unreadable`, path });
  }
  return err({ kind: "not-found", message: `no trip ${tripId}` });
}

export function createTripStore(opts: {
  tripsDir: string;
  /** The clock, injected so tests control `updatedAt`. */
  now?: () => Date;
}): TripStorePort {
  const { tripsDir } = opts;
  const now = opts.now ?? (() => new Date());

  return {
    create(trip) {
      const parsed = Trip.safeParse(trip);
      if (!parsed.success) {
        return err({ kind: "invalid", message: z.prettifyError(parsed.error) });
      }
      const existing = find(tripsDir, trip.tripId);
      if (existing.ok) {
        return err({
          kind: "duplicate",
          message: `${trip.tripId} already exists`,
        });
      }
      if (existing.error.kind !== "not-found") return existing;
      const dir = join(tripsDir, folderName(trip));
      try {
        mkdirSync(tripsDir, { recursive: true });
        try {
          mkdirSync(dir); // exclusive on purpose: never reuse a folder
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "EEXIST") {
            // ponytail: two trips sharing 8 hex of uuid; extend the suffix if it ever happens
            return err({
              kind: "duplicate",
              message: `${dir} already exists`,
              path: dir,
            });
          }
          throw e;
        }
        writeFileAtomic(join(dir, TRIP_FILE), serialize(trip));
        return ok(undefined);
      } catch (e) {
        return err(ioError(e, dir));
      }
    },

    load(tripId) {
      const found = find(tripsDir, tripId);
      if (!found.ok) return found;
      try {
        sweepStaleTmp(found.value);
        sweepStaleTmp(join(found.value, "routes"));
      } catch (e) {
        return err(ioError(e, found.value));
      }
      const read = readTripFile(found.value);
      return read.ok ? ok(read.value.trip) : read;
    },

    save(trip) {
      const parsed = Trip.safeParse(trip);
      if (!parsed.success) {
        return err({ kind: "invalid", message: z.prettifyError(parsed.error) });
      }
      const found = find(tripsDir, trip.tripId);
      if (!found.ok) return found;
      const dir = found.value;
      // Never overwrite a file we couldn't parse (hand edit gone wrong, newer app).
      const current = readTripFile(dir);
      if (!current.ok) {
        return err({
          ...current.error,
          message: `refusing to overwrite: ${current.error.message}`,
        });
      }
      try {
        // Order matters: if we die between the two writes, prev equals current.
        writeFileAtomic(join(dir, PREV_FILE), current.value.text);
        writeFileAtomic(
          join(dir, TRIP_FILE),
          serialize({ ...trip, updatedAt: now().toISOString() }),
        );
        return ok(undefined);
      } catch (e) {
        return err(ioError(e, dir));
      }
    },

    writeRoute(tripId, line: Position3[]) {
      if (line.length < 2) {
        return err({
          kind: "invalid",
          message: "a route needs at least 2 points",
        });
      }
      const found = find(tripsDir, tripId);
      if (!found.ok) return found;
      const bytes = serializeRoute(line);
      const routeId = routeIdOf(bytes);
      const routesDir = join(found.value, "routes");
      const file = join(routesDir, `${routeId}.geojson`);
      try {
        mkdirSync(routesDir, { recursive: true });
        if (existsSync(file)) {
          // Same id must mean same bytes; anything else is damage, so fail loudly.
          return readFileSync(file, "utf8") === bytes
            ? ok(routeId)
            : err({
                kind: "corrupt",
                message: `${file} exists with different content`,
                path: file,
              });
        }
        writeFileAtomic(file, bytes);
        return ok(routeId);
      } catch (e) {
        return err(ioError(e, file));
      }
    },

    readRoute(tripId, routeId) {
      if (!RouteId.safeParse(routeId).success) {
        return err({ kind: "invalid", message: `bad route id ${routeId}` });
      }
      const found = find(tripsDir, tripId);
      if (!found.ok) return found;
      const file = join(found.value, "routes", `${routeId}.geojson`);
      let bytes: string;
      try {
        bytes = readFileSync(file, "utf8");
      } catch (e) {
        const missing = (e as NodeJS.ErrnoException).code === "ENOENT";
        return err(
          missing
            ? { kind: "not-found", message: `no route ${routeId}`, path: file }
            : ioError(e, file),
        );
      }
      if (routeIdOf(bytes) !== routeId) {
        return err({
          kind: "corrupt",
          message: `${file} does not match its route id`,
          path: file,
        });
      }
      try {
        return ok(parseRoute(bytes));
      } catch {
        return err({
          kind: "corrupt",
          message: `${file} is not a route`,
          path: file,
        });
      }
    },

    writeDerived(tripId, files) {
      const names = Object.keys(files).sort();
      const bad = names.find((n) => !PLAIN_NAME.test(n) || RESERVED.has(n));
      if (bad !== undefined) {
        return err({ kind: "invalid", message: `bad file name ${bad}` });
      }
      const found = find(tripsDir, tripId);
      if (!found.ok) return found;
      const paths = names.map((n) => join(found.value, n));
      try {
        names.forEach((n, i) => writeFileAtomic(paths[i]!, files[n]!));
        return ok(paths);
      } catch (e) {
        return err(ioError(e, found.value));
      }
    },
  };
}
