import {
  GeoJSONSource,
  Map as MapLibreMap,
  Marker,
  setWorkerUrl,
  addProtocol,
  type RasterDEMSourceSpecification,
} from "maplibre-gl";
import contour from "maplibre-contour";
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
import {
  CONTOUR_THRESHOLDS,
  contourLayers,
  outdoorStyle,
} from "./outdoor-style";
import { useIsDark } from "../hooks/use-theme";
import { PlaceSearch } from "./place-search";
import { BANDS } from "./profile-geo";

export type { MapRoute };

// maplibre-gl 6 ships its worker as a separate file; Vite must be told where it is.
setWorkerUrl(workerUrl);

// AWS Terrain Tiles (Terrarium encoding, no key) feed the hillshade layer.
const TERRAIN_URL =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
// Contour tiles are generated in a worker (maplibre-contour's default, inlined as a Blob URL: no Vite bundling).
const dem = new contour.DemSource({
  url: TERRAIN_URL,
  encoding: "terrarium",
  maxzoom: 15,
});
dem.setupMaplibre({ addProtocol });

// The raster-dem source reads tiles through the contour library's shared protocol, so each DEM tile is downloaded and cached once for both.
const TERRAIN: RasterDEMSourceSpecification = {
  type: "raster-dem",
  encoding: "terrarium",
  tiles: [dem.sharedDemProtocolUrl],
  tileSize: 256,
  maxzoom: 15,
  attribution: "Terrain: AWS Terrain Tiles",
};

const PITCH_3D = 60;
const EXAGGERATION = 1.5;

// Camera before any route has loaded ([lng, lat]).
const PARIS: [number, number] = [2.3522, 48.8566];

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
  const [contours, setContours] = useState(false); // off by default, not saved
  const contoured = useRef(contours); // read on style load
  const dark = useIsDark();
  const darkRef = useRef(dark); // read on style load and at map creation
  const [terrain3d, setTerrain3d] = useState(false); // off by default, not saved
  const is3d = useRef(terrain3d); // read on style load, which wipes terrain
  const [offline, setOffline] = useState(false);
  const [limit, setLimit] = useState<"min" | "max" | null>(null); // zoom bound reached, disables a button

  useEffect(() => {
    const m = new MapLibreMap({
      container: el.current!,
      interactive,
      attributionControl: interactive ? { compact: true } : false,
      style: outdoorStyle(darkRef.current, interactive), // built in code: no style fetch, so a basemap outage only leaves tiles missing
      center: PARIS,
      zoom: 10,
    });
    m.on("style.load", () => {
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
        m.addSource("contours", {
          type: "vector",
          tiles: [
            dem.contourProtocolUrl({
              thresholds: CONTOUR_THRESHOLDS,
              elevationKey: "ele",
              levelKey: "level",
              contourLayer: "contours",
              overzoom: 1, // reuse a coarser DEM tile: fewer fetches, cheaper isolines
            }),
          ],
          maxzoom: 14, // beyond this MapLibre overzooms the vector tiles
        });
        for (const l of contourLayers(darkRef.current, contoured.current))
          m.addLayer(l, labels);
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
      // Hillshade, tint and contours are optional: the map and route keep working without them.
      const source = (e as { sourceId?: string }).sourceId;
      if (source === "terrain" || source === "contours") return;
      // Not outages: a 404 is an empty tile.
      if ((e.error as { status?: number }).status === 404) return;
      if (/^Image ".*" could not be loaded/.test(e.error.message)) return;
      setOffline(true);
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
    if (darkRef.current === dark) return; // the map was created with this theme
    darkRef.current = dark;
    // Re-fires `style.load`, which re-adds terrain, contours and routes.
    map.current?.setStyle(outdoorStyle(dark, interactive));
  }, [dark, interactive]);

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
    contoured.current = contours;
    const m = map.current;
    if (m?.getSource("contours"))
      // exists once the style has loaded
      for (const { id } of m.getStyle().layers)
        if (id.startsWith("contours-"))
          m.setLayoutProperty(id, "visibility", contours ? "visible" : "none");
  }, [contours]);

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
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-none"
                  aria-label="Layers"
                />
              }
            >
              <Layers />
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
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={contours}
                  onChange={(e) => setContours(e.target.checked)}
                />
                Contours
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
