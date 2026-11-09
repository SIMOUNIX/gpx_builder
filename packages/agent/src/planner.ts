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
  onToolCall?: (name: string, input: unknown, toolCallId: string) => void;
  onToolResult?: (name: string, ok: boolean, toolCallId: string) => void;
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

/** Calls the host answers; any other unanswered call is a leftover of a crash. */
const isClientSide = (c: { name: string }) =>
  c.name === "ask_user" || c.name === "export_trip";

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
  const [first] = pendingToolCalls(loaded.value).filter(isClientSide);
  return ok(first ? asQuestion(first) : undefined);
}

/**
 * One turn = everything that happens between "the user sent something" and
 * "the app waits for the user again". Called once per `POST /api/chat`.
 *
 * Nothing is kept in memory between turns: the chat file is the state, so each
 * call rebuilds the agent from disk. In order:
 *
 *   1. Save what the user sent. If the chat is waiting on a client-side tool
 *      (`ask_user`, `export_trip`), their text is that tool's answer; otherwise
 *      it is a new user message.
 *   2. Build a `ToolLoopAgent` (AI SDK): the model, the system prompt and the tools.
 *   3. Run its loop. One loop iteration is called a *step* (see below).
 *   4. Return. If the last assistant message ended on an unanswered client-side
 *      tool call, return it as `pending` so the host can ask the user.
 *
 * The trip (`trip.json`), not the transcript, tells the model where planning
 * stands: the system prompt and a digest of the trip are rebuilt every step.
 *
 * How the tool loop works (this all happens inside `agent.stream` below):
 *
 *   step 1: the SDK sends the transcript + the system prompt + the tool
 *           *definitions* (name, description, input schema) to the model.
 *           The model never runs anything. It can only answer with text and/or
 *           tool calls, each call being `{ toolCallId, toolName, input }`.
 *   Then, for the tool calls in that answer:
 *     - the tool has an `execute` (find_place, route, submit_*): the SDK
 *       validates `input` against the tool's zod schema, runs `execute` in OUR
 *       process, and stores the return value as a tool result under the same
 *       `toolCallId`. Calls made in the same step run in parallel.
 *       The loop then goes to the next step: the model is called again with the
 *       calls and their results appended, and decides what to do next.
 *     - the tool has NO `execute` (ask_user, export_trip): only the human can
 *       answer, so the loop stops here with that call left unanswered. The
 *       host shows the question and the answer arrives in the *next* turn
 *       (step 1 above).
 *     - no tool call at all (just text): the model is done and the loop ends.
 *   The loop also ends after 20 steps, as a safety limit.
 *
 * So "the LLM calls a tool" really means: the LLM asks, our code runs it,
 * and the result goes back to the LLM in the next step.
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

  // Store failures inside callbacks can't be thrown through the SDK, so the
  // first one is remembered here and returned at the end of the turn.
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

  // 1. The user's words either answer the waiting question or start a new message.
  // `pending` = tool calls of the last assistant message that have no result yet.
  const pending = pendingToolCalls(history);
  const firstAsk = pending.find(isClientSide);
  if (pending.length > 0) {
    let answer: unknown = { answer: userText };
    if (firstAsk?.name === "export_trip") {
      const yes = ["y", "yes"].includes(userText.trim().toLowerCase());
      if (!yes) answer = { ok: false, declined: true };
      else {
        const written = exportTrip(deps.trips, deps.tripId);
        answer = written.ok
          ? { ok: true, files: written.value }
          : {
              ...failStore(written.error),
              ...(written.error.stageIds && {
                unrouted: written.error.stageIds,
              }),
            };
      }
    }
    append({
      ...mint(),
      role: "tool",
      parts: pending.map((c) => ({
        type: "tool-result" as const,
        toolCallId: c.toolCallId,
        output: !isClientSide(c)
          ? { ok: false, error: "interrupted before it finished" }
          : c === firstAsk
            ? answer
            : { skipped: true },
      })),
    });
  }
  if (!firstAsk) {
    append({
      ...mint(),
      role: "user",
      parts: [{ type: "text", text: userText }],
    });
  }
  if (storeError) return err(storeError);

  const stored = deps.chats.load(deps.chatId);
  if (!stored.ok) return err({ message: stored.error.message });

  // The model's view of the present: the instructions for the trip's current
  // phase (brief / plan / refine) plus a short digest of `trip.json`. Re-read
  // from disk each time it is called, because tools change the trip mid-turn.
  const instructionsNow = (): Result<string, TurnError> => {
    const trip = deps.trips.load(deps.tripId);
    if (!trip.ok) return err({ message: trip.error.message });
    return ok(
      `${systemPrompt(phase(trip.value))}\n\n${renderDigest(trip.value)}`,
    );
  };
  const first = instructionsNow();
  if (!first.ok) return first;

  // 2. The tools the model may call, bound to this trip (see tools/index.ts).
  // Each is `{ description, inputSchema, execute? }`; the description and schema
  // are what the model sees, `execute` is what we run when it calls the tool.
  const tools = createTools(deps);
  const agent = new ToolLoopAgent({
    model: deps.model,
    instructions: first.value,
    tools,
    // Runs before EVERY step of the loop, i.e. before each model call.
    // The phase can change inside a turn (brief done, stages added): rebuild the
    // instructions each step, and take away a tool that keeps failing.
    // `steps` holds the steps already done in this turn, with their tool results.
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

  // 3. Run the loop. `agent.stream` starts it and returns immediately with a
  // stream; the model calls and tool executions happen while we read it below.
  let modelError: unknown;
  try {
    const result = await agent.stream({
      // The whole stored transcript, converted to the SDK's message format.
      messages: toModelMessages(stored.value),
      // A stalled provider or tool must not hold the turn (and the host's
      // per-trip lock) forever. On expiry the stream ends with an `abort` part.
      timeout: { totalMs: 300_000, chunkMs: 60_000, toolMs: 90_000 },
      // Called when a step is complete (model answered AND its tools ran).
      // We save it now, not at the end of the turn: a crash keeps the finished
      // steps, and a pending `ask_user` is on disk before the host shows it.
      // A step becomes up to two messages: the assistant's (text + tool calls)
      // and a "tool" one (the results).
      onStepEnd: (step) => {
        for (const m of stepMessages(step.content as never, mint)) append(m);
      },
    });
    // Read the events as they happen and forward them to the host (the HTTP
    // stream) through the hooks. This does not drive the loop; it only
    // watches it, and the loop runs even if no hook is set.
    //   text-delta  → a piece of the model's text
    //   tool-call   → the model asked for a tool (before it runs)
    //   tool-result → our `execute` returned (`ok:false` = the tool reported a failure)
    //   tool-error  → our `execute` threw
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") hooks.onText?.(part.text);
      else if (part.type === "tool-call")
        hooks.onToolCall?.(part.toolName, part.input, part.toolCallId);
      else if (part.type === "tool-result")
        hooks.onToolResult?.(
          part.toolName,
          (part.output as { ok?: unknown } | undefined)?.ok !== false,
          part.toolCallId,
        );
      else if (part.type === "tool-error")
        hooks.onToolResult?.(part.toolName, false, part.toolCallId);
      else if (part.type === "error") modelError = part.error;
      else if (part.type === "abort")
        modelError = new Error("the model or a tool timed out");
    }
    if (modelError) throw modelError;
    await result.steps; // waits for the loop to be fully finished
  } catch (caught) {
    const e = modelError ?? caught; // the stream's own error is more telling than "no output"
    return err({ message: e instanceof Error ? e.message : String(e) });
  }
  if (storeError) return err(storeError);

  // 4. Did the loop stop on ask_user / export_trip? Read it back from the chat
  // file (the same code used after an app restart) and tell the host.
  const after = pendingQuestion(deps.chats, deps.chatId);
  return after.ok ? ok({ pending: after.value }) : after;
}
