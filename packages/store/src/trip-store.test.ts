import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Trip,
  mintTripId,
  type Position3,
  type Result,
  type StoreError,
} from "@gpx-builder/core/server";
import { createTripStore, folderName } from "./trip-store";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gpx-trips-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const mk = (name = "Fontainebleau loop") =>
  Trip.parse({
    v: 1,
    tripId: mintTripId(),
    name,
    createdAt: "2026-10-28T10:00:00.000Z",
    updatedAt: "2026-10-28T10:00:00.000Z",
    brief: {},
    stages: [],
    waypoints: {},
    registry: { places: {}, pois: {} },
  });

const store = () =>
  createTripStore({
    tripsDir: dir,
    now: () => new Date("2026-11-01T09:00:00.000Z"),
  });

const must = <T>(r: Result<T, StoreError>): T => {
  if (!r.ok) throw new Error(`${r.error.kind}: ${r.error.message}`);
  return r.value;
};
const kind = <T>(r: Result<T, StoreError>) => (r.ok ? "ok" : r.error.kind);

const folder = () => join(dir, readdirSync(dir)[0]!);
const tripJson = () => join(folder(), "trip.json");

test("list returns readable trips newest first and skips broken folders", () => {
  expect(must(store().list())).toEqual([]);
  const a = mk("Old");
  const b = { ...mk("New"), updatedAt: "2026-11-02T10:00:00.000Z" };
  must(store().create(a));
  must(store().create(b));
  mkdirSync(join(dir, "broken"));
  writeFileSync(join(dir, "broken", "trip.json"), "{nope");
  expect(must(store().list())).toEqual([
    { id: b.tripId, name: "New", updatedAt: b.updatedAt },
    { id: a.tripId, name: "Old", updatedAt: a.updatedAt },
  ]);
});

test("create then load gives the same trip; folder is <yyyy-mm>-<slug>-<8 hex>", () => {
  const t = mk();
  must(store().create(t));
  expect(must(store().load(t.tripId))).toEqual(t);
  expect(readdirSync(dir)).toEqual([
    `2026-10-fontainebleau-loop-${t.tripId.slice(5, 13)}`,
  ]);
});

test("creating the same trip twice is a duplicate", () => {
  const t = mk();
  must(store().create(t));
  expect(kind(store().create(t))).toBe("duplicate");
});

test("create rejects a trip that fails the schema", () => {
  expect(kind(store().create({ ...mk(), v: 2 } as never))).toBe("invalid");
});

test("folder names: accents, empty slug, long names", () => {
  const suffix = (t: Trip) => t.tripId.slice(5, 13);
  const a = mk("Été à Zürich!");
  expect(folderName(a)).toBe(`2026-10-ete-a-zurich-${suffix(a)}`);
  const b = mk("京都");
  expect(folderName(b)).toBe(`2026-10-trip-${suffix(b)}`);
  const c = mk("a".repeat(100));
  expect(folderName(c)).toBe(`2026-10-${"a".repeat(40)}-${suffix(c)}`);
});

test("save keeps the previous version and stamps updatedAt", () => {
  const t = mk();
  must(store().create(t));
  must(store().save({ ...t, name: "Renamed" }));
  const now = JSON.parse(readFileSync(tripJson(), "utf8"));
  const prev = JSON.parse(
    readFileSync(join(folder(), "trip.prev.json"), "utf8"),
  );
  expect(now.name).toBe("Renamed");
  expect(now.updatedAt).toBe("2026-11-01T09:00:00.000Z");
  expect(prev.name).toBe("Fontainebleau loop");
});

test("save refuses to overwrite a trip.json it can't parse", () => {
  const t = mk();
  must(store().create(t));
  writeFileSync(tripJson(), "{not json");
  expect(kind(store().save(t))).toBe("corrupt");
  expect(readFileSync(tripJson(), "utf8")).toBe("{not json");
  expect(readdirSync(folder())).toEqual(["trip.json"]);
});

