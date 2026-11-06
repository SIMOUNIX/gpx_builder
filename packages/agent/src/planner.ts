import { ToolLoopAgent, type LanguageModel } from "ai";
import {
  err,
  exportTrip,
  ok,
  phase,
  renderDigest,
  type ChatId,
  type ChatMessage,
  type ChatStorePort,
  type Result,
} from "@gpx-builder/core/server";
import type { AgentDeps } from "./deps";
import { pendingToolCalls, stepMessages, toModelMessages } from "./messages";
import { failStore } from "./results";
import { systemPrompt } from "./prompts/index";
import { createTools } from "./tools/index";

/** A tool that failed this many times in one turn is taken away: the model must ask the user. */
export const MAX_TOOL_FAILURES = 3;

export type PlannerDeps = AgentDeps & {
  chats: ChatStorePort;
  chatId: ChatId;
  model: LanguageModel;
  now?: () => Date;
};

export type TurnHooks = {
  onText?: (delta: string) => void;
  onToolCall?: (name: string, input: unknown) => void;
  onToolResult?: (name: string, ok: boolean) => void;
};

/** A client-side call waiting for the user: a question, or the y/N for the export. */
export type PendingQuestion =
  | {
      tool: "ask_user";
      toolCallId: string;
      question: string;
      options?: string[];
    }
  | { tool: "export_trip"; toolCallId: string };

export type TurnOutcome = {
  /** Set when the turn ended on ask_user: the next user input answers it. */
  pending?: PendingQuestion;
};

export type TurnError = { message: string };

const asQuestion = (c: {
  toolCallId: string;
  name: string;
  input?: unknown;
}): PendingQuestion => {
  if (c.name === "export_trip")
    return { tool: "export_trip", toolCallId: c.toolCallId };
  const i = (c.input ?? {}) as { question?: unknown; options?: unknown };
  return {
    tool: "ask_user",
    toolCallId: c.toolCallId,
    question: typeof i.question === "string" ? i.question : "",
    options: Array.isArray(i.options) ? (i.options as string[]) : undefined,
  };
};

/** The question the chat is waiting on, if any (used when the app restarts). */
export function pendingQuestion(
  chats: ChatStorePort,
  chatId: ChatId,
): Result<PendingQuestion | undefined, TurnError> {
  const loaded = chats.load(chatId);
  if (!loaded.ok) {
    return loaded.error.kind === "not-found"
      ? ok(undefined)
      : err({ message: loaded.error.message });
  }
  const [first] = pendingToolCalls(loaded.value);
  return ok(first ? asQuestion(first) : undefined);
}

/**
 * One turn: store the user's input (or their answer to a pending ask_user),
 * run the model and tools until it stops, and store every step as it ends.
 * The trip, not the transcript, tells the model where planning stands.
 */
export async function runTurn(
  deps: PlannerDeps,
  userText: string,
  hooks: TurnHooks = {},
): Promise<Result<TurnOutcome, TurnError>> {
  const now = deps.now ?? (() => new Date());
  const mint = () => ({
    id: crypto.randomUUID(),
    createdAt: now().toISOString(),
  });

  let storeError: TurnError | undefined;
  const append = (m: ChatMessage) => {
    const r = deps.chats.append(deps.chatId, m);
    if (!r.ok) storeError ??= { message: r.error.message };
  };

  const loaded = deps.chats.load(deps.chatId);
  if (!loaded.ok && loaded.error.kind !== "not-found") {
    return err({ message: loaded.error.message });
  }
  const history = loaded.ok ? loaded.value : [];

  // The user's words either answer the waiting question or start a new message.
  const pending = pendingToolCalls(history);
  if (pending.length > 0) {
    let answer: unknown = { answer: userText };
    if (pending[0]!.name === "export_trip") {
      const yes = ["y", "yes"].includes(userText.trim().toLowerCase());
      if (!yes) answer = { ok: false, declined: true };
      else {
        const written = exportTrip(deps.trips, deps.tripId);
        answer = written.ok
          ? { ok: true, files: written.value }
          : failStore(written.error);
      }
    }
    append({
      ...mint(),
      role: "tool",
      parts: pending.map((c, i) => ({
        type: "tool-result" as const,
        toolCallId: c.toolCallId,
        output: i === 0 ? answer : { skipped: true },
      })),
    });
  } else {
    append({
      ...mint(),
      role: "user",
      parts: [{ type: "text", text: userText }],
    });
  }
  if (storeError) return err(storeError);

  const stored = deps.chats.load(deps.chatId);
  if (!stored.ok) return err({ message: stored.error.message });

  const instructionsNow = (): Result<string, TurnError> => {
    const trip = deps.trips.load(deps.tripId);
    if (!trip.ok) return err({ message: trip.error.message });
    return ok(
      `${systemPrompt(phase(trip.value))}\n\n${renderDigest(trip.value)}`,
    );
  };
  const first = instructionsNow();
  if (!first.ok) return first;

  const tools = createTools(deps);
  const agent = new ToolLoopAgent({
    model: deps.model,
    instructions: first.value,
    tools,
    // The phase can change inside a turn (brief done, stages added): rebuild the
    // instructions each step, and take away a tool that keeps failing.
    prepareStep: ({ steps }) => {
      const fresh = instructionsNow();
      const failures = new Map<string, number>();
      for (const s of steps) {
        for (const r of s.toolResults) {
          const failed =
            (r.output as { ok?: unknown } | undefined)?.ok === false;
          if (failed)
            failures.set(r.toolName, (failures.get(r.toolName) ?? 0) + 1);
        }
      }
      const banned = [...failures]
        .filter(([, n]) => n >= MAX_TOOL_FAILURES)
        .map(([t]) => t);
      const names = Object.keys(tools) as (keyof typeof tools)[];
      return {
        instructions: fresh.ok
          ? banned.length === 0
            ? fresh.value
            : `${fresh.value}\n\nThese tools failed ${MAX_TOOL_FAILURES} times this turn and are disabled: ${banned.join(", ")}. Ask the user with ask_user instead of retrying.`
          : undefined,
        activeTools: names.filter((n) => !banned.includes(n)),
      };
    },
  });

  let modelError: unknown;
  try {
    const result = await agent.stream({
      messages: toModelMessages(stored.value),
      onStepEnd: (step) => {
        for (const m of stepMessages(step.content as never, mint)) append(m);
      },
    });
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") hooks.onText?.(part.text);
      else if (part.type === "tool-call")
        hooks.onToolCall?.(part.toolName, part.input);
      else if (part.type === "tool-result")
        hooks.onToolResult?.(
          part.toolName,
          (part.output as { ok?: unknown } | undefined)?.ok !== false,
        );
      else if (part.type === "error") modelError = part.error;
    }
    if (modelError) throw modelError;
    await result.steps;
  } catch (caught) {
    const e = modelError ?? caught; // the stream's own error is more telling than "no output"
    return err({ message: e instanceof Error ? e.message : String(e) });
  }
  if (storeError) return err(storeError);

  const after = pendingQuestion(deps.chats, deps.chatId);
  return after.ok ? ok({ pending: after.value }) : after;
}
