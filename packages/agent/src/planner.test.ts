import { expect, test } from "bun:test";
import {
  PlaceId,
  mintChatId,
  type GeocodeCandidate,
} from "@gpx-builder/core/server";
import { run } from "./test-util";
import { MAX_TOOL_FAILURES, pendingQuestion, runTurn } from "./planner";
import {
  depsFor,
  emptyTrip,
  fakeGeocode,
  fakeRouting,
  memoryChats,
  memoryTrips,
  scriptedModel,
  type Script,
} from "./test-util";
import { createTools } from "./tools/index";
import { toolCallingSelfTest } from "./self-test";

const gare = PlaceId.parse("geo:photon:node/1");
const candidates: GeocodeCandidate[] = [
  {
    placeId: gare,
    label: "Gare, Avon",
    kind: "railway=station",
    lngLat: [2.7, 48.4],
  },
];

function setup(script: Script[]) {
  const trips = memoryTrips(emptyTrip());
  const chats = memoryChats();
  const model = scriptedModel(script);
  const deps = {
    ...depsFor(
      trips,
      fakeGeocode(candidates),
      fakeRouting({ line: [], distanceM: 0, snapDistancesM: [] }),
    ),
    chats,
    chatId: mintChatId(),
    model,
    now: () => new Date("2026-11-05T10:00:00.000Z"),
  };
  return { trips, chats, model, deps };
}

const textOf = (m: { parts: { type: string; text?: string }[] }) =>
  m.parts.map((p) => p.text ?? "").join("");

test("a plain turn stores the question and the answer and streams the text", async () => {
  const { chats, deps } = setup([{ text: "Hello, where do you live?" }]);
  const seen: string[] = [];
  const r = await runTurn(deps, "I want a hike", {
    onText: (d) => seen.push(d),
  });
  expect(r).toEqual({ ok: true, value: { pending: undefined } });
  expect(seen.join("")).toBe("Hello, where do you live?");
  const roles = chats.all().map((m) => m.role);
  expect(roles).toEqual(["user", "assistant"]);
  expect(textOf(chats.all()[1]!)).toBe("Hello, where do you live?");
});

test("tools run and every step is stored in order", async () => {
  const { chats, trips, deps } = setup([
    { calls: [{ name: "find_place", input: { query: "gare avon" } }] },
    { text: "Found it." },
  ]);
  const r = await runTurn(deps, "start at the station in Avon");
  expect(r.ok).toBe(true);
  expect(trips.trip().registry.places[gare]?.label).toBe("Gare, Avon");
  expect(chats.all().map((m) => m.role)).toEqual([
    "user",
    "assistant",
    "tool",
    "assistant",
  ]);
  const call = chats.all()[1]!.parts[0]!;
  expect(call).toMatchObject({ type: "tool-call", name: "find_place" });
  const result = chats.all()[2]!.parts[0]!;
  expect(result).toMatchObject({
    type: "tool-result",
    toolCallId: (call as { toolCallId: string }).toolCallId,
  });
  expect(JSON.stringify(result)).not.toContain("2.7"); // no coordinates in the transcript
});

test("tool hooks fire for each call and result, with ok from the output", async () => {
  const { deps } = setup([
    { calls: [{ name: "find_place", input: { query: "gare avon" } }] },
    { calls: [{ name: "route", input: { stageId: "stage_9_aaaaaaaa" } }] },
    { text: "done" },
  ]);
  const events: string[] = [];
  await runTurn(deps, "go", {
    onToolCall: (n, i) => events.push(`call ${n} ${JSON.stringify(i)}`),
    onToolResult: (n, ok) => events.push(`result ${n} ${ok}`),
  });
  expect(events).toEqual([
    'call find_place {"query":"gare avon"}',
    "result find_place true",
    'call route {"stageId":"stage_9_aaaaaaaa"}',
    "result route false",
  ]);
});

test("the model is shown the phase prompt and the trip digest", async () => {
  const { model, deps } = setup([{ text: "ok" }]);
  await runTurn(deps, "hi");
  const prompt = JSON.stringify(model.doStreamCalls[0]!.prompt);
  expect(prompt).toContain("gather the brief");
  expect(prompt).toContain("Trip trip_");
  expect(prompt).toContain("missing:");
});

