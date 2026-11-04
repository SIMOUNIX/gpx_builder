import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { CachePort } from "@gpx-builder/core/server";
import { writeFileAtomic } from "./atomic";

/**
 * One file per entry, named by the hash of the key. The expiry lives inside the
 * file. A cache is never allowed to break a request: unreadable, expired or
 * unwritable all behave like a miss.
 */
export function createDiskCache(opts: {
  cacheDir: string;
  now?: () => Date;
}): CachePort {
  const now = opts.now ?? (() => new Date());
  const fileOf = (key: string) =>
    join(
      opts.cacheDir,
      `${createHash("sha256").update(key).digest("hex")}.json`,
    );

  return {
    get(key) {
      const file = fileOf(key);
      try {
        const entry = JSON.parse(readFileSync(file, "utf8")) as {
          expiresAt?: unknown;
          value?: unknown;
        };
        if (
          typeof entry.value !== "string" ||
          typeof entry.expiresAt !== "number"
        ) {
          return undefined;
        }
        if (entry.expiresAt <= now().getTime()) {
          try {
            unlinkSync(file);
          } catch {
            // already gone
          }
          return undefined;
        }
        return entry.value;
      } catch {
        return undefined;
      }
    },

    set(key, value, ttlSec) {
      try {
        mkdirSync(opts.cacheDir, { recursive: true });
        writeFileAtomic(
          fileOf(key),
          JSON.stringify({ expiresAt: now().getTime() + ttlSec * 1000, value }),
        );
      } catch {
        // ponytail: a failed cache write is a future miss, never an error
      }
    },
  };
}
