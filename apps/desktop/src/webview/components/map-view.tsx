import {
  GeoJSONSource,
  Map as MapLibreMap,
  setWorkerUrl,
  type StyleSpecification,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { boundsOf, routesToGeoJSON, type MapRoute } from "./map-geo";

export type { MapRoute };

// maplibre-gl 6 ships its worker as a separate file; Vite must be told where it is.
setWorkerUrl(workerUrl);

const dark = () => matchMedia("(prefers-color-scheme: dark)").matches;

// OpenFreeMap hosted styles (ADR-0001). Chosen at load; there is no dark liberty, so dark uses their `dark` style.
const BASEMAP = {
  light: "https://tiles.openfreemap.org/styles/liberty",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

// Camera before any route has loaded ([lng, lat]).
const PARIS: [number, number] = [2.3522, 48.8566];

// Offline fallback: the route still draws on a plain background.
const blankStyle = (): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": dark() ? "#262626" : "#f1efe9" },
    },
  ],
});

function draw(m: MapLibreMap, routes: MapRoute[]) {
  (m.getSource("routes") as GeoJSONSource).setData(routesToGeoJSON(routes));
  const b = boundsOf(routes);
  if (b) m.fitBounds(b, { padding: 40, duration: 0, maxZoom: 14 });
}

// Routes are drawn as a GeoJSON line layer on top of the basemap, re-added on every style load.
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
  const latest = useRef(routes); // read when a style (re)loads, which wipes the route layer
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const m = new MapLibreMap({
      container: el.current!,
      interactive,
      attributionControl: interactive ? { compact: true } : false,
      style: dark() ? BASEMAP.dark : BASEMAP.light,
      center: PARIS,
      zoom: 10,
    });
    let styled = false;
    m.on("style.load", () => {
      styled = true;
      m.addSource("routes", { type: "geojson", data: routesToGeoJSON([]) });
      m.addLayer({
        id: "routes",
        type: "line",
        source: "routes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 3 },
      });
      if (latest.current) draw(m, latest.current);
    });
    m.on("error", (e) => {
      // Not outages: a 404 is an empty tile, and a style may name a sprite icon it doesn't ship.
      if ((e.error as { status?: number }).status === 404) return;
      if (/^Image ".*" could not be loaded/.test(e.error.message)) return;
      setOffline(true);
      if (!styled) m.setStyle(blankStyle()); // style fetch failed: keep the route on a plain background
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
    latest.current = routes;
    const m = map.current;
    // Before the style has loaded, its `style.load` handler draws `latest`.
    if (m?.getSource("routes") && routes) draw(m, routes);
  }, [routes, interactive]);

  return (
    <div className={cn("bg-muted relative overflow-hidden", className)}>
      {/* size-full, not absolute: maplibre-gl.css (unlayered) forces position:relative on the container and beats Tailwind's layered utilities. */}
      <div ref={el} className="size-full" />
      {routes && routes.every((r) => r.points.length === 0) && (
        <p className="caps text-muted-foreground pointer-events-none absolute inset-0 grid place-items-center">
          No route yet
        </p>
      )}
      {interactive && offline && (
        <p className="caps text-muted-foreground pointer-events-none absolute inset-x-0 top-3 text-center">
          Basemap unavailable (offline)
        </p>
      )}
    </div>
  );
}
