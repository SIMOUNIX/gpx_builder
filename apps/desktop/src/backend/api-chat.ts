import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { runTurn } from "@gpx-builder/agent";
import { TripId, chatIdOf } from "@gpx-builder/core/server";
import { z } from "zod";
import type { ServerDeps } from "./server";

const deny = (status: number, why: string) =>
  Response.json({ error: why }, { status });

const ChatBody = z.object({ tripId: TripId, text: z.string().min(1) });

/** `/api/chat`: runs one agent turn per request and streams it. The LLM side of the server. */
export function createChatHandler(deps: ServerDeps) {
  const running = new Set<string>(); // trips with a chat turn in flight

  /** Streams one agent turn as AI SDK UIMessage SSE. */
  function turn(body: z.infer<typeof ChatBody>): Response {
    const { tripId, text } = body;
    if (!deps.trips.load(tripId).ok) return deny(404, "no such trip");
    // Two turns on one transcript would interleave their messages.
    if (running.has(tripId)) return deny(409, "a turn is already running");
    running.add(tripId);

    const stream = createUIMessageStream({
      onError: () => "the turn failed",
      execute: async ({ writer }) => {
        let textId: string | undefined; // the open text block, if any
        let blocks = 0;
        const closeText = () => {
          if (textId) writer.write({ type: "text-end", id: textId });
          textId = undefined;
        };
        writer.write({ type: "start" });
        try {
          // ponytail: no abort on client disconnect; the turn finishes and persists.
          const r = await runTurn(
            {
              tripId,
              trips: deps.trips,
              geocode: deps.geocode,
              routing: deps.routing,
              chats: deps.chats,
              chatId: chatIdOf(tripId),
              model: deps.model,
            },
            text,
            {
              onText: (delta) => {
                if (!textId) {
                  textId = `text_${blocks++}`;
                  writer.write({ type: "text-start", id: textId });
                }
                writer.write({ type: "text-delta", id: textId, delta });
              },
              onToolCall: (toolName, input, toolCallId) => {
                closeText();
                writer.write({
                  type: "tool-input-available",
                  toolCallId,
                  toolName,
                  input,
                  dynamic: true,
                });
              },
              // Only the verdict is streamed; the full output is in the transcript.
              onToolResult: (_name, ok, toolCallId) =>
                writer.write({
                  type: "tool-output-available",
                  toolCallId,
                  output: { ok },
                  dynamic: true,
                }),
            },
          );
          closeText();
          if (!r.ok)
            writer.write({ type: "error", errorText: r.error.message });
          else if (r.value.pending)
            writer.write({ type: "data-pending", data: r.value.pending });
          writer.write({ type: "finish" });
        } finally {
          running.delete(tripId);
        }
      },
    });
    return createUIMessageStreamResponse({ stream });
  }

  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return deny(405, "POST only");
    // JSON content type forces a CORS preflight from any browser page.
    if (!req.headers.get("content-type")?.startsWith("application/json"))
      return deny(415, "expected application/json");
    const body = ChatBody.safeParse(await req.json().catch(() => null));
    return body.success ? turn(body.data) : deny(400, "bad body");
  };
}
