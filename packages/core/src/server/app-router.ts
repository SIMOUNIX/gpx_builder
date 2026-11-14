import { createChatRouter } from "./routers/chat-router";
import { createFileRouter } from "./routers/file-router";
import { createPlaceRouter } from "./routers/place-router";
import { t, type AppRouterDeps } from "./routers/base";

export type { AppRouterDeps };

/** Core, AI and place routers merged: procedure paths stay flat (`trips.list`, `chats.messages`). */
export const createAppRouter = (deps: AppRouterDeps) =>
  t.mergeRouters(
    createFileRouter(deps),
    createChatRouter(deps),
    createPlaceRouter(deps),
  );

export type AppRouter = ReturnType<typeof createAppRouter>;
