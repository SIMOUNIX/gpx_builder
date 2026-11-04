import { expect, test } from "bun:test";
import { ChatMessage } from "./chat";

const base = { id: "m1", createdAt: "2026-11-04T09:00:00.000Z" };

test("accepts text, tool-call and tool-result parts", () => {
  const assistant = ChatMessage.safeParse({
    ...base,
    role: "assistant",
    parts: [
      { type: "text", text: "Which station?" },
      {
        type: "tool-call",
        toolCallId: "c1",
        name: "ask_user",
        input: { q: 1 },
      },
    ],
  });
  const tool = ChatMessage.safeParse({
    ...base,
    role: "tool",
    parts: [{ type: "tool-result", toolCallId: "c1", output: "Avon" }],
  });
  expect(assistant.success && tool.success).toBe(true);
});

test("a call without input or a result without output still parses (JSON drops undefined)", () => {
  const msg = ChatMessage.safeParse({
    ...base,
    role: "assistant",
    parts: [
      { type: "tool-call", toolCallId: "c1", name: "validate" },
      { type: "tool-result", toolCallId: "c1" },
    ],
  });
  expect(msg.success).toBe(true);
});

test("rejects an unknown part type, role, empty id and a bad timestamp", () => {
  const ok = { ...base, role: "user", parts: [] };
  expect(ChatMessage.safeParse(ok).success).toBe(true);
  expect(
    ChatMessage.safeParse({ ...ok, parts: [{ type: "image", url: "x" }] })
      .success,
  ).toBe(false);
  expect(ChatMessage.safeParse({ ...ok, role: "robot" }).success).toBe(false);
  expect(ChatMessage.safeParse({ ...ok, id: "" }).success).toBe(false);
  expect(ChatMessage.safeParse({ ...ok, createdAt: "yesterday" }).success).toBe(
    false,
  );
  expect(
    ChatMessage.safeParse({
      ...ok,
      parts: [{ type: "tool-call", toolCallId: "", name: "x" }],
    }).success,
  ).toBe(false);
});
