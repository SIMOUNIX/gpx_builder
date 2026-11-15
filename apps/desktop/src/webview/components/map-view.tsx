import {
  GeoJSONSource,
  Map as MapLibreMap,
  Marker,
  setWorkerUrl,
  type RasterDEMSourceSpecification,
  type StyleSpecification,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LngLat } from "@gpx-builder/core/browser";
import { Layers, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { boundsOf, flyTarget, routesToGeoJSON, type MapRoute } from "./map-geo";
import { PlaceSearch } from "./place-search";
import { BANDS } from "./profile-geo";

export type { MapRoute };

// maplibre-gl 6 ships its worker as a separate file; Vite must be told where it is.
setWorkerUrl(workerUrl);

const dark = () => matchMedia("(prefers-color-scheme: dark)").matches;

// OpenFreeMap hosted styles (ADR-0001). Chosen at load; there is no dark liberty, so dark uses their `dark` style.
const BASEMAP = {
  light: "https://tiles.openfreemap.org/styles/liberty",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

// AWS Terrain Tiles (Terrarium encoding, no key) feed the hillshade layer.
const TERRAIN: RasterDEMSourceSpecification = {
  type: "raster-dem",
  encoding: "terrarium",
  tiles: [
    "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  ],
  tileSize: 256,
  maxzoom: 15,
  attribution: "Terrain: AWS Terrain Tiles",
};

const PITCH_3D = 60;
const EXAGGERATION = 1.5;

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
  marker,
  children,
}: {
  routes: MapRoute[] | undefined;
  className?: string;
  interactive?: boolean;
  marker?: LngLat | null;
  /** Stacked above the place search, top-left (interactive maps only). */
  children?: ReactNode;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const dot = useRef<Marker | null>(null);
  const latest = useRef(routes); // read when a style (re)loads, which wipes the route layer
  const [hillshade, setHillshade] = useState(false); // off by default, not saved
  const shaded = useRef(hillshade); // read on style load, like `latest`
  const [terrain3d, setTerrain3d] = useState(false); // off by default, not saved
  const is3d = useRef(terrain3d); // read on style load, which wipes terrain
  const [offline, setOffline] = useState(false);
  const [limit, setLimit] = useState<"min" | "max" | null>(null); // zoom bound reached, disables a button

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
      if (interactive) {
        // Under the first label layer, so labels stay readable; the route is added after, so it stays on top.
        const labels = m.getStyle().layers.find((l) => l.type === "symbol")?.id;
        m.addSource("terrain", TERRAIN);
        m.addLayer(
          {
            id: "hillshade",
            type: "hillshade",
            source: "terrain",
            layout: { visibility: shaded.current ? "visible" : "none" },
          },
          labels,
        );
        if (is3d.current)
          m.setTerrain({ source: "terrain", exaggeration: EXAGGERATION });
      }
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
      if ((e as { sourceId?: string }).sourceId === "terrain") return; // hillshade is optional: map and route keep working
      // Not outages: a 404 is an empty tile, and a style may name a sprite icon it doesn't ship.
      if ((e.error as { status?: number }).status === 404) return;
      if (/^Image ".*" could not be loaded/.test(e.error.message)) return;
      setOffline(true);
      if (!styled) m.setStyle(blankStyle()); // style fetch failed: keep the route on a plain background
    });
    m.on("zoom", () => {
      const z = m.getZoom();
      setLimit(
        z <= m.getMinZoom() ? "min" : z >= m.getMaxZoom() ? "max" : null,
      );
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

  // Hover dot from the elevation profile: one persistent marker, moved on each hover.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!marker) return void dot.current?.remove();
    if (!dot.current) {
      const el = document.createElement("div");
      el.className =
        "bg-primary pointer-events-none size-3.5 rounded-full border-2 border-white shadow";
      dot.current = new Marker({ element: el });
    }
    dot.current.setLngLat(marker).addTo(m);
  }, [marker]);

  useEffect(() => {
    shaded.current = hillshade;
    const m = map.current;
    if (m?.getLayer("hillshade"))
      m.setLayoutProperty(
        "hillshade",
        "visibility",
        hillshade ? "visible" : "none",
      );
  }, [hillshade]);

  useEffect(() => {
    is3d.current = terrain3d;
    const m = map.current;
    if (!m) return;
    // The terrain source only exists once the style has loaded; `style.load` applies terrain for 3D turned on earlier.
    const ready = !!m.getSource("terrain");
    if (terrain3d) {
      if (ready)
        m.setTerrain({ source: "terrain", exaggeration: EXAGGERATION });
      m.easeTo({ pitch: PITCH_3D });
    } else {
      if (ready) m.setTerrain(null);
      if (m.getPitch() !== 0) m.easeTo({ pitch: 0 }); // bearing is kept
    }
  }, [terrain3d]);

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
      {interactive && (
        <div className="absolute top-2.5 left-2.5 flex w-72 flex-col gap-2">
          {children}
          <PlaceSearch onPick={(c) => map.current?.flyTo(flyTarget(c))} />
        </div>
      )}
      {interactive && (
        // bottom-10 clears the compact attribution control.
        <div className="bg-background absolute right-2.5 bottom-10 flex flex-col divide-y overflow-hidden rounded-md border shadow-xs">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-none"
                aria-label="Layers"
              >
                <Layers />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="left" className="w-auto">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={hillshade}
                  onChange={(e) => setHillshade(e.target.checked)}
                />
                Hillshade
              </label>
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-none"
            aria-label="Zoom in"
            disabled={limit === "max"}
            onClick={() => map.current?.zoomIn()}
          >
            <Plus />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-none"
            aria-label="Zoom out"
            disabled={limit === "min"}
            onClick={() => map.current?.zoomOut()}
          >
            <Minus />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn("rounded-none text-xs", terrain3d && "bg-accent")}
            aria-label="3D terrain"
            aria-pressed={terrain3d}
            onClick={() => setTerrain3d((v) => !v)}
          >
            3D
          </Button>
        </div>
      )}
      {interactive && (
        // Left of the zoom buttons, same bottom edge.
        <ul className="bg-background text-muted-foreground absolute right-12 bottom-10 space-y-1 rounded-md border p-2 text-xs shadow-xs">
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
      )}
      {interactive && offline && (
        <p className="caps text-muted-foreground pointer-events-none absolute inset-x-0 top-3 text-center">
          Basemap unavailable (offline)
        </p>
      )}
    </div>
  );
}
