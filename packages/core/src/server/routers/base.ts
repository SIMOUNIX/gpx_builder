import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import { TripId, type StoreError } from "../../browser/index";
import type { ChatStorePort, TripStorePort } from "../ports";

/** What the routers need. Injected by the composition root; the webview only imports the `AppRouter` type. */
export type AppRouterDeps = {
  trips: TripStorePort;
  chats: ChatStorePort;
  now?: () => Date;
};

// isDev: false keeps stack traces (with local paths) out of error responses.
export const t = initTRPC.create({ isDev: false });
export const tripInput = z.object({ tripId: TripId });

/** A store failure as a tRPC error the client can tell apart: missing vs broken. */
export const fail = (e: StoreError): never => {
  throw new TRPCError({
    code:
      e.kind === "not-found"
        ? "NOT_FOUND"
        : e.kind === "unrouted"
          ? "PRECONDITION_FAILED"
          : "INTERNAL_SERVER_ERROR",
    message: e.message,
  });
};
