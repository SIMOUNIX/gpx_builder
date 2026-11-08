import { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { boundsOf, routesToGeoJSON, type MapRoute } from "./map-geo";

export type { MapRoute };

const dark = () => matchMedia("(prefers-color-scheme: dark)").matches;

// Blank style on purpose: the basemap style comes later. Routes are drawn as a GeoJSON line layer.
// `routes` undefined = still loading.
export function MapView({
  routes,
  className,
  interactive = true,
}: {
  routes: MapRoute[] | undefined;
  className?: string;
  interactive?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);

  useEffect(() => {
    const m = new MapLibreMap({
      container: el.current!,
      interactive,
      attributionControl: false,
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": dark() ? "#262626" : "#f1efe9" },
          },
        ],
      },
    });
    m.on("load", () => {
      m.addSource("routes", { type: "geojson", data: routesToGeoJSON([]) });
      m.addLayer({
        id: "routes",
        type: "line",
        source: "routes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 3 },
      });
    });
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(el.current!);
    map.current = m;
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, [interactive]);

  useEffect(() => {
    const m = map.current;
    if (!m || !routes) return;
    const apply = () => {
      (m.getSource("routes") as GeoJSONSource).setData(routesToGeoJSON(routes));
      const b = boundsOf(routes);
      if (b) m.fitBounds(b, { padding: 40, duration: 0, maxZoom: 14 });
    };
    if (m.getSource("routes")) apply();
    else m.once("load", apply); // registered after the source-adding handler, so it runs after it
  }, [routes, interactive]);

  return (
    <div className={cn("bg-muted relative overflow-hidden", className)}>
      <div ref={el} className="absolute inset-0" />
      {routes && routes.every((r) => r.points.length === 0) && (
        <p className="caps text-muted-foreground pointer-events-none absolute inset-0 grid place-items-center">
          No route yet
        </p>
      )}
    </div>
  );
}
