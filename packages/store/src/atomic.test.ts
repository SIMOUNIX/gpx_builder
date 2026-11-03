import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sweepStaleTmp, writeFileAtomic } from "./atomic";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gpx-atomic-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("replaces the whole content and leaves no temp file", () => {
  const target = join(dir, "a.json");
  writeFileAtomic(target, "one");
  writeFileAtomic(target, "two");
  expect(readFileSync(target, "utf8")).toBe("two");
  expect(readdirSync(dir)).toEqual(["a.json"]);
});

test("a failed rename throws, keeps the target and removes the temp file", () => {
  const target = join(dir, "folder");
  mkdirSync(target);
  writeFileSync(join(target, "keep"), "x"); // a non-empty directory can't be replaced
  expect(() => writeFileAtomic(target, "data")).toThrow();
  expect(readdirSync(dir)).toEqual(["folder"]);
  expect(readFileSync(join(target, "keep"), "utf8")).toBe("x");
});

test("sweeps stale temp files only", () => {
  writeFileSync(join(dir, ".trip.json.tmp-123-0a1b2c3d"), "half");
  writeFileSync(join(dir, "trip.json"), "real");
  writeFileSync(join(dir, ".hidden-user-file"), "mine");
  sweepStaleTmp(dir);
  expect(readdirSync(dir).sort()).toEqual([".hidden-user-file", "trip.json"]);
  expect(() => sweepStaleTmp(join(dir, "missing"))).not.toThrow();
  expect(existsSync(join(dir, "trip.json"))).toBe(true);
});
