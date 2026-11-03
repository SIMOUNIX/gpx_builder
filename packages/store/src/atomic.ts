import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";

const STALE_TMP = /^\..+\.tmp-\d+-[0-9a-f]{8}$/;

/**
 * Replaces `target` all-or-nothing: write a hidden temp file in the same
 * directory (no cross-device rename), fsync it, rename it over the target,
 * fsync the directory. Throws on failure and never leaves a half-written
 * target; the temp file is removed.
 */
export function writeFileAtomic(target: string, data: string): void {
  const dir = dirname(target);
  const tmp = join(
    dir,
    `.${basename(target)}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`,
  );
  let fd: number | undefined;
  try {
    fd = openSync(tmp, "wx");
    writeFileSync(fd, data);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmp, target);
  } catch (e) {
    if (fd !== undefined) closeSync(fd);
    rmQuiet(tmp);
    throw e;
  }
  // The rename already happened; a filesystem that can't fsync a directory is tolerated.
  try {
    const dirFd = openSync(dir, "r");
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } catch {
    // ponytail: ignored on purpose, durability of the rename is best effort there
  }
}

/** Removes temp files a crash left behind. Safe because a single process writes. */
export function sweepStaleTmp(dir: string): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (STALE_TMP.test(name)) rmQuiet(join(dir, name));
  }
}

function rmQuiet(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // already gone
  }
}
