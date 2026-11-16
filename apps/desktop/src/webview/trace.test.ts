import { expect, test } from "bun:test";
import type { Line } from "./chat";
import { traceOf } from "./trace";

const tool = (
  name: string,
  state: "running" | "ok" | "failed",
  input: unknown = {},
  output?: unknown,
): Extract<Line, { kind: "tool" }> => ({
  key: "k",
  kind: "tool",
  name,
  state,
  input,
  output,
});

test("find_place titles and candidates", () => {
  const input = { query: "Chamonix" };
  expect(traceOf(tool("find_place", "running", input))?.title).toBe(
    "Finding Chamonix…",
  );
  const done = traceOf(
    tool("find_place", "ok", input, {
      ok: true,
      candidates: [{ label: "Chamonix", kind: "town" }],
    }),
  );
  expect(done).toMatchObject({
    title: "Found Chamonix",
    detail: ["Chamonix (town)"],
  });
});

test("route shows the stage number and stats", () => {
  const row = traceOf(
    tool(
      "route",
      "ok",
      { stageId: "stage_2_ab" },
      { ok: true, km: 12.3, gainM: 800, lossM: 640 },
    ),
  );
  expect(row).toMatchObject({
    title: "Routed stage 2",
    detail: ["12.3 km · ↑ 800 m · ↓ 640 m"],
  });
});

test("submit_brief complete or missing", () => {
  expect(
    traceOf(tool("submit_brief", "ok", {}, { complete: true, missing: [] }))
      ?.detail,
  ).toEqual(["Complete"]);
  expect(
    traceOf(
      tool(
        "submit_brief",
        "ok",
        {},
        { complete: false, missing: ["end", "dates"] },
      ),
    )?.detail,
  ).toEqual(["Missing: end, dates"]);
});

test("submit_itinerary counts stages and has no detail", () => {
  const row = traceOf(
    tool("submit_itinerary", "ok", {}, { stages: [{}, {}, {}] }),
  );
  expect(row).toMatchObject({ title: "Planned 3 stages", detail: [] });
});

test("failure shows the complete error or every issue", () => {
  expect(
    traceOf(
      tool("export_trip", "failed", {}, { ok: false, error: "disk full" }),
    ),
  ).toMatchObject({
    title: "Failed to export",
    detail: ["disk full"],
  });
  const row = traceOf(
    tool(
      "submit_brief",
      "failed",
      {},
      {
        ok: false,
        issues: [
          { path: "brief.start", message: "unknown" },
          { path: "name", message: "empty" },
        ],
      },
    ),
  );
  expect(row?.detail).toEqual(["brief.start: unknown", "name: empty"]);
});

test("tools without a row return undefined", () => {
  expect(traceOf(tool("mystery", "ok"))).toBeUndefined();
});

test("every tool has a running, done and failed title", () => {
  const input = { query: "Ubaye", stageId: "stage_3_x" };
  const output = { stages: [{}], candidates: [], missing: [] };
  const titles = (name: string) =>
    (["running", "ok", "failed"] as const).map(
      (state) => traceOf(tool(name, state, input, output))?.title,
    );
  expect(titles("find_place")).toEqual([
    "Finding Ubaye…",
    "Found Ubaye",
    "Failed to find Ubaye",
  ]);
  expect(titles("route")).toEqual([
    "Routing stage 3…",
    "Routed stage 3",
    "Failed to route stage 3",
  ]);
  expect(titles("submit_brief")).toEqual([
    "Saving brief…",
    "Saved brief",
    "Failed to save brief",
  ]);
  expect(titles("submit_itinerary")).toEqual([
    "Planning stages…",
    "Planned 1 stages",
    "Failed to plan stages",
  ]);
  expect(titles("export_trip")).toEqual([
    "Exporting…",
    "Exported GPX",
    "Failed to export",
  ]);
});

test("an interrupted or partial call has no detail and no 'undefined'", () => {
  const row = traceOf(tool("find_place", "failed"));
  expect(row).toMatchObject({ title: "Failed to find ", detail: [] });
});