test("a newer file version is refused on load and on save", () => {
  const t = mk();
  must(store().create(t));
  writeFileSync(tripJson(), JSON.stringify({ ...t, v: 2 }));
  expect(kind(store().load(t.tripId))).toBe("newer-version");
  expect(kind(store().save(t))).toBe("newer-version");
});

test("a schema-invalid trip.json is reported as invalid", () => {
  const t = mk();
  must(store().create(t));
  writeFileSync(tripJson(), JSON.stringify({ ...t, name: 42 }));
  expect(kind(store().load(t.tripId))).toBe("invalid");
});

test("if the prev file can't be written, trip.json is left untouched", () => {
  const t = mk();
  must(store().create(t));
  const before = readFileSync(tripJson(), "utf8");
  mkdirSync(join(folder(), "trip.prev.json")); // blocks the prev write
  expect(kind(store().save({ ...t, name: "Renamed" }))).toBe("io");
  expect(readFileSync(tripJson(), "utf8")).toBe(before);
});

test("a renamed folder is still found", () => {
  const t = mk();
  must(store().create(t));
  renameSync(folder(), join(dir, "my-holiday"));
  expect(must(store().load(t.tripId))).toEqual(t);
});

test("an unreadable sibling doesn't break the lookup", () => {
  mkdirSync(join(dir, "broken"));
  writeFileSync(join(dir, "broken", "trip.json"), "garbage");
  const t = mk();
  must(store().create(t));
  expect(must(store().load(t.tripId))).toEqual(t);
});

test("two folders with one tripId is an error, never a pick", () => {
  const t = mk();
  must(store().create(t));
  cpSync(folder(), join(dir, `2026-10-copy-${t.tripId.slice(5, 13)}`), {
    recursive: true,
  });
  expect(kind(store().load(t.tripId))).toBe("duplicate");
  expect(kind(store().save(t))).toBe("duplicate");
});

test("a missing trip is not-found", () => {
  expect(kind(store().load(mintTripId()))).toBe("not-found");
  mkdirSync(join(dir, "x"));
  expect(kind(store().load(mintTripId()))).toBe("not-found");
});

test("load sweeps temp files a crash left behind", () => {
  const t = mk();
  must(store().create(t));
  writeFileSync(join(folder(), ".trip.json.tmp-1-0a1b2c3d"), "half");
  must(store().load(t.tripId));
  expect(readdirSync(folder())).toEqual(["trip.json"]);
});

const line: Position3[] = [
  [2.7, 48.4, 100],
  [2.71, 48.41, 120.5],
];

test("routes: round trip, same geometry is deduplicated", () => {
  const t = mk();
  must(store().create(t));
  const id = must(store().writeRoute(t.tripId, line));
  expect(id).toBe(must(store().writeRoute(t.tripId, line)));
  expect(must(store().readRoute(t.tripId, id))).toEqual(line);
  expect(readdirSync(join(folder(), "routes"))).toEqual([`${id}.geojson`]);
});

test("routes: a tampered file is detected on read and on rewrite", () => {
  const t = mk();
  must(store().create(t));
  const id = must(store().writeRoute(t.tripId, line));
  const file = join(folder(), "routes", `${id}.geojson`);
  writeFileSync(file, `${readFileSync(file, "utf8")} `);
  expect(kind(store().readRoute(t.tripId, id))).toBe("corrupt");
  expect(kind(store().writeRoute(t.tripId, line))).toBe("corrupt");
});

test("routes: missing route, too-short line", () => {
  const t = mk();
  must(store().create(t));
  const id = must(store().writeRoute(t.tripId, line));
  rmSync(join(folder(), "routes", `${id}.geojson`));
  expect(kind(store().readRoute(t.tripId, id))).toBe("not-found");
  expect(kind(store().writeRoute(t.tripId, [line[0]!]))).toBe("invalid");
});
