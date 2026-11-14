import type { LngLat, Position3 } from "@gpx-builder/core/browser";
import { useMemo, useState } from "react";
import { Area, AreaChart, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  BAND_COLORS,
  BANDS,
  pointAtDistance,
  profileBands,
  profileSamples,
} from "./profile-geo";

const config = {
  elevationM: { label: "Elevation", color: "var(--primary)" },
} satisfies ChartConfig;

/** Distance vs elevation for the whole trip or one day; hovering reports the matching map point. */
export function ElevationProfile({
  stages,
  onHover,
}: {
  stages: { stageId: string; line: Position3[] }[];
  onHover: (point: LngLat | null) => void;
}) {
  const [stageId, setStageId] = useState<string>(); // undefined = whole trip
  const samples = useMemo(
    () => profileSamples(stages, stageId),
    [stages, stageId],
  );
  const bands = useMemo(() => profileBands(samples), [samples]);
  const pick = (id?: string) => {
    setStageId(id);
    onHover(null);
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {[{ id: undefined, label: "Trip" }, ...dayTabs(stages)].map((t) => (
          <Button
            key={t.label}
            size="sm"
            variant={t.id === stageId ? "secondary" : "ghost"}
            onClick={() => pick(t.id)}
          >
            {t.label}
          </Button>
        ))}
      </div>
      {samples.length < 2 ? (
        <p className="caps text-muted-foreground grid h-32 place-items-center">
          No elevation data
        </p>
      ) : (
        <ChartContainer config={config} className="h-32 w-full">
          <AreaChart
            data={samples}
            onMouseMove={(s) => {
              // Sample index, not `activeLabel`: that one comes from the axis ticks, not our data.
              const km = samples[Number(s.activeTooltipIndex)]?.distanceKm;
              onHover(
                s.isTooltipActive && km !== undefined
                  ? (pointAtDistance(samples, km) ?? null)
                  : null,
              );
            }}
            onMouseLeave={() => onHover(null)}
          >
            <defs>
              {/* Hard stops: one flat colour per band, spanning the first to the last sample. */}
              <linearGradient id="slope" x1="0" x2="1" y1="0" y2="0">
                {bands.flatMap((b) => {
                  const first = samples[0]!.distanceKm;
                  const span = samples.at(-1)!.distanceKm - first;
                  return [b.fromKm, b.toKm].map((km, i) => (
                    <stop
                      key={`${b.fromKm}-${i}`}
                      offset={(km - first) / span}
                      stopColor={BAND_COLORS[b.band]}
                    />
                  ));
                })}
              </linearGradient>
            </defs>
            <XAxis
              type="number"
              dataKey="distanceKm"
              domain={[0, "dataMax"]}
              tickFormatter={(v: number) => `${Math.round(v)} km`}
              tickLine={false}
            />
            <YAxis
              width={44}
              domain={["dataMin - 10", "dataMax + 10"]}
              tickFormatter={(v: number) => `${Math.round(v)}`}
              tickLine={false}
              axisLine={false}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  hideIndicator
                  labelFormatter={(_, p) =>
                    `${Number(p[0]?.payload.distanceKm).toFixed(1)} km`
                  }
                  formatter={(v) => `${Math.round(Number(v))} m`}
                />
              }
            />
            <Area
              dataKey="elevationM"
              type="monotone"
              stroke="var(--color-elevationM)"
              fill="url(#slope)"
              fillOpacity={0.45}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      )}
      <ul className="caps text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
        {BANDS.map((b) => (
          <li key={b.band} className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-sm"
              style={{ background: b.color }}
            />
            {b.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

const dayTabs = (stages: { stageId: string }[]) =>
  stages.map((s, i) => ({ id: s.stageId, label: `Day ${i + 1}` }));
