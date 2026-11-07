import { streamText, tool, type LanguageModel } from "ai";
import { z } from "zod";
import { err, ok, type Result } from "@gpx-builder/core/server";

/**
 * One scripted tool call. A model that cannot call tools (small local models,
 * often) fails here with a clear message instead of misbehaving mid-chat.
 */
export async function toolCallingSelfTest(
  model: LanguageModel,
): Promise<Result<void, { message: string }>> {
  try {
    let failure: unknown;
    const result = streamText({
      model,
      prompt: "Call the ping tool with the word ok.",
      tools: {
        ping: tool({
          description: "Replies pong.",
          inputSchema: z.object({ word: z.string() }),
          execute: async () => "pong",
        }),
      },
      toolChoice: "required",
      onError: ({ error }) => {
        failure = error;
      },
    });
    await result.consumeStream();
    if (failure) throw failure;
    return (await result.toolCalls).some((c) => c.toolName === "ping")
      ? ok(undefined)
      : err({ message: "the model did not call the test tool" });
  } catch (e) {
    return err({ message: e instanceof Error ? e.message : String(e) });
  }
}
