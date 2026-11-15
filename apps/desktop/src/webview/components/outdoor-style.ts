import type {
  ExpressionSpecification,
  LayerSpecification,
  StyleSpecification,
} from "maplibre-gl";

// Outdoor basemap (AllTrails-like) over OpenFreeMap's OpenMapTiles vector tiles (ADR-0001).
// One layer list, two palettes. Paint colours are hex because MapLibre can't read CSS variables or oklch.
const LIGHT = {
  bg: "#f4efe4",
  wood: "#bcd6a0",
  grass: "#d6e4bc",
  park: "#cfe3bb",
  ice: "#e8f0f2",
  sand: "#eee3bd",
  wetland: "#c9dcc2",
  town: "#ebe4d6",
  water: "#a9cfe6",
  river: "#8fbfdc",
  building: "#e0d8c8",
  casing: "#d6cdbb",
  roadMinor: "#ffffff",
  roadMain: "#ffffff",
  roadMajor: "#fbe9b7",
  motorway: "#f6c97a",
  trail: "#b8936b",
  contour: "#c0a47e",
  boundary: "#9b8f80",
  text: "#3b3a36",
  halo: "#f4efe4",
  // Altitude tint in 3D: fixed 0-3000 m, no red or blue (the route's slope colours).
  relief: [0, "#d7e3c6", 500, "#e6e3c8", 1500, "#e4dccf", 3000, "#f4f2ef"],
};

const DARK: typeof LIGHT = {
  bg: "#1c2420",
  wood: "#2a4430",
  grass: "#263a2b",
  park: "#2c4a34",
  ice: "#3a4648",
  sand: "#3a3828",
  wetland: "#2b3f3a",
  town: "#232b27",
  water: "#1d3a52",
  river: "#2a5575",
  building: "#2a312d",
  casing: "#151a17",
  roadMinor: "#3b4640",
  roadMain: "#4a564f",
  roadMajor: "#5d6b62",
  motorway: "#7a6a45",
  trail: "#e0b27a",
  contour: "#b9a27a",
  boundary: "#7f8a84",
  text: "#dcd9cf",
  halo: "#1c2420",
  relief: [0, "#2b3a30", 1000, "#3a4238", 2000, "#4a4a44", 3000, "#6a6a66"],
};

export const palette = (dark: boolean) => (dark ? DARK : LIGHT);

// Zoom -> [minor, major] metres between contour lines; a zoom without an entry uses the next lower one.
// ponytail: [500, 500] below z11 means one level only, since every line is a major.
export const CONTOUR_THRESHOLDS = {
  0: [500, 500],
  11: [100, 500],
  12: [50, 200],
  13: [20, 100],
  15: [10, 50],
};

const SRC = "openmaptiles";
const zoomWidth = (...stops: number[]) =>
  [
    "interpolate",
    ["exponential", 1.2],
    ["zoom"],
    ...stops,
  ] as ExpressionSpecification;
const cls = (...c: string[]) =>
  ["match", ["get", "class"], c, true, false] as ExpressionSpecification;
const label = [
  "coalesce",
  ["get", "name_en"],
  ["get", "name"],
] as ExpressionSpecification;