test("ask_user ends the turn with a pending question, and the next input answers it", async () => {
  const { chats, model, deps } = setup([
    {
      calls: [
        {
          name: "ask_user",
          input: { question: "Where do you live?", options: ["Paris", "Lyon"] },
        },
      ],
    },
    { text: "Thanks, Paris." },
  ]);
  const first = await runTurn(deps, "plan me a hike");
  expect(first.ok && first.value.pending).toMatchObject({
    question: "Where do you live?",
    options: ["Paris", "Lyon"],
  });
  // the pending call is on disk, with no result yet
  const stored = chats.all();
  expect(stored.at(-1)).toMatchObject({ role: "assistant" });
  // "after a restart": a fresh look at the same store still sees the question
  const again = pendingQuestion(chats, deps.chatId);
  expect(again.ok && again.value).toMatchObject({
    tool: "ask_user",
    question: "Where do you live?",
  });

  const second = await runTurn(deps, "Paris");
  expect(second).toEqual({ ok: true, value: { pending: undefined } });
  const toolMsg = chats.all().find((m) => m.role === "tool")!;
  expect(toolMsg.parts[0]).toMatchObject({
    type: "tool-result",
    output: { answer: "Paris" },
  });
  // the model saw the answer as the tool result
  expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).toContain("Paris");
  expect(chats.all().filter((m) => m.role === "user")).toHaveLength(1); // the answer is not a second user message
});

test("the instructions follow the phase inside one turn", async () => {
  const { model, deps } = setup([
    { calls: [{ name: "find_place", input: { query: "gare" } }] },
    {
      calls: [
        {
          name: "submit_brief",
          input: {
            brief: {
              days: 2,
              maxKmPerDay: 25,
              maxGainPerDay: 800,
              start: { placeId: gare, publicTransport: true },
              end: { placeId: gare, publicTransport: true },
              overnight: "camp",
              travel: { from: gare, modes: ["train"], maxOneWayHours: 2 },
            },
          },
        },
      ],
    },
    { text: "Brief done." },
  ]);
  await runTurn(deps, "go");
  const sent = (n: number) => JSON.stringify(model.doStreamCalls[n]!.prompt);
  expect(sent(0)).toContain("gather the brief");
  expect(sent(2)).toContain("plan the itinerary");
});

test("a tool that keeps failing is taken away and the model is told to ask", async () => {
  const bad = { name: "route", input: { stageId: "stage_9_aaaaaaaa" } };
  const { model, deps } = setup([
    { calls: [bad] },
    { calls: [bad] },
    { calls: [bad] },
    { text: "I need help." },
  ]);
  await runTurn(deps, "route it");
  const toolNames = (n: number) =>
    (model.doStreamCalls[n]!.tools ?? []).map((t) => t.name);
  expect(MAX_TOOL_FAILURES).toBe(3);
  expect(toolNames(2)).toContain("route");
  expect(toolNames(3)).not.toContain("route");
  expect(toolNames(3)).toContain("ask_user");
  expect(JSON.stringify(model.doStreamCalls[3]!.prompt)).toContain(
    "disabled: route",
  );
});

test("a model failure is returned, not thrown", async () => {
  const { deps } = setup([{ fail: "529 overloaded" }]);
  const r = await runTurn(deps, "hi");
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.message).toContain("overloaded");
});

test("self-test passes for a model that calls the tool and fails for one that does not", async () => {
  const good = scriptedModel([
    { calls: [{ name: "ping", input: { word: "ok" } }] },
    { text: "done" },
  ]);
  expect((await toolCallingSelfTest(good)).ok).toBe(true);
  const bad = scriptedModel([{ text: "I will not call tools" }]);
  const r = await toolCallingSelfTest(bad);
  expect(r.ok).toBe(false);
});

const village = PlaceId.parse("geo:photon:node/2");

