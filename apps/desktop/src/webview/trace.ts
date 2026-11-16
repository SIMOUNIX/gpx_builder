import type { Line } from "./chat";

type Tool = Extract<Line, { kind: "tool" }>;

/** What a tool call shows as a Trace row; `detail` is the expanded content, one entry per line. */
export type TraceRow = {
  icon: "MapPin" | "Route" | "ClipboardList" | "CalendarDays" | "Download";
  title: string;
  detail: string[];
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);

/** The complete failure message: the `error` string, or every `path: message` issue. */
const failure = (output: unknown): string[] => {
  const { error, issues } = obj(output);
  if (typeof error === "string") return [error];
  return list(issues).map((i) => `${i.path}: ${i.message}`);
};

type Spec = {
  icon: TraceRow["icon"];
  running: (input: Obj) => string;
  done: (input: Obj, output: Obj) => string;
  failed: (input: Obj) => string;
  detail: (output: Obj) => string[];
};

const stageNo = (input: Obj) =>
  /^stage_(\d+)_/.exec(String(input.stageId))?.[1] ?? "";

const SPECS: Record<string, Spec> = {
  find_place: {
    icon: "MapPin",
    running: (i) => `Finding ${i.query}…`,
    done: (i) => `Found ${i.query}`,
    failed: (i) => `Failed to find ${i.query}`,
    detail: (o) => list(o.candidates).map((c) => `${c.label} (${c.kind})`),
  },
  route: {
    icon: "Route",
    running: (i) => `Routing stage ${stageNo(i)}…`,
    done: (i) => `Routed stage ${stageNo(i)}`,
    failed: (i) => `Failed to route stage ${stageNo(i)}`,
    detail: (o) => [`${o.km} km · ↑ ${o.gainM} m · ↓ ${o.lossM} m`],
  },
  submit_brief: {
    icon: "ClipboardList",
    running: () => "Saving brief…",
    done: () => "Saved brief",
    failed: () => "Failed to save brief",
    detail: (o) => [
      o.complete
        ? "Complete"
        : `Missing: ${(o.missing as string[]).join(", ")}`,
    ],
  },
  submit_itinerary: {
    icon: "CalendarDays",
    running: () => "Planning stages…",
    done: (_, o) => `Planned ${list(o.stages).length} stages`,
    failed: () => "Failed to plan stages",
    detail: () => [],
  },
  export_trip: {
    icon: "Download",
    running: () => "Exporting…",
    done: () => "Exported GPX",
    failed: () => "Failed to export",
    detail: () => [],
  },
};

/** The Trace row for a tool call, or undefined for a tool that has none. */
export function traceOf(line: Tool): TraceRow | undefined {
  const spec = SPECS[line.name];
  if (!spec) return undefined;
  const input = obj(line.input);
  const output = obj(line.output);
  const { state } = line;
  return {
    icon: spec.icon,
    title: spec[state === "ok" ? "done" : state](input, output),
    detail:
      state === "failed"
        ? failure(output)
        : state === "ok"
          ? spec.detail(output)
          : [],
  };
}
