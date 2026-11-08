import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { phase, TripId } from "@gpx-builder/core/browser";
import { X } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { ChatInput } from "@/components/chat-input";
import { MapView } from "@/components/map-view";
import { Button } from "@/components/ui/button";
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
  const { data: points } = useQuery({
    queryKey: ["route", tripId],
    queryFn: () => api.getRoute(),
  });
  const gpx = points && [{ id: tripId, points }];
  // Render nothing while loading: "not found" must not flash before the data arrives.
  if (isPending) return null;
  if (!trip) return <p className="p-4">Trip not found.</p>;
  const { days, km, gainM, lossM } = tripTotals(trip);
  const send = async (text: string) => {
    await api.sendMessage(tripId, text);
    await qc.invalidateQueries({ queryKey: ["chat", tripId] });
  };
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
            <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6 pb-44">
              {chat.map((m) => (
                <div
                  key={m.id}
                  className={
                    m.role === "user"
                      ? "bg-secondary ml-auto max-w-[80%] rounded-2xl px-4 py-2"
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
          <ChatInput onSend={send} placeholder="Ask for a change…" />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
