import { expect, test } from "bun:test";
import { TripId, type ChatMessage } from "@gpx-builder/core/browser";
import {
  chatBody,
  historyLines,
  liveLines,
  pendingFromChat,
  pendingFromLive,
  turnBlocks,
  type ChatUIMessage,
  type Line,
} from "./chat";

const tripId = TripId.parse("trip_3b6f0c2a-3a52-4b8e-9d3f-1b6f0c2a7e11");
const at = "2026-11-08T10:00:00.000Z";
const msg = (
  id: string,
  role: ChatMessage["role"],
  parts: ChatMessage["parts"],
): ChatMessage => ({ id, role, createdAt: at, parts });
const ask = msg("a1", "assistant", [
  { type: "text", text: "Which region?" },
  {
    type: "tool-call",
    toolCallId: "c1",
    name: "ask_user",
    input: { question: "Alps or Pyrenees?", options: ["Alps", "Pyrenees"] },
  },
]);
const exportCall = msg("a2", "assistant", [
  { type: "tool-call", toolCallId: "c2", name: "export_trip" },
]);
const summarize = (lines: ReturnType<typeof historyLines>) =>
  lines.map((l) =>
    l.kind === "text" ? `${l.role}:${l.text}` : `${l.name}:${l.state}`,
  );

test("chatBody sends only the last user text", () => {
  const messages: ChatUIMessage[] = [
    { id: "1", role: "user", parts: [{ type: "text", text: "old" }] },
    { id: "2", role: "assistant", parts: [{ type: "text", text: "hi" }] },
    { id: "3", role: "user", parts: [{ type: "text", text: "new" }] },
  ];
  expect(chatBody(tripId, messages)).toEqual({ tripId, text: "new" });
});

test("pendingFromChat finds an unanswered ask_user with options", () => {
  expect(pendingFromChat([ask])).toEqual({
    tool: "ask_user",
    toolCallId: "c1",
    question: "Alps or Pyrenees?",
    options: ["Alps", "Pyrenees"],
  });
});

test("pendingFromChat finds an unanswered export_trip", () => {
  expect(pendingFromChat([exportCall])).toEqual({
    tool: "export_trip",
    toolCallId: "c2",
  });
});

test("pendingFromChat is empty once answered, or for other tools", () => {
  const answer = msg("t1", "tool", [
    { type: "tool-result", toolCallId: "c1", output: { answer: "Alps" } },
  ]);
  expect(pendingFromChat([ask, answer])).toBeUndefined();
  const other = msg("a3", "assistant", [
    { type: "tool-call", toolCallId: "c3", name: "find_place" },
  ]);
  expect(pendingFromChat([other])).toBeUndefined();
});

test("pendingFromLive reads the data-pending part", () => {
  const pending = { tool: "export_trip", toolCallId: "c2" } as const;
  const live: ChatUIMessage[] = [
    {
      id: "m",
      role: "assistant",
      parts: [{ type: "data-pending", data: pending }],
    },
  ];
  expect(pendingFromLive(live)).toEqual(pending);
  expect(pendingFromLive([])).toBeUndefined();
});

test("historyLines: text, tool state, ask_user as question and answer", () => {
  const tools = msg("a4", "assistant", [
    { type: "tool-call", toolCallId: "g1", name: "find_place" },
    { type: "tool-call", toolCallId: "g2", name: "route" },
    { type: "tool-call", toolCallId: "g3", name: "submit_brief" },
  ]);
  const results = msg("t2", "tool", [
    { type: "tool-result", toolCallId: "g1", output: { ok: true } },
    { type: "tool-result", toolCallId: "g2", output: { ok: false } },
  ]);
  const answer = msg("t1", "tool", [
    { type: "tool-result", toolCallId: "c1", output: { answer: "Alps" } },
  ]);
  expect(
    summarize(
      historyLines([
        msg("u1", "user", [{ type: "text", text: "plan" }]),
        ask,
        answer,
        tools,
        results,
      ]),
    ),
  ).toEqual([
    "user:plan",
    "assistant:Which region?",
    "assistant:Alps or Pyrenees?",
    "user:Alps",
    "find_place:ok",
    "route:failed",
    "submit_brief:failed", // no result: interrupted
  ]);
});

test("historyLines: export_trip is a line once answered, none while pending", () => {
  expect(historyLines([exportCall])).toEqual([]);
  const declined = msg("t3", "tool", [
    {
      type: "tool-result",
      toolCallId: "c2",
      output: { ok: false, declined: true },
    },
  ]);
  expect(summarize(historyLines([exportCall, declined]))).toEqual([
    "export_trip:failed",
  ]);
});

