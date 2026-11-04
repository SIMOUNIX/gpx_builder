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
import {
  mintChatId,
  type ChatMessage,
  type Result,
  type StoreError,
} from "@gpx-builder/core/server";
import { createChatStore } from "./chat-store";

let dir: string;
let clock: number;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gpx-chat-"));
  clock = Date.parse("2026-11-04T09:00:00.000Z");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const store = () =>
  createChatStore({ dataDir: dir, now: () => new Date((clock += 1000)) });

const must = <T>(r: Result<T, StoreError>): T => {
  if (!r.ok) throw new Error(`${r.error.kind}: ${r.error.message}`);
  return r.value;
};
const kind = <T>(r: Result<T, StoreError>) => (r.ok ? "ok" : r.error.kind);

const msg = (id: string, text = id): ChatMessage => ({
  id,
  role: "user",
  createdAt: "2026-11-04T09:00:00.000Z",
  parts: [{ type: "text", text }],
});
const lineOf = (m: ChatMessage) => `${JSON.stringify({ v: 1, message: m })}\n`;

const chatId = mintChatId();
const chatFile = () => join(dir, "chats", `${chatId}.jsonl`);
const quarantine = () =>
  existsSync(join(dir, "quarantine"))
    ? readdirSync(join(dir, "quarantine")).sort()
    : [];

const seed = (text: string) => {
  mkdirSync(join(dir, "chats"));
  writeFileSync(chatFile(), text);
};
test("append then load keeps order; every line carries v and ends with a newline", () => {
  const s = store();
  must(s.append(chatId, msg("a")));
  must(s.append(chatId, msg("b")));
  expect(must(s.load(chatId)).map((m) => m.id)).toEqual(["a", "b"]);
  const lines = readFileSync(chatFile(), "utf8").split("\n");
  expect(lines).toHaveLength(3);
  expect(lines[2]).toBe("");
  expect(JSON.parse(lines[0]!).v).toBe(1);
});

test("loading a chat that doesn't exist is not-found", () => {
  expect(kind(store().load(mintChatId()))).toBe("not-found");
});

test("append refuses an invalid message or id and writes nothing", () => {
  const s = store();
  expect(kind(s.append(chatId, { ...msg("a"), role: "robot" } as never))).toBe(
    "invalid",
  );
  expect(kind(s.append("../evil" as never, msg("a")))).toBe("invalid");
  expect(kind(s.load("../evil" as never))).toBe("invalid");
  expect(existsSync(join(dir, "chats"))).toBe(false);
});

test("newlines, quotes and a 1 MB message survive a round trip on one line", () => {
  const s = store();
  const big = `line1\nline2 "quoted" ${"x".repeat(1_000_000)}`;
  must(s.append(chatId, msg("big", big)));
  expect(readFileSync(chatFile(), "utf8").split("\n")).toHaveLength(2);
  const loaded = must(s.load(chatId))[0]!;
  expect(loaded.parts).toEqual([{ type: "text", text: big }]);
});

test("a tool call without input round trips", () => {
  const s = store();
  const m: ChatMessage = {
    ...msg("t"),
    role: "assistant",
    parts: [{ type: "tool-call", toolCallId: "c1", name: "validate" }],
  };
  must(s.append(chatId, m));
  expect(must(s.load(chatId))).toEqual([m]);
});

test("a last line that parses but lost its newline is kept and the newline restored", () => {
  seed(lineOf(msg("a")) + lineOf(msg("b")).trimEnd());
  const s = store();
  expect(must(s.load(chatId)).map((m) => m.id)).toEqual(["a", "b"]);
  expect(readFileSync(chatFile(), "utf8")).toBe(
    lineOf(msg("a")) + lineOf(msg("b")),
  );
  expect(quarantine()).toEqual([]);
});

test("a torn last line is cut off, a copy is saved, and the chat keeps working", () => {
  const torn = '{"v":1,"message":{"id":"b","ro';
  seed(lineOf(msg("a")) + torn);
  const s = store();
  expect(must(s.load(chatId)).map((m) => m.id)).toEqual(["a"]);
  expect(readFileSync(chatFile(), "utf8")).toBe(lineOf(msg("a")));
  const files = quarantine();
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(/\.tail$/);
  expect(readFileSync(join(dir, "quarantine", files[0]!), "utf8")).toBe(torn);
  must(s.append(chatId, msg("c")));
  expect(must(s.load(chatId)).map((m) => m.id)).toEqual(["a", "c"]);
});

test("append repairs a torn tail before writing, so lines never glue together", () => {
  seed(lineOf(msg("a")) + '{"v":1,"mess');
  const s = store();
  must(s.append(chatId, msg("b")));
  expect(readFileSync(chatFile(), "utf8")).toBe(
    lineOf(msg("a")) + lineOf(msg("b")),
  );
});

test("a damaged line in the middle moves the whole file to quarantine", () => {
  const original = lineOf(msg("a")) + "garbage\n" + lineOf(msg("c"));
  seed(original);
  const s = store();
  const r = s.load(chatId);
  expect(kind(r)).toBe("corrupt");
  expect(!r.ok && r.error.message).toContain("line 2");
  expect(existsSync(chatFile())).toBe(false);
  const files = quarantine();
  expect(files).toHaveLength(1);
  expect(readFileSync(join(dir, "quarantine", files[0]!), "utf8")).toBe(
    original,
  );
});

test("a line that is valid JSON but fails the schema counts as damaged", () => {
  seed(
    lineOf(msg("a")) +
      JSON.stringify({ v: 1, message: { ...msg("b"), role: "robot" } }) +
      "\n",
  );
  expect(kind(store().load(chatId))).toBe("corrupt");
  expect(quarantine()).toHaveLength(1);
});

test("a quarantined chat is reported on load and refused on append, and nothing is recreated", () => {
  seed("garbage\n");
  const s = store();
  expect(kind(s.load(chatId))).toBe("corrupt"); // quarantines it
  expect(kind(s.load(chatId))).toBe("corrupt"); // says so again, not 'not-found'
  expect(kind(s.append(chatId, msg("x")))).toBe("corrupt");
  expect(existsSync(chatFile())).toBe(false);
});

test("quarantining the same chat twice keeps both files", () => {
  const s = store();
  seed("garbage\n");
  s.load(chatId);
  writeFileSync(chatFile(), "garbage2\n"); // the chat file reappears damaged
  s.load(chatId);
  expect(quarantine().filter((n) => n.endsWith(".jsonl"))).toHaveLength(2);
});
