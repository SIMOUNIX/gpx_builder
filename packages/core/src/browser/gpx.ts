import type { LngLat, Position3 } from "./geo";

export type GpxMeta = { name: string; desc?: string };
export type GpxStage = { name: string; line: readonly Position3[] };
export type GpxWaypoint = {
  name: string;
  lngLat: LngLat;
  ele?: number;
  sym?: string;
  type?: string;
};

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const coords = (lng: number, lat: number) =>
  `lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"`;

const trk = ({ name, line }: GpxStage) =>
  `<trk><name>${esc(name)}</name><trkseg>${line
    .map(
      ([lng, lat, ele]) =>
        `<trkpt ${coords(lng, lat)}><ele>${ele.toFixed(1)}</ele></trkpt>`,
    )
    .join("")}</trkseg></trk>`;

const wpt = (w: GpxWaypoint) =>
  `<wpt ${coords(...w.lngLat)}>${w.ele === undefined ? "" : `<ele>${w.ele.toFixed(1)}</ele>`}<name>${esc(w.name)}</name>${
    w.sym ? `<sym>${esc(w.sym)}</sym>` : ""
  }${w.type ? `<type>${esc(w.type)}</type>` : ""}</wpt>`;

// Tracks (trk), not routes (rte), so apps don't re-route; no fake <time> values.
function gpx(meta: GpxMeta, body: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="gpx-builder" xmlns="http://www.topografix.com/GPX/1/1">` +
    `<metadata><name>${esc(meta.name)}</name>${meta.desc ? `<desc>${esc(meta.desc)}</desc>` : ""}` +
    `<copyright author="OpenStreetMap contributors"><license>https://opendatacommons.org/licenses/odbl/</license></copyright>` +
    `<link href="report.md"/></metadata>${body}</gpx>\n`
  );
}

export const buildDayGpx = (meta: GpxMeta, stage: GpxStage) =>
  gpx(meta, trk(stage));

/** route.gpx: one track per day. */
export const buildRouteGpx = (meta: GpxMeta, stages: readonly GpxStage[]) =>
  gpx(meta, stages.map(trk).join(""));

/** route-merged.gpx: a single track, for importers that read only the first one. */
export const buildMergedGpx = (meta: GpxMeta, stages: readonly GpxStage[]) =>
  gpx(meta, trk({ name: meta.name, line: stages.flatMap((s) => s.line) }));

export const buildWaypointsGpx = (
  meta: GpxMeta,
  waypoints: readonly GpxWaypoint[],
) => gpx(meta, waypoints.map(wpt).join(""));
