import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { phase, TripId } from "@gpx-builder/core/browser";
import { X } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { ChatMessages } from "@/components/chat-messages";
import { ChatInput } from "@/components/chat-input";
import { stageRoutes } from "@/components/map-geo";
import { MapView } from "@/components/map-view";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { trpc } from "../api";
import { useTripChat } from "../hooks/use-trip-chat";
import { tripTotals } from "../trip-stats";
import { useUiStore } from "../ui-store";

const route = getRouteApi("/trips/$tripId");

export function TripView() {
  const tripId = TripId.parse(route.useParams().tripId);
  const { first } = route.useSearch();
  const navigate = useNavigate();
  const { mapExpanded, setMapExpanded } = useUiStore();
  const { data: trip, isPending } = useQuery(
    trpc.trips.get.queryOptions({ tripId }),
  );
  const { data: stages } = useQuery(trpc.trips.route.queryOptions({ tripId }));
  const { lines, pending, busy, error, send } = useTripChat(tripId);
  // Memoised: MapView re-fits the camera whenever `routes` changes identity, and chat streaming re-renders constantly.
  const gpx = useMemo(() => stages && stageRoutes(stages), [stages]);

  // Home passes the first message in `?first=`: send it once, then clear the param.
  const sentFirst = useRef(false);
  useEffect(() => {
    if (!first || sentFirst.current) return;
    sentFirst.current = true;
    void send(first);
    void navigate({
      to: "/trips/$tripId",
      params: { tripId },
      search: {},
      replace: true,
    });
  }, [first, send, navigate, tripId]);

  // Render nothing while loading: "not found" must not flash before the data arrives.
  if (isPending) return null;
  if (!trip) return <p className="p-4">Trip not found.</p>;
  const { days, km, gainM, lossM } = tripTotals(trip);
  const phases = ["brief", "plan", "refine"] as const;
  return (
    <SidebarProvider>
      <AppSidebar activeTripId={tripId} />
      <SidebarInset className="h-screen">
        <header className="flex items-center gap-3 border-b px-4 py-3">
          <SidebarTrigger />
          <h1 className="font-serif text-2xl tracking-tight">{trip.name}</h1>
          <div className="ml-auto flex gap-1.5">
            {phases.map((p) => (
              <span
                key={p}
                className={`caps rounded-full border px-2.5 py-1 ${
                  p === phase(trip)
                    ? "bg-primary text-primary-foreground border-transparent"
                    : "text-muted-foreground"
                }`}
              >
                {p}
              </span>
            ))}
          </div>
        </header>
        <div className="relative min-h-0 flex-1">
          <ScrollArea className="h-full">
            <ChatMessages
              lines={lines}
              pending={pending}
              error={error}
              onAnswer={send}
            />
          </ScrollArea>
          {mapExpanded ? (
            <div className="bg-background absolute inset-0">
              <MapView routes={gpx} className="size-full" />
              <Button
                size="icon"
                variant="secondary"
                className="absolute top-3 right-3 rounded-full"
                onClick={() => setMapExpanded(false)}
                aria-label="Close map"
              >
                <X />
              </Button>
            </div>
          ) : (
            <div className="absolute right-6 bottom-4 w-60 space-y-2">
              <button
                onClick={() => setMapExpanded(true)}
                className="block h-36 w-full overflow-hidden rounded-xl border"
                aria-label="Expand map"
              >
                <MapView
                  routes={gpx}
                  interactive={false}
                  className="size-full"
                />
              </button>
              <dl className="bg-card grid grid-cols-4 gap-1 rounded-xl border p-2 text-center">
                {[
                  ["Days", days],
                  ["Km", km],
                  ["Gain", `+${gainM}`],
                  ["Loss", `-${lossM}`],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="caps text-muted-foreground">{label}</dt>
                    <dd className="text-sm font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
        <div className="mx-auto w-full max-w-4xl p-4">
          <ChatInput
            onSend={send}
            disabled={busy}
            placeholder="Ask for a change…"
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
