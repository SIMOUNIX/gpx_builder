import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type Result } from "@gpx-builder/core/browser";

export type InstanceLock = { release(): void };

/** True when a process with this pid exists (EPERM means it exists but is not ours). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Takes `<dataDir>/instance.lock` (holds our pid), created exclusively. When
 * the file exists, the owner's pid is probed: a dead owner (crash) makes the
 * lock stale, so it is removed and taken over once. `held` means another live
 * process owns it. Release removes the file; the caller does so on exit.
 * ponytail: after a crash or reboot the old pid can belong to an unrelated
 * process, which reads as `held` until it is removed by hand. Upgrade path:
 * store the process start time next to the pid.
 */
export function acquireInstanceLock(
  dataDir: string,
  pid: number = process.pid,
): Result<InstanceLock, "held"> {
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, "instance.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, String(pid), { flag: "wx" });
      return ok({
        release: () => {
          try {
            unlinkSync(path);
          } catch {
            // already gone
          }
        },
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const owner = Number.parseInt(readFileSync(path, "utf8"), 10);
    if (Number.isInteger(owner) && owner !== pid && isAlive(owner))
      return err("held");
    try {
      unlinkSync(path); // stale, or garbage left by a crash mid-write
    } catch {
      // someone else removed it first; the retry decides
    }
  }
  return err("held");
}
