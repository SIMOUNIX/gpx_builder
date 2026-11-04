// Records real ORS answers as test fixtures. Run from the repo root so Bun loads .env.
// Never prints the key. Usage: bun scripts/record-ors.ts
import { writeFileSync } from "node:fs";

const key = process.env.ORS_API_KEY;
if (!key) throw new Error("ORS_API_KEY is not set");

const out = (name: string) =>
  new URL(`../packages/adapters/src/fixtures/${name}.json`, import.meta.url);
const url =
  "https://api.openrouteservice.org/v2/directions/foot-hiking/geojson";

async function record(name: string, body: unknown, auth: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
      "User-Agent": "gpx-builder",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  writeFileSync(out(name), text.endsWith("\n") ? text : `${text}\n`);
  console.log(name, res.status, `${text.length} bytes`);
}

// Avon station -> Fontainebleau château, with a waypoint a bit off the path network.
const ok = {
  coordinates: [
    [2.7264157, 48.4153298],
    [2.7005, 48.4025],
  ],
  elevation: true,
  instructions: false,
  radiuses: [1000, 1000],
};
await record("ors-route-ok", ok, key);
// A point in the middle of the sea: no routable point within the radius.
await record(
  "ors-route-nopoint",
  {
    ...ok,
    coordinates: [
      [2.7264157, 48.4153298],
      [-30, 40],
    ],
  },
  key,
);
// A wrong key, to see how auth failures look.
await record("ors-route-badkey", ok, "not-a-real-key");