test("liveLines maps text and dynamic tool parts", () => {
  const live: ChatUIMessage[] = [
    { id: "u", role: "user", parts: [{ type: "text", text: "go" }] },
    {
      id: "a",
      role: "assistant",
      parts: [
        { type: "text", text: "ok" },
        {
          type: "dynamic-tool",
          toolName: "find_place",
          toolCallId: "g1",
          state: "output-available",
          input: {},
          output: { ok: true },
        },
        {
          type: "dynamic-tool",
          toolName: "route",
          toolCallId: "g2",
          state: "output-available",
          input: {},
          output: { ok: false },
        },
        {
          type: "dynamic-tool",
          toolName: "submit_itinerary",
          toolCallId: "g3",
          state: "input-available",
          input: {},
        },
        {
          type: "dynamic-tool",
          toolName: "export_trip",
          toolCallId: "g4",
          state: "input-available",
          input: {},
        },
      ],
    },
  ];
  expect(summarize(liveLines(live))).toEqual([
    "user:go",
    "assistant:ok",
    "find_place:ok",
    "route:failed",
    "submit_itinerary:running",
  ]);
});

test("lines carry the tool input and output", () => {
  const call = msg("a5", "assistant", [
    {
      type: "tool-call",
      toolCallId: "g5",
      name: "find_place",
      input: { query: "Ubaye" },
    },
  ]);
  const res = msg("t5", "tool", [
    {
      type: "tool-result",
      toolCallId: "g5",
      output: { ok: true, candidates: [] },
    },
  ]);
  expect(historyLines([call, res])[0]).toMatchObject({
    input: { query: "Ubaye" },
    output: { ok: true, candidates: [] },
  });
});

const say = (key: string, role: "user" | "assistant", text = key): Line => ({
  key,
  kind: "text",
  role,
  text,
});
const step = (
  key: string,
  state: "running" | "ok" | "failed",
  query = key,
): Line => ({
  key,
  kind: "tool",
  name: "find_place",
  state,
  input: { query },
  output: undefined,
});
const summaries = (lines: Line[], busy: boolean) =>
  turnBlocks(lines, busy).map((b) =>
    b.kind === "summary"
      ? { title: b.title, running: b.running, items: b.items.map((i) => i.key) }
      : b.line.key,
  );

test("a finished turn folds steps and in-between text, keeping the final answer outside", () => {
  const lines = [
    say("u", "user"),
    step("s1", "ok"),
    say("mid", "assistant"),
    step("s2", "failed"),
    say("final", "assistant"),
  ];
  expect(summaries(lines, false)).toEqual([
    "u",
    { title: "2 steps, 1 failed", running: false, items: ["s1", "mid", "s2"] },
    "final",
  ]);
});

test("one step is singular", () => {
  expect(
    summaries(
      [say("u", "user"), step("s1", "ok"), say("f", "assistant")],
      false,
    )[1],
  ).toMatchObject({ title: "1 step" });
});

test("a running turn is open and titled with the latest running step", () => {
  const lines = [
    say("u", "user"),
    step("s1", "running", "Aosta"),
    step("s2", "running", "Chamonix"),
  ];
  expect(summaries(lines, true)[1]).toEqual({
    title: "Finding Chamonix…",
    running: true,
    items: ["s1", "s2"],
  });
});

test("a running turn with no active step is Thinking", () => {
  expect(
    summaries([say("u", "user"), step("s1", "ok")], true)[1],
  ).toMatchObject({ title: "Thinking", running: true });
  expect(summaries([say("u", "user")], true)[1]).toEqual({
    title: "Thinking",
    running: true,
    items: [],
  });
});

test("a turn without steps shows no summary once text arrives", () => {
  expect(summaries([say("u", "user"), say("a", "assistant")], true)).toEqual([
    "u",
    "a",
  ]);
  expect(summaries([say("u", "user"), say("a", "assistant")], false)).toEqual([
    "u",
    "a",
  ]);
});

test("each turn gets its own summary", () => {
  const lines = [
    say("u1", "user"),
    step("s1", "ok"),
    say("a1", "assistant"),
    say("u2", "user"),
    step("s2", "ok"),
    say("a2", "assistant"),
  ];
  expect(summaries(lines, false).map((b) => typeof b)).toEqual([
    "string",
    "object",
    "string",
    "string",
    "object",
    "string",
  ]);
});
