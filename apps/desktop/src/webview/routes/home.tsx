import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Search, Settings } from "lucide-react";
import { useState } from "react";
import { ChatInput } from "@/components/chat-input";
import { MapView } from "@/components/map-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "../api";

export function Home() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const { data: trips = [] } = useQuery({
    queryKey: ["trips"],
    queryFn: api.listTrips,
  });
  const { data: routes } = useQuery({
    queryKey: ["routes"],
    queryFn: api.getAllRoutes,
  });
  const start = async (text: string) => {
    const trip = await api.createTrip(text);
    await qc.invalidateQueries({ queryKey: ["trips"] });
    await qc.invalidateQueries({ queryKey: ["routes"] });
    await navigate({ to: "/trips/$tripId", params: { tripId: trip.tripId } });
  };
  const recent = trips
    .filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 6);
  return (
    <div className="relative h-screen">
      <MapView
        routes={routes?.map((r) => ({ id: r.tripId, points: r.route }))}
        className="absolute inset-0"
      />
      <div className="absolute inset-x-0 top-0 flex items-center gap-2 p-4">
        <div className="relative max-w-sm flex-1">
          <Search className="text-muted-foreground absolute top-2.5 left-3 size-4" />
          <Input
            className="bg-card/80 rounded-full pl-9 backdrop-blur"
            placeholder="Search trips…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          className="bg-card/80 ml-auto rounded-full backdrop-blur"
          aria-label="Settings"
        >
          <Settings />
        </Button>
      </div>
      <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-3xl space-y-3 p-6">
        <div className="flex flex-wrap gap-2">
          {recent.map((t) => (
            <Link
              key={t.tripId}
              to="/trips/$tripId"
              params={{ tripId: t.tripId }}
              className="caps bg-card/80 hover:bg-accent rounded-full border px-3 py-1.5 backdrop-blur transition-colors"
            >
              {t.name}
            </Link>
          ))}
        </div>
        <ChatInput onSend={start} placeholder="Where do you want to go?" />
      </div>
    </div>
  );
}