export function outdoorStyle(dark: boolean): StyleSpecification {
  const c = palette(dark);
  const fill = (
    id: string,
    layer: string,
    color: string,
    filter?: unknown,
    opacity = 1,
  ) =>
    ({
      id,
      type: "fill",
      source: SRC,
      "source-layer": layer,
      ...(filter ? { filter } : {}),
      paint: { "fill-color": color, "fill-opacity": opacity },
    }) as LayerSpecification;
  // Casing + fill pair for one group of road classes.
  const road = (
    name: string,
    classes: string[],
    color: string,
    ...w: number[]
  ) =>
    [
      [`${name}-casing`, c.casing, 1.6],
      [name, color, 1],
    ].map(
      ([id, col, k]) =>
        ({
          id,
          type: "line",
          source: SRC,
          "source-layer": "transportation",
          filter: [
            "all",
            cls(...classes),
            ["match", ["get", "brunnel"], ["tunnel"], false, true],
          ],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": col,
            "line-width": zoomWidth(
              ...w.map((v, i) => (i % 2 ? v * (k as number) : v)),
            ),
          },
        }) as LayerSpecification,
    );
  const text = (
    id: string,
    layer: string,
    filter: unknown,
    size: unknown,
    extra: Record<string, unknown> = {},
    minzoom = 0,
  ) =>
    ({
      id,
      type: "symbol",
      source: SRC,
      "source-layer": layer,
      minzoom,
      ...(filter ? { filter } : {}),
      layout: {
        "text-field": label,
        "text-font": ["Noto Sans Regular"],
        "text-size": size,
        "text-max-width": 8,
        ...extra,
      },
      paint: {
        "text-color": c.text,
        "text-halo-color": c.halo,
        "text-halo-width": 1.5,
      },
    }) as LayerSpecification;

  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      [SRC]: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": c.bg },
      },
      fill(
        "landuse-town",
        "landuse",
        c.town,
        cls(
          "residential",
          "suburb",
          "neighbourhood",
          "commercial",
          "industrial",
          "retail",
        ),
      ),
      fill(
        "landcover-grass",
        "landcover",
        c.grass,
        cls("grass", "farmland"),
        0.7,
      ),
      fill("landcover-wood", "landcover", c.wood, cls("wood"), 0.7),
      fill("landcover-wetland", "landcover", c.wetland, cls("wetland")),
      fill("landcover-sand", "landcover", c.sand, cls("sand")),
      fill("landcover-ice", "landcover", c.ice, cls("ice")),
      fill("park", "park", c.park, undefined, 0.6),
      fill("water", "water", c.water),
      {
        id: "waterway",
        type: "line",
        source: SRC,
        "source-layer": "waterway",
        layout: { "line-cap": "round" },
        paint: {
          "line-color": c.river,
          "line-width": zoomWidth(11, 0.5, 20, 6),
        },
      },
      { ...fill("building", "building", c.building), minzoom: 14 },
      ...road("road-minor", ["minor", "service"], c.roadMinor, 13, 0.5, 20, 8),
      ...road(
        "road-main",
        ["secondary", "tertiary"],
        c.roadMain,
        8,
        0.4,
        20,
        14,
      ),
      ...road(
        "road-major",
        ["primary", "trunk"],
        c.roadMajor,
        5,
        0,
        7,
        1,
        20,
        18,
      ),
      ...road("road-motorway", ["motorway"], c.motorway, 5, 0, 7, 1, 20, 20),
      {
        id: "trail",
        type: "line",
        source: SRC,
        "source-layer": "transportation",
        minzoom: 11,
        filter: cls("path", "track"),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": c.trail,
          "line-width": zoomWidth(11, 0.6, 14, 1.4, 18, 3.5),
          "line-dasharray": [2, 1.5],
        },
      },
      {
        id: "boundary",
        type: "line",
        source: SRC,
        "source-layer": "boundary",
        filter: ["<=", ["get", "admin_level"], 4],
        paint: {
          "line-color": c.boundary,
          "line-width": 1,
          "line-dasharray": [3, 2],
        },
      },
      text("water-label", "water_name", undefined, 11, {}, 8),
      text(
        "road-label",
        "transportation_name",
        undefined,
        10,
        { "symbol-placement": "line" },
        13,
      ),
      text(
        "peak-label",
        "mountain_peak",
        ["has", "name"], // unnamed peaks would print a bare "m"
        11,
        {
          "text-field": ["concat", label, "\n", ["get", "ele"], " m"],
        },
        10,
      ),
      text(
        "place-other",
        "place",
        ["!", cls("city", "town", "village", "country", "state", "continent")],
        11,
        {},
        10,
      ),
      text("place-village", "place", cls("village"), 12, {}, 9),
      text(
        "place-town",
        "place",
        cls("town"),
        14,
        { "text-font": ["Noto Sans Bold"] },
        7,
      ),
      text(
        "place-city",
        "place",
        cls("city"),
        ["interpolate", ["linear"], ["zoom"], 4, 12, 10, 18],
        { "text-font": ["Noto Sans Bold"] },
      ),
    ],
  };
}

// Contour lines from the terrain DEM (maplibre-contour), added on style load under the first label layer.
export const contourLayers = (
  dark: boolean,
  visible: boolean,
): LayerSpecification[] => {
  const c = palette(dark);
  const layout = { visibility: visible ? "visible" : "none" } as const;
  const line = (id: string, level: number, width: number, opacity: number) =>
    ({
      id,
      type: "line",
      source: "contours",
      "source-layer": "contours",
      filter: ["==", ["get", "level"], level],
      layout,
      paint: {
        "line-color": c.contour,
        "line-width": width,
        "line-opacity": opacity,
      },
    }) as LayerSpecification;
  return [
    line("contours-minor", 0, 0.5, 0.35),
    line("contours-major", 1, 0.9, 0.8),
    // Lakes are flat in the DEM, so the algorithm draws noise rings along their edges: paint the water back over them.
    {
      id: "contours-water-mask",
      type: "fill",
      source: SRC,
      "source-layer": "water",
      layout,
      paint: { "fill-color": c.water },
    },
    {
      id: "contours-label",
      type: "symbol",
      source: "contours",
      "source-layer": "contours",
      minzoom: 12,
      filter: ["==", ["get", "level"], 1],
      layout: {
        ...layout,
        "symbol-placement": "line",
        "text-field": ["concat", ["get", "ele"], " m"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 10,
      },
      paint: {
        "text-color": c.contour,
        "text-halo-color": c.halo,
        "text-halo-width": 1.5,
      },
    },
  ];
};
