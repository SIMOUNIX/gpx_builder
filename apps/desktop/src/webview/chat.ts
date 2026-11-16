import type { ChatMessage, TripId } from "@gpx-builder/core/browser";
import type { UIMessage } from "ai";

/** What the agent waits on: the `data-pending` payload of /api/chat (mirrors agent's `PendingQuestion`; the webview can't import agent). */
export type Pending =
  | {
      tool: "ask_user";
      toolCallId: string;
      question: string;
      options?: string[];
    }
  | { tool: "export_trip"; toolCallId: string };

export type ChatUIMessage = UIMessage<unknown, { pending: Pending }>;

export type Line =
  | { key: string; kind: "text"; role: "user" | "assistant"; text: string }
  | {
      key: string;
      kind: "tool";
      name: string;
      state: "running" | "ok" | "failed";
      input: unknown;
      output: unknown;
    };

type ToolState = Extract<Line, { kind: "tool" }>["state"];

const CLIENT_SIDE = ["ask_user", "export_trip"];

const question = (input: unknown) => {
  const q = (input as { question?: unknown } | undefined)?.question;
  return typeof q === "string" ? q : "";
};

const okState = (output: unknown): ToolState =>
  (output as { ok?: unknown } | undefined)?.ok === false ? "failed" : "ok";

/** /api/chat takes the new text only; the server owns the transcript (§20). */
export function chatBody(tripId: TripId, messages: ChatUIMessage[]) {
  const last = messages.findLast((m) => m.role === "user");
  const text = (last?.parts ?? [])
    .flatMap((p) => (p.type === "text" ? [p.text] : []))
    .join("");
  return { tripId, text };
}

/** The question the stored chat is waiting on, if any (same rule as the agent's `pendingToolCalls`). */
export function pendingFromChat(chat: ChatMessage[]): Pending | undefined {
  const answered = new Set(
    chat.flatMap((m) =>
      m.parts.flatMap((p) => (p.type === "tool-result" ? [p.toolCallId] : [])),
    ),
  );
  const last = chat.findLast((m) => m.role === "assistant");
  for (const p of last?.parts ?? []) {
    if (
      p.type !== "tool-call" ||
      answered.has(p.toolCallId) ||
      !CLIENT_SIDE.includes(p.name)
    )
      continue;
    if (p.name === "export_trip")
      return { tool: "export_trip", toolCallId: p.toolCallId };
    const options = (p.input as { options?: unknown } | undefined)?.options;
    return {
      tool: "ask_user",
      toolCallId: p.toolCallId,
      question: question(p.input),
      options: Array.isArray(options) ? (options as string[]) : undefined,
    };
  }
}

/** The pending question the live stream ended on, if any. */
export function pendingFromLive(
  messages: ChatUIMessage[],
): Pending | undefined {
  const last = messages.findLast((m) => m.role === "assistant");
  return last?.parts.findLast((p) => p.type === "data-pending")?.data;
}

/**
 * Stored transcript to display lines. An ask_user call shows as the question and
 * its answer as the user's line; an unanswered export_trip is the pending prompt, not a line.
 */
export function historyLines(chat: ChatMessage[]): Line[] {
  const results = new Map<string, unknown>();
  const askIds = new Set<string>();
  for (const m of chat)
    for (const p of m.parts) {
      if (p.type === "tool-result") results.set(p.toolCallId, p.output);
      if (p.type === "tool-call" && p.name === "ask_user")
        askIds.add(p.toolCallId);
    }
  return chat.flatMap((m) =>
    m.parts.flatMap((p, i): Line[] => {
      const key = `${m.id}:${i}`;
      if (p.type === "text" && m.role !== "tool")
        return [{ key, kind: "text", role: m.role, text: p.text }];
      if (p.type === "tool-call") {
        if (p.name === "ask_user")
          return [
            { key, kind: "text", role: "assistant", text: question(p.input) },
          ];
        const done = results.has(p.toolCallId);
        if (!done && CLIENT_SIDE.includes(p.name)) return [];
        return [
          {
            key,
            kind: "tool",
            name: p.name,
            // A call with no result was interrupted: it will never finish.
            state: done ? okState(results.get(p.toolCallId)) : "failed",
            input: p.input,
            output: results.get(p.toolCallId),
          },
        ];
      }
      if (p.type === "tool-result" && askIds.has(p.toolCallId)) {
        const a = (p.output as { answer?: unknown } | undefined)?.answer;
        if (typeof a === "string")
          return [{ key, kind: "text", role: "user", text: a }];
      }
      return [];
    }),
  );
}

/** The in-flight turn from `useChat` to display lines. */
export function liveLines(messages: ChatUIMessage[]): Line[] {
  return messages.flatMap((m) =>
    m.parts.flatMap((p, i): Line[] => {
      const key = `${m.id}:${i}`;
      if (p.type === "text")
        return [
          {
            key,
            kind: "text",
            role: m.role === "user" ? "user" : "assistant",
            text: p.text,
          },
        ];
      if (p.type !== "dynamic-tool") return [];
      if (p.toolName === "ask_user")
        return [
          { key, kind: "text", role: "assistant", text: question(p.input) },
        ];
      const tool = {
        key,
        kind: "tool",
        name: p.toolName,
        input: p.input,
      } as const;
      if (p.state === "output-error")
        return [{ ...tool, state: "failed", output: { error: p.errorText } }];
      if (p.state === "output-available")
        return [{ ...tool, state: okState(p.output), output: p.output }];
      if (CLIENT_SIDE.includes(p.toolName)) return []; // the pending prompt covers it
      return [{ ...tool, state: "running", output: undefined }];
    }),
  );
}
