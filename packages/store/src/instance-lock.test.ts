import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireInstanceLock } from "./instance-lock";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lock-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const lockFile = () => join(dir, "instance.lock");

test("first acquire holds the lock, release frees it", () => {
  const first = acquireInstanceLock(dir);
  expect(first.ok).toBe(true);
  expect(existsSync(lockFile())).toBe(true);
  if (first.ok) first.value.release();
  expect(existsSync(lockFile())).toBe(false);
});

test("a second acquire while a live process holds it is refused", () => {
  writeFileSync(lockFile(), String(process.ppid)); // our parent is alive
  expect(acquireInstanceLock(dir)).toEqual({ ok: false, error: "held" });
});

test("a lock left by a dead process is taken over", () => {
  const dead = Bun.spawnSync(["true"]).pid; // exited, so the pid is gone
  writeFileSync(lockFile(), String(dead));
  expect(acquireInstanceLock(dir).ok).toBe(true);
});

test("a garbage lock file counts as stale", () => {
  writeFileSync(lockFile(), "");
  expect(acquireInstanceLock(dir).ok).toBe(true);
});
