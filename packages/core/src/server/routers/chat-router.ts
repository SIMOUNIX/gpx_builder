import { chatIdOf } from "../../browser/index";
import { fail, t, tripInput, type AppRouterDeps } from "./base";

/**
 * The chat's reads. The agent turn itself is not here: it streams over
 * `/api/chat` (apps/desktop/src/backend/api-chat.ts), which a tRPC procedure can't do for `useChat`.
 */
export function createChatRouter({ chats }: AppRouterDeps) {
  return t.router({
    chats: t.router({
      /** The transcript, empty before the first message. */
      messages: t.procedure.input(tripInput).query(({ input }) => {
        const r = chats.load(chatIdOf(input.tripId));
        if (r.ok) return r.value;
        return r.error.kind === "not-found" ? [] : fail(r.error);
      }),
    }),
  });
}
