import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { err, ok, mintTripId, type Trip } from "@gpx-builder/core/server";
import { createTripStore } from "@gpx-builder/store";
import { main, type Collaborators } from "./main";

class Exit extends Error {
  constructor(readonly code?: number) {
    super(`exit ${code}`);
  }
}

let dir: string;
let out: string[];
const realStdin = Object.getOwnPropertyDescriptor(process, "stdin")!;
const tripsDir = () => join(dir, "trips");
const savedTrips = () => readdirSync(tripsDir()).length;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gpx-cli-"));
  process.env.GPX_BUILDER_DATA_DIR = join(dir, "data");
  process.env.GPX_BUILDER_CACHE_DIR = join(dir, "cache");
  process.env.GPX_BUILDER_TRIPS_DIR = tripsDir();
  out = [];
  const grab = (...a: unknown[]) => void out.push(a.join(" "));
  spyOn(console, "log").mockImplementation(grab);
  spyOn(console, "error").mockImplementation(grab);
  spyOn(process.stdout, "write").mockImplementation((s) => !!out.push(`${s}`));
  spyOn(process, "exit").mockImplementation((code) => {
    throw new Exit(code as number);
  });
});

afterEach(() => {
  Object.defineProperty(process, "stdin", realStdin);
  for (const k of ["DATA", "CACHE", "TRIPS"])
    delete process.env[`GPX_BUILDER_${k}_DIR`];
  rmSync(dir, { recursive: true, force: true });
  spyOn(console, "log").mockRestore();
  spyOn(console, "error").mockRestore();
  spyOn(process.stdout, "write").mockRestore();
  spyOn(process, "exit").mockRestore();
});

const typed = (...lines: string[]) =>
  Object.defineProperty(process, "stdin", {
    value: Readable.from(lines.map((l) => `${l}\n`)),
    configurable: true,
  });

const collab = (over: Partial<Collaborators> = {}): Collaborators => ({
  secrets: {
    get: async () => "key",
    sourceOf: async () => "env",
  } as never,
  createStrongModel: async () => ok({} as never),
  pendingQuestion: () => ok(undefined),
  runTurn: async () => ok({ pending: undefined }),
  ...over,
});

const exits = async (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e) => (e instanceof Exit ? e.code : Promise.reject(e)),
  );
// Colors and spinner redraws only appear on a TTY; strip them so the test passes in a terminal and in CI.
// eslint-disable-next-line no-control-regex
const said = () => out.join("\n").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

const seedTrip = (): Trip => {
  const at = "2026-11-01T10:00:00.000Z";
  const trip: Trip = {
    v: 1,
    tripId: mintTripId(),
    name: "Seeded trip",
    createdAt: at,
    updatedAt: at,
    brief: {},
    stages: [],
    waypoints: {},
    registry: { places: {}, pois: {} },
  };
  createTripStore({ tripsDir: tripsDir() }).create(trip);
  return trip;
};

test("a bad argument exits 1", async () => {
  expect(await exits(main(["--nope"], collab()))).toBe(1);
  expect(said()).toContain("unknown argument --nope");
});

test("trips: empty, then listed", async () => {
  await main(["trips"], collab());
  expect(said()).toContain("no trips yet");
  seedTrip();
  await main(["trips"], collab());
  expect(said()).toContain("Seeded trip");
});

test("missing keys exit 1 and name them", async () => {
  const secrets = {
    get: async () => undefined,
    sourceOf: async () => undefined,
  };
  expect(await exits(main([], collab({ secrets: secrets as never })))).toBe(1);
  expect(said()).toContain("ORS_API_KEY and ANTHROPIC_API_KEY");
});

test("a model that can't be built exits 1", async () => {
  const bad = collab({
    createStrongModel: async () => err({ message: "no model" }),
  });
  expect(await exits(main([], bad))).toBe(1);
  expect(said()).toContain("no model");
});

test("a new trip nobody wrote to is deleted on quit", async () => {
  typed("/trips", "", "exit");
  expect(await exits(main([], collab()))).toBe(0);
  expect(said()).toContain("secrets: ORS_API_KEY ← env");
  expect(savedTrips()).toBe(0);
});

test("a turn streams text and tool progress, then asks the question", async () => {
  typed("plan me a trip", "/quit");
  const runTurn: Collaborators["runTurn"] = async (_d, text, hooks) => {
    expect(text).toBe("plan me a trip");
    hooks?.onText?.("");
    hooks?.onText?.("hello\x1b[31m there");
    hooks?.onToolCall?.("route", { stageId: "s" });
    hooks?.onToolResult?.("route", true);
    hooks?.onToolResult?.("find_place", false);
    return ok({
      pending: {
        tool: "ask_user",
        toolCallId: "c",
        question: "Which day?",
        options: ["1", "2"],
      },
    });
  };
  expect(await exits(main(["--verbose"], collab({ runTurn })))).toBe(0);
  expect(said()).toContain("hello[31m there"); // the ESC is dropped
  expect(said()).toContain("→ route");
  expect(said()).toContain("✗ find_place");
  expect(said()).toContain("Which day? (1 / 2)");
  expect(savedTrips()).toBe(1); // it was written to, so it stays
});

test("a failed turn is reported and the loop goes on", async () => {
  typed("hi", "again");
  const runTurn = async () => err({ message: "529 overloaded" });
  expect(await exits(main([], collab({ runTurn })))).toBe(0);
  expect(said().match(/529 overloaded/g)).toHaveLength(2);
});

test("--trip resumes a trip and shows the question it was waiting on", async () => {
  const trip = seedTrip();
  typed("exit");
  const pendingQuestion: Collaborators["pendingQuestion"] = () =>
    ok({ tool: "export_trip", toolCallId: "c" });
  expect(
    await exits(main(["--trip", trip.tripId], collab({ pendingQuestion }))),
  ).toBe(0);
  expect(said()).toContain("Seeded trip");
  expect(said()).toContain("Write the GPX files? [y/N]");
  expect(savedTrips()).toBe(1); // a resumed trip is never deleted
});

test("--trip with a bad or unknown id exits 1", async () => {
  expect(await exits(main(["--trip", "nope"], collab()))).toBe(1);
  expect(said()).toContain("bad trip id");
  expect(await exits(main(["--trip", mintTripId()], collab()))).toBe(1);
  expect(said()).toContain("cannot resume");
});
