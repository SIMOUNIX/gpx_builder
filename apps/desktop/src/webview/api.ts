import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { TripId } from "@gpx-builder/core/browser";
import type { AppRouter } from "@gpx-builder/core/server/app-router";
import { getBackend } from "./backend";

// explain: what does not server code in the bundle mean?
// The only place components get server data from (type-only import: no server code in the bundle).
const { url, token } = getBackend();

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000 } }, // no refetch flash on remount/focus
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${url}/api/file`,
        headers: { authorization: `Bearer ${token}` },
      }),
    ],
  }),
  queryClient,
});

// explain: whta is this and why do we need it?
/** §3 refresh model: after a mutation or a finished chat turn, refetch everything the trip touches. */
export const invalidateTrip = (qc: QueryClient, tripId: TripId) =>
  Promise.all([
    qc.invalidateQueries(trpc.trips.list.queryFilter()),
    qc.invalidateQueries(trpc.trips.get.queryFilter({ tripId })),
    qc.invalidateQueries(trpc.trips.route.queryFilter({ tripId })),
    qc.invalidateQueries(trpc.chats.messages.queryFilter({ tripId })),
  ]);
