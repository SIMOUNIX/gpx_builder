import { tool } from "ai";
import { z } from "zod";

/**
 * Client-side: it has no `execute`, so the loop stops here and the host shows
 * the question. The user's answer comes back as this call's tool result.
 */
export const askUser = tool({
  description:
    "Ask the user a question and wait for the answer. Use it whenever a constraint, a choice or a confirmation is missing; never guess. Offer `options` when the answer is a short list.",
  inputSchema: z.object({
    question: z.string().min(1),
    options: z.array(z.string().min(1)).min(2).optional(),
  }),
});
