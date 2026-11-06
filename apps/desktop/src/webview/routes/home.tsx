import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "../api";
import { ChatInput } from "@/components/chat-input";
import { tripTotals } from "../trip-stats";

export function Home() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: trips = [] } = useQuery({
    queryKey: ["trips"],
    queryFn: api.listTrips,
  });
  const start = async (text: string) => {
    const trip = await api.createTrip(text);
    await qc.invalidateQueries({ queryKey: ["trips"] });
    await navigate({ to: "/trips/$tripId", params: { tripId: trip.tripId } });
  };
  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center gap-10 p-8">
      <div className="space-y-4">
        <h1 className="text-center text-2xl font-semibold">
          Where do you want to go?
        </h1>
        <ChatInput onSend={start} placeholder="Describe your next trip…" />
      </div>
      <section className="space-y-3">
        <h2 className="text-muted-foreground text-sm font-medium">
          Recent trips
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {trips.slice(0, 6).map((t) => {
            const { days, km, gainM } = tripTotals(t);
            return (
              <Link
                key={t.tripId}
                to="/trips/$tripId"
                params={{ tripId: t.tripId }}
              >
                <Card className="hover:bg-accent h-full transition-colors">
                  <CardHeader>
                    <CardTitle className="truncate text-base">
                      {t.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-muted-foreground text-sm">
                    {days} d · {km} km · +{gainM} m
                    <div className="text-xs">{t.updatedAt.slice(0, 10)}</div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
