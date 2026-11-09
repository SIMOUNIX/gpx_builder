import { createChatRouter } from "./routers/chat-router";
import { createFileRouter } from "./routers/file-router";
import { t, type AppRouterDeps } from "./routers/base";

export type { AppRouterDeps };

/** Core and AI routers merged: procedure paths stay flat (`trips.list`, `chats.messages`). */
export const createAppRouter = (deps: AppRouterDeps) =>
  t.mergeRouters(createFileRouter(deps), createChatRouter(deps));

export type AppRouter = ReturnType<typeof createAppRouter>;
