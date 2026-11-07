import type { LngLat } from "@gpx-builder/core/browser";
import { cn } from "@/lib/utils";

// Placeholder until MapLibre: draws the route normalised into a box.
export function MapView({
  route,
  className,
}: {
  route: LngLat[] | undefined; // undefined while loading
  className?: string;
}) {
  const pts = route ?? [];
  const lngs = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  const [x0, x1] = [Math.min(...lngs), Math.max(...lngs)];
  const [y0, y1] = [Math.min(...lats), Math.max(...lats)];
  const scale = 90 / Math.max(x1 - x0, y1 - y0, 1e-9);
  const points = pts
    .map((p) => `${5 + (p[0] - x0) * scale},${95 - (p[1] - y0) * scale}`)
    .join(" ");
  return (
    <div className={cn("bg-muted relative overflow-hidden", className)}>
      <svg
        viewBox="0 0 100 100"
        className="size-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {pts.length > 0 && (
          <polyline
            points={points}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {route?.length === 0 && (
        <p className="text-muted-foreground absolute inset-0 grid place-items-center text-xs">
          No route yet
        </p>
      )}
    </div>
  );
}
