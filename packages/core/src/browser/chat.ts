import { z } from "zod";

// `input` / `output` are optional on purpose: JSON drops an undefined value,
// so a call without input must still parse after a round trip through a file.
export const ChatPart = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("tool-call"),
    toolCallId: z.string().min(1),
    name: z.string().min(1),
    input: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("tool-result"),
    toolCallId: z.string().min(1),
    output: z.unknown().optional(),
  }),
]);
export type ChatPart = z.infer<typeof ChatPart>;

/**
 * One message of the planner's transcript. A tool call with no matching
 * tool-result yet is pending (this is how an unanswered `ask_user` is stored).
 */
export const ChatMessage = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant", "tool"]),
  createdAt: z.iso.datetime(),
  parts: z.array(ChatPart),
});
export type ChatMessage = z.infer<typeof ChatMessage>;
