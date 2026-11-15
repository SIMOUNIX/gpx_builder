import { z } from "zod";
import { t, type AppRouterDeps } from "./base";
import { TRPCError } from "@trpc/server";

/** Place search for the map's search box. Read-only: never touches a trip. */
export function createPlaceRouter({ geocode }: AppRouterDeps) {
  return t.router({
    places: t.router({
      search: t.procedure
        .input(z.object({ query: z.string().trim().min(1).max(200) }))
        .query(async ({ input }) => {
          const r = await geocode.search({ query: input.query });
          if (r.ok) return r.value;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: r.error.message,
          });
        }),
    }),
  });
}