/** A trip with one routed stage, ready to export, and a model that asks to export. */
async function exportSetup() {
  const trips = memoryTrips(emptyTrip());
  const geocode = fakeGeocode([
    ...candidates,
    {
      placeId: village,
      label: "Larchant",
      kind: "place=village",
      lngLat: [2.58, 48.28],
    },
  ]);
  const routing = fakeRouting({
    line: [
      [2.7, 48.4, 100],
      [2.6, 48.3, 120],
    ],
    distanceM: 1000,
    snapDistancesM: [0, 0],
  });
  const model = scriptedModel([
    { calls: [{ name: "export_trip", input: {} }] },
    { text: "Files written." },
  ]);
  const deps = {
    ...depsFor(trips, geocode, routing),
    chats: memoryChats(),
    chatId: mintChatId(),
    model,
  };
  const tools = createTools(deps);
  await run(tools.find_place, { query: "x" });
  await run(tools.submit_brief, {
    brief: {
      days: 1,
      maxKmPerDay: 25,
      maxGainPerDay: 800,
      start: { placeId: gare, publicTransport: true },
      end: { placeId: gare, publicTransport: true },
      overnight: "camp",
      travel: { from: gare, modes: ["train"], maxOneWayHours: 2 },
    },
  });
  const made = await run<{ stages: { stageId: string }[] }>(
    tools.submit_itinerary,
    { stages: [{ from: gare, to: village }] },
  );
  await run(tools.route, { stageId: made.stages[0]!.stageId });
  return { trips, deps, model };
}

test("export_trip waits for a y/N; yes writes the files and the turn continues", async () => {
  const { trips, deps, model } = await exportSetup();
  const first = await runTurn(deps, "export it");
  expect(first.ok && first.value.pending?.tool).toBe("export_trip");
  expect(Object.keys(trips.derived)).toEqual([]); // nothing written before the answer
  const again = pendingQuestion(deps.chats, deps.chatId);
  expect(again.ok && again.value?.tool).toBe("export_trip");

  const seen: string[] = [];
  const second = await runTurn(deps, " Yes ", { onText: (d) => seen.push(d) });
  expect(second).toEqual({ ok: true, value: { pending: undefined } });
  expect(Object.keys(trips.derived)).toContain("route-merged.gpx");
  const result = deps.chats.load(deps.chatId);
  const stored = result.ok
    ? result.value.find((m) => m.role === "tool")!.parts[0]
    : undefined;
  expect(stored).toMatchObject({ type: "tool-result", output: { ok: true } });
  expect(JSON.stringify(stored)).toContain("day-1.gpx");
  expect(seen.join("")).toBe("Files written."); // the model reported the outcome
  expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).toContain("day-1.gpx");
});

test("anything but y/yes declines the export and writes nothing", async () => {
  const { trips, deps, model } = await exportSetup();
  await runTurn(deps, "export it");
  const r = await runTurn(deps, "no, wait");
  expect(r).toEqual({ ok: true, value: { pending: undefined } });
  expect(Object.keys(trips.derived)).toEqual([]);
  expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).toContain("declined");
});

test("a leftover non-client call is closed as interrupted and the input is a normal message", async () => {
  const { chats, deps } = setup([{ text: "ok" }]);
  chats.append(deps.chatId, {
    id: "u1",
    createdAt: "2026-11-05T10:00:00.000Z",
    role: "user",
    parts: [{ type: "text", text: "route it" }],
  });
  chats.append(deps.chatId, {
    id: "a1",
    createdAt: "2026-11-05T10:00:01.000Z",
    role: "assistant",
    parts: [{ type: "tool-call", toolCallId: "c1", name: "route", input: {} }],
  });
  const p = pendingQuestion(chats, deps.chatId);
  expect(p).toEqual({ ok: true, value: undefined }); // not shown as a question
  await runTurn(deps, "hello again");
  const all = chats.all();
  expect(all[2]).toMatchObject({
    role: "tool",
    parts: [{ toolCallId: "c1", output: { ok: false } }],
  });
  expect(all[3]).toMatchObject({ role: "user" });
  expect(JSON.stringify(all[3])).toContain("hello again");
});

test("a tool that throws reports a failed result to the hook", async () => {
  const { deps } = setup([
    { calls: [{ name: "find_place", input: { query: 5 } }] },
    { text: "done" },
  ]);
  const seen: string[] = [];
  await runTurn(deps, "go", {
    onToolResult: (n, ok) => seen.push(`${n} ${ok}`),
  });
  expect(seen).toEqual(["find_place false"]);
});
