import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { TripId } from "@gpx-builder/core/browser";
import { X } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { ChatInput } from "@/components/chat-input";
import { MapView } from "@/components/map-view";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { api } from "../api";
import { tripTotals } from "../trip-stats";
import { useUiStore } from "../ui-store";

const route = getRouteApi("/trips/$tripId");

export function TripView() {
  const tripId = TripId.parse(route.useParams().tripId);
  const qc = useQueryClient();
  const { mapExpanded, setMapExpanded } = useUiStore();
  const { data: trip, isPending } = useQuery({
    queryKey: ["trip", tripId],
    queryFn: () => api.getTrip(tripId),
  });
  const { data: chat = [] } = useQuery({
    queryKey: ["chat", tripId],
    queryFn: () => api.getChat(tripId),
  });
  const { data: gpx } = useQuery({
    queryKey: ["route", tripId],
    queryFn: () => api.getRoute(tripId),
  });
  // Render nothing while loading: "not found" must not flash before the data arrives.
  if (isPending) return null;
  if (!trip) return <p className="p-4">Trip not found.</p>;
  const { days, km, gainM, lossM } = tripTotals(trip);
  const send = async (text: string) => {
    await api.sendMessage(tripId, text);
    await qc.invalidateQueries({ queryKey: ["chat", tripId] });
  };
  return (
    <SidebarProvider>
      <AppSidebar activeTripId={tripId} />
      <SidebarInset className="h-screen">
        <header className="flex items-center gap-2 border-b p-2">
          <SidebarTrigger />
          <h1 className="font-medium">{trip.name}</h1>
        </header>
        <div className="relative min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
              {chat.map((m) => (
                <div
                  key={m.id}
                  className={
                    m.role === "user"
                      ? "bg-secondary ml-auto max-w-[80%] rounded-xl px-4 py-2"
                      : "max-w-[80%]"
                  }
                >
                  {m.parts.map((p, i) =>
                    p.type === "text" ? <p key={i}>{p.text}</p> : null,
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
          {mapExpanded && (
            <div className="bg-background absolute inset-0">
              <MapView route={gpx} className="size-full" />
              <Button
                size="icon"
                variant="secondary"
                className="absolute top-3 right-3"
                onClick={() => setMapExpanded(false)}
                aria-label="Close map"
              >
                <X />
              </Button>
            </div>
          )}
        </div>
        <div className="mx-auto w-full max-w-4xl space-y-3 p-4">
          <Card className="flex-row items-center justify-between gap-4 p-4">
            <dl className="text-muted-foreground grid flex-1 grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              {[
                ["Days", days],
                ["Distance", `${km} km`],
                ["Gain", `+${gainM} m`],
                ["Loss", `-${lossM} m`],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs">{label}</dt>
                  <dd className="text-foreground font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <button
              onClick={() => setMapExpanded(true)}
              className="h-28 w-48 shrink-0 overflow-hidden rounded-md border"
              aria-label="Expand map"
            >
              <MapView route={gpx} className="size-full" />
            </button>
          </Card>
          <ChatInput onSend={send} placeholder="Ask for a change…" />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
