import type { AssistantModelMessage, ModelMessage } from "ai";
import type { ChatMessage, ChatPart } from "@gpx-builder/core/server";

type AssistantPart = Exclude<AssistantModelMessage["content"], string>[number];
type ToolCallPart = Extract<ChatPart, { type: "tool-call" }>;

/** Stored transcript to the SDK's message format. */
export function toModelMessages(chat: readonly ChatMessage[]): ModelMessage[] {
  const names = new Map<string, string>(); // toolCallId -> tool name, for results
  return chat.map((m): ModelMessage => {
    if (m.role === "user") {
      const text = m.parts
        .map((p) => (p.type === "text" ? p.text : ""))
        .join("");
      return { role: "user", content: text };
    }
    if (m.role === "assistant") {
      return {
        role: "assistant",
        content: m.parts.flatMap((p): AssistantPart[] => {
          if (p.type === "text")
            return [{ type: "text" as const, text: p.text }];
          if (p.type === "tool-call") {
            names.set(p.toolCallId, p.name);
            return [
              {
                type: "tool-call" as const,
                toolCallId: p.toolCallId,
                toolName: p.name,
                input: p.input ?? {},
              },
            ];
          }
          return [];
        }),
      };
    }
    return {
      role: "tool",
      content: m.parts.flatMap((p) =>
        p.type === "tool-result"
          ? [
              {
                type: "tool-result" as const,
                toolCallId: p.toolCallId,
                toolName: names.get(p.toolCallId) ?? "unknown",
                output: {
                  type: "json" as const,
                  value: (p.output ?? null) as never,
                },
              },
            ]
          : [],
      ),
    };
  });
}

/** Tool calls of the last assistant message that have no result yet: questions waiting for the user. */
export function pendingToolCalls(chat: readonly ChatMessage[]): ToolCallPart[] {
  const answered = new Set<string>();
  for (const m of chat) {
    for (const p of m.parts) {
      if (p.type === "tool-result") answered.add(p.toolCallId);
    }
  }
  const last = [...chat].reverse().find((m) => m.role === "assistant");
  return (last?.parts ?? []).filter(
    (p): p is ToolCallPart =>
      p.type === "tool-call" && !answered.has(p.toolCallId),
  );
}

/** One finished model step to stored messages: the assistant's turn, then the tool results. */
export function stepMessages(
  content: ReadonlyArray<{ type: string } & Record<string, unknown>>,
  mint: () => { id: string; createdAt: string },
): ChatMessage[] {
  const assistant: ChatPart[] = [];
  const results: ChatPart[] = [];
  for (const c of content) {
    if (c.type === "text" && typeof c.text === "string" && c.text !== "") {
      assistant.push({ type: "text", text: c.text });
    } else if (c.type === "tool-call") {
      assistant.push({
        type: "tool-call",
        toolCallId: String(c.toolCallId),
        name: String(c.toolName),
        input: c.input,
      });
    } else if (c.type === "tool-result") {
      results.push({
        type: "tool-result",
        toolCallId: String(c.toolCallId),
        output: c.output,
      });
    } else if (c.type === "tool-error") {
      results.push({
        type: "tool-result",
        toolCallId: String(c.toolCallId),
        output: {
          ok: false,
          error: String(c.error instanceof Error ? c.error.message : c.error),
        },
      });
    }
  }
  const out: ChatMessage[] = [];
  if (assistant.length > 0)
    out.push({ ...mint(), role: "assistant", parts: assistant });
  if (results.length > 0) out.push({ ...mint(), role: "tool", parts: results });
  return out;
}
