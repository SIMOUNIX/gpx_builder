import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDiskCache } from "./disk-cache";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cache-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("returns a stored value until it expires", () => {
  let t = 1_000_000;
  const c = createDiskCache({ cacheDir: dir, now: () => new Date(t) });
  expect(c.get("k")).toBeUndefined();
  c.set("k", "v", 10);
  expect(c.get("k")).toBe("v");
  t += 9_999;
  expect(c.get("k")).toBe("v");
  t += 1;
  expect(c.get("k")).toBeUndefined();
  expect(readdirSync(dir)).toEqual([]); // expired entry removed
});

test("different keys do not collide", () => {
  const c = createDiskCache({ cacheDir: dir });
  c.set("a", "1", 60);
  c.set("b", "2", 60);
  expect([c.get("a"), c.get("b")]).toEqual(["1", "2"]);
});

test("a corrupt entry is a miss", () => {
  const c = createDiskCache({ cacheDir: dir });
  c.set("k", "v", 60);
  const [file] = readdirSync(dir);
  writeFileSync(join(dir, file!), "{not json");
  expect(c.get("k")).toBeUndefined();
});

test("an unwritable cache dir never throws", () => {
  const file = join(dir, "plain-file");
  writeFileSync(file, "x");
  const c = createDiskCache({ cacheDir: join(file, "nested") });
  expect(() => c.set("k", "v", 60)).not.toThrow();
  expect(c.get("k")).toBeUndefined();
});
