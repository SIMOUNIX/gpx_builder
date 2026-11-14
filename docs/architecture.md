# Architecture

Status: **v1.1 — 2026-10-28.** This is the canonical design spec. It describes the system we are building. When the code and this document disagree, one of them is wrong and gets fixed in the same commit. `<App>` is a placeholder until the project has a name; the working name in code is `gpx-builder` (so `<APP>_DATA_DIR` is `GPX_BUILDER_DATA_DIR`).

v1 folds in a four-part review of v0 (agent design, desktop runtime, geo data, scope). The decision log (§20) records what changed and why.

v1.1 changes the build order: **agent first** (driven from a terminal CLI, no UI), then the **backend**, then the **frontend** (§18). It also fixes the four-package layout from the start (§4), switches ids from ULID to UUID (§5), and adds the travel-from-home constraint (§9.1).

**What this is.** A local-first desktop app (macOS, Windows, Linux) where an AI planner agent designs outdoor trips and produces GPX routes. The user chats with the planner. The planner:

1. gathers constraints;
2. resolves places and points of interest to ids;
3. asks a routing engine for geometry;
4. validates the result with deterministic rules;
5. writes a self-contained trip folder to disk.

Inspired by the architecture of [LearnHarness](https://github.com/amosblomqvist/learnharness) (AGPL-3.0): hexagonal core, one writer per store, ack-and-steer sub-agents, derived state.

---

## 0. Non-goals

- No backend we operate: no accounts, sync, sharing service or telemetry.
- No turn-by-turn navigation on the trail. The output is GPX for apps that do that (OsmAnd, Komoot, Garmin).
- No routing engine of our own. We call one; we don't build one.
- No guarantee about legality or safety. Rules we can't verify are reported as "unverified — check locally", never asserted.
- No mobile app.

---

## 1. Principles (in priority order)

1. **Code mechanizes, LLMs judge.** The model decides intent: where to go, which places, which constraints matter. It **never produces or sees coordinates or geometry**; it works with ids. Routes come from a routing engine. Validation, GPX writing, distances and elevation are deterministic code.
2. **Local-first.** All data is plain files on the user's disk.
3. **Bring your own keys, or run fully local.** The user supplies their own LLM and routing keys, or points the app at a local model (Ollama, LM Studio). Until the backend phase, keys are read from a gitignored `.env` file (§15).
4. **One writer per store.** Every persistent store has exactly one owning module. Nothing else writes to it.
5. **The trip folder is self-sufficient.** Everything needed to rebuild a trip's outputs lives in the trip folder. Caches only make things faster.
6. **Imports point inward.** A pure core at the center. Every external effect (filesystem, network, LLM, OS) sits behind an adapter at the edge. The composition root is the only place adapters are wired in. Enforced by lint.
7. **Good citizen of free geo services.** Cache aggressively, queue requests, back off on rate limits, attribute data sources.
8. **Build the smallest thing that proves the next step.** Milestones in §18 decide what exists when. A section marked _(later)_ is designed but not built yet.

---

## 2. Stack

| Concern                       | Choice                                                                                                                           | Why                                                                                                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime                       | **Bun**                                                                                                                          | One runtime for main process, tests, scripts. Runs TS directly.                                                                                                                      |
| Desktop shell                 | **Electrobun** _(backend phase)_                                                                                                 | The main process _is_ Bun, so agent, storage and jobs run in-process with no sidecar. Electrobun-specific code stays inside `apps/desktop/src/backend`, so the shell can be swapped. |
| Renderer                      | System webview; **CEF bundled on Linux** (adds ~100 MB to that build)                                                            | WebKitGTK's WebGL is the weak point for MapLibre and 3D terrain.                                                                                                                     |
| UI                            | **React + Vite**, **TanStack Router** (SPA) + **TanStack Query**                                                                 | Type-safe routes; Query owns server-state caching and invalidation.                                                                                                                  |
| Client state                  | **Zustand** (UI-only state: selected stage, panel layout, chat draft)                                                            | Small store, no boilerplate. Server data stays in TanStack Query; nothing is duplicated between them.                                                                                |
| Components                    | **shadcn/ui** (Radix primitives + Tailwind CSS)                                                                                  | Components are copied into the repo and owned by us.                                                                                                                                 |
| API                           | **tRPC** (`@trpc/tanstack-react-query`) over the loopback server                                                                 | End-to-end types between webview and main process.                                                                                                                                   |
| Agent                         | **Vercel AI SDK v7** (`ToolLoopAgent`), providers **Anthropic** and **Mistral**                                                  | Thin, explicit tool loop; we own the orchestration. `useChat` for streaming. v7 is pinned (current stable when M1 started); use that version's docs only.                            |
| Schemas                       | **zod**                                                                                                                          | One schema shared by producer and consumer at every boundary.                                                                                                                        |
| Map                           | **MapLibre GL JS**, **OpenFreeMap** hosted tiles, **Terrarium** terrain tiles                                                    | Basemap is online only (ADR-0001).                                                                                                                                                   |
| Geo                           | **turf.js**, **flatbush** (in-memory spatial index), **suncalc**, `@tmcw/togeojson` (GPX import), own GPX serializer             | Small, deterministic, testable.                                                                                                                                                      |
| Routing                       | **OpenRouteService** `foot-hiking` (default), GraphHopper (optional), behind `RoutingPort`; **BRouter** _(later, offline pack)_  | ORS's free tier fits hiking; GraphHopper's free tier is too narrow to be the default (§12.1).                                                                                        |
| Geocoding                     | **Photon** (OSM, global, no key) behind `GeocodePort`; **Nominatim** and **IGN Géoplateforme** _(later, optional adapters)_      | Place names must become ids before anything else works. The app is for everyone, not one country.                                                                                    |
| Elevation                     | Terrarium for display and 3D; **IGN RGE ALTI** for stats in France _(optional)_, behind `ElevationPort`                          | Terrarium is too coarse for raw D+ (§12.4).                                                                                                                                          |
| POIs                          | **Overpass API**, tile-cached                                                                                                    | Water, shelters, campsites, stations, shops.                                                                                                                                         |
| Weather                       | **Open-Meteo**                                                                                                                   | Free, no key.                                                                                                                                                                        |
| Storage                       | **Plain files** (JSON, JSONL, GeoJSON, GPX)                                                                                      | Inspectable, diffable, portable. No database.                                                                                                                                        |
| Secrets                       | `.env` loaded by Bun for now (M1); `Bun.secrets` (OS keychain) with an explicit fallback in the backend phase (§15)              | Keys never committed; never in trip or data files.                                                                                                                                   |
| Lint / format / types / tests | ESLint 9 (`import/no-restricted-paths`), Prettier, `tsc --noEmit` (TypeScript 6, strict, `noUncheckedIndexedAccess`), `bun test` | Gates on every change. ESLint and TypeScript are pinned to what `eslint-plugin-import` and typescript-eslint support; bump when they catch up.                                       |

---

## 3. Process model

M2 status: the headless backend is built (composition root, hardened loopback server, tRPC router, `/api/chat`), tested without a shell. Electrobun itself, the single-instance lock and the keychain are still to do. `apps/cli` wires the same packages.

```
┌──────────────────────── Electrobun app ────────────────────────┐
│                                                                │
│  Bun main process (apps/desktop/src/backend)                       │
│   ├─ single-instance lock                                      │
│   ├─ composition root: wires stores, ports, agent              │
│   ├─ Bun.serve on 127.0.0.1:<random port> (hardened, §3.1)     │
│   │    ├─ /api/file/*     CRUD: trips, stages, edits, export    │
│   │    └─ /api/chat      agent stream (AI SDK UIMessage SSE)   │
│   └─ file stores (the only code that touches disk)             │
│                                                                │
│  Webview (apps/desktop/src/webview)                            │
│   └─ React SPA: chat panel · MapLibre map · elevation profile  │
│        talks ONLY to the loopback server                       │
└────────────────────────────────────────────────────────────────┘
          │ HTTPS (user's keys)
          ▼
   LLM provider / local model · ORS · geocoder · Overpass · Open-Meteo
```

- **One process, one event loop.** No worker threads in v0. Writes are serialized by the event loop (§7.4).
- **Refresh model (v0):** after a mutation or a chat turn settles, the client invalidates the affected TanStack Query keys and refetches. A push channel (tRPC subscription, notify-only events) comes _(later)_, once background jobs exist (§9.5).

### 3.1 Transport security

The loopback server is reachable by any local process and any browser tab, so it is hardened. All of these are required:

- Bind to `127.0.0.1` only, on a random port.
- **Host check:** reject any request whose `Host` header is not exactly `127.0.0.1:<port>`. This blocks DNS rebinding.
- **Origin check:** allow only the webview's own origin. Reject a missing or `null` Origin on state-changing requests. No wildcard CORS.
- **Token:** a random per-launch token, handed to the webview through the Electrobun preload (never in the URL). The client sends it in an `Authorization` header on every request.
- **Streaming:** use `fetch`-based SSE (the AI SDK transport already does this), because `EventSource` can't set headers.
- **As built** (`apps/desktop/src/backend/server.ts`): `startServer({ token, allowedOrigins, deps, port? })` binds `127.0.0.1` (port 0 = random) and knows nothing of Electrobun, so tests start it directly. Check order: Host, then Origin, then token. A present Origin must be in the allowlist (so `null` is refused on every method); a missing Origin is refused on state-changing methods only. Preflight (`OPTIONS`) is answered after the Host and Origin checks without a token, since browsers never send one; every other request, `/ping` included, needs `Authorization: Bearer <token>` (constant-time compare). CORS headers echo the one allowed origin, never `*`. Request bodies are capped at 64 KB. `/api/chat` requires `application/json`. One turn per trip at a time (409 otherwise).
- **Verify at M2** on all three webviews that the app's origin can call `http://127.0.0.1` without being blocked as mixed content.

Alternative recorded in §20: Electrobun's typed RPC (already encrypted), at the cost of hand-building streaming and a custom tRPC link.

---

## 4. Packages and the import law

Four packages and two apps, split from the start (M0) so the import law is enforced while the agent is built:

```
packages/
  core/      PURE: ids, contracts, ports, GPX serializer, geo math, D+, phase, digest
             (validator comes with M4)
  agent/     planner, sub-agents, tools, prompts, model slots
  adapters/  routing, geocode (elevation, overpass, weather later)
  store/     file adapters, atomic writes, JSONL helpers, settings
apps/
  cli/       terminal chat harness; composition root until the desktop app exists (M1)
  desktop/   (M2-M3)
    src/backend/      composition root, loopback server, keychain
    src/webview/  React SPA
      components/ui/  shadcn/ui components (owned here)
```

Packages are named `@gpx-builder/<name>`. Bun links workspace dependencies per package from each `package.json`, so an undeclared cross-package import fails to resolve in `tsc` and at runtime; a declared one is caught by the lint zones below.

`core` has **two entry points**:

- `core/browser`: browser-safe code only (contracts, validator, geo math, GPX serializer). The webview may import only this.
- `core/server`: adds ports and anything Node/Bun-specific.

| Zone                                        | May import                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/core/**`                          | nothing from this repo                                                           |
| `packages/agent/**`                         | `core` only (everything else injected through factories)                         |
| `packages/adapters/**`, `packages/store/**` | `core` only                                                                      |
| `apps/desktop/src/webview/**`               | `core/browser` + the tRPC router **type** exported from `core/server/app-router` |
| `apps/desktop/src/backend/**`               | everything; this is the composition root                                         |
| `apps/cli/**`                               | everything; composition root of the terminal harness                             |

Enforced by ESLint `import/no-restricted-paths`. Lint failure fails the build. The tRPC `AppRouter` type lives in `core` so the webview never imports the composition root.

---

## 5. Glossary of ids

Every id is a string with a prefix, so its kind is visible in logs and in the model's context.

| Id            | Format                                               | Source                                                          | Lifetime                                                     |
| ------------- | ---------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------ |
| `tripId`      | `trip_<uuid>`                                        | minted at trip creation, stored in `trip.json`                  | forever; independent of the folder name                      |
| `chatId`      | `chat_<uuid>`                                        | minted at chat creation                                         | forever                                                      |
| `stageId`     | `stage_<n>_<short>`                                  | minted by `submit_itinerary` / `amend_stage`                    | while the stage exists in the trip                           |
| `placeId`     | `geo:<provider>:<providerId>`                        | geocoder result                                                 | stable across turns; resolved through the trip's id registry |
| `poiId`       | `osm:node/123`, `osm:way/456`                        | OSM element id                                                  | stable across cache refreshes                                |
| `waypointId`  | `wp_<short>`                                         | minted when a place, POI, user click or snap becomes a waypoint | per trip                                                     |
| `routeId`     | `route_<sha256 of the stored geometry file, 16 hex>` | content hash of `routes/<routeId>.geojson`                      | forever; the same geometry gives the same id                 |
| `violationId` | `v_<ruleId>_<stageId>_<short>`                       | validator, deterministic                                        | until the violation clears                                   |

Formats: `tripId` and `chatId` use a UUID v4 (`crypto.randomUUID()`, checked with `z.uuid()`); `stageId` is `stage_<n>_<8 hex>`; `waypointId` is `wp_<8 hex>`; `routeId` is `route_<16 hex>`, where `store` computes the hash of the written geometry file and `core` only validates the format.

**Id registry.** Each trip keeps the ids it has used, and what they resolve to, in `trip.json` (`registry: { places, pois, waypoints }`). Any id the model got in turn 2 still resolves in turn 9, after a restart, or after the cache is cleared.

---

## 6. Runtime systems and ownership

| System                      | Owns (sole writer)                  | Role                                                                                                     |
| --------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Planner** (turn pipeline) | `<data>/chats/*.jsonl`              | Runs one chat turn: build the agent from the record + trip digest, stream, persist.                      |
| **Trips** (trip service)    | each trip folder                    | Applies commands (from tools or map edits), writes `trip.json` and `routes/`, regenerates derived files. |
| **Cache**                   | `<cache>/**`                        | Geocoding, POI tiles, routing responses, elevation samples. Always disposable.                           |
| **Settings** _(later)_      | `<data>/settings.json` (+ keychain) | Models, providers, trips folder path.                                                                    |
| **Workbench** _(later)_     | `<data>/jobs/*.json`                | Background sub-agents with ack-and-steer (§9.5).                                                         |

Agents never write files. They call tools; tools call the trip service or adapters through ports.

---

## 7. Storage

### 7.1 Locations

Everything the app owns lives under one hidden folder in the user's home, on every OS:

```
~/.gpx_builder/
  data/     chats, quarantine, later settings and logs
  cache/    disposable
  trips/    one folder per trip (§7.2)
```

Each directory can be overridden on its own with `GPX_BUILDER_DATA_DIR`, `GPX_BUILDER_CACHE_DIR` and `GPX_BUILDER_TRIPS_DIR` (`<APP>_DATA_DIR` etc. elsewhere in this document). These are also the test seams. A settings panel will replace the overrides later.

```
<data>/
  settings.json            (later) models, providers, trips folder path, home place (no secrets); has "v"
  chats/<chatId>.jsonl     one ChatMessage per line, appended; the planner's transcript
  quarantine/              damaged chat files and cut-off tails, never deleted
  logs/                    rotated logs; never keys, never full prompts
  trips-index.json         DERIVED: tripId → folder path, rebuilt by rescan

<cache>/
  <sha256 of key>.json     one entry per file: { expiresAt, value }; expired or damaged = miss
  pois/<z12-x-y>.geojson   Overpass results per tile + fetchedAt
  elevation/…              decoded terrain samples
```

### 7.2 Trip folder (user-facing)

Default `~/.gpx_builder/trips/`, overridable (a settings panel comes later). Being hidden, it is not browsed in Finder by default; the app shows each trip's path. One folder per trip:

```
trips/<yyyy-mm>-<slug>-<8 hex of tripId>/
  trip.json             SOURCE OF TRUTH: v, tripId, brief, constraints, stages,
                        waypoints, registry, routeId + stats + snapDistancesM per stage, chatId, timestamps
  routes/<routeId>.geojson   EVIDENCE: geometry + per-point elevation for each routed stage
  route.gpx             DERIVED: one track per day
  route-merged.gpx      DERIVED: one single track (for importers that read only the first track)
  day-<n>.gpx           DERIVED: one per stage
  waypoints.gpx         DERIVED (later): water, camps, stations as <wpt>
  report.md             DERIVED (later): plan summary, violations, unverified warnings, attribution, licence notes
```

- **Folder name:** the 8-hex suffix is the first 8 hex of the `tripId` UUID. It is only a lookup hint (§7.3); renaming the folder is safe. The slug is lowercase ASCII (accents stripped, other characters become dashes, 40 characters max, `trip` if nothing is left).
- **Route file:** a GeoJSON `Feature` with a `LineString`, written canonically (fixed key order, no whitespace, lng/lat rounded to 6 decimals, elevation to 1). `routeId` is `route_` plus the first 16 hex of the sha256 of those exact bytes, so the same geometry always gets the same id. A file that exists under an id with different bytes is reported as `corrupt`, never overwritten.
- **Derived files (built):** `buildDerivedFiles` in `core` is pure and returns `{ file name: content }` for `route.gpx`, `route-merged.gpx` and `day-<n>.gpx`; the store's `writeDerived` writes them atomically and returns the paths. Unrouted stages are skipped, and a day keeps its number (stage order) even if an earlier day is unrouted. Track names are "Day n". `writeDerived` accepts plain file names only and refuses `trip.json` and `trip.prev.json`. It does not delete stale files, which is fine until stages can be removed (`amend_stage`, M4). `exportTrip(store, tripId)` in `core/server` is the whole flow (load the trip, read each routed stage's geometry once, build, write). It takes only the store port, returns the paths written, returns an empty list when no stage is routed, and stops at the first store error. The `export_trip` tool just calls it, and it runs only on an explicit export, never as part of `save`.
- **Rebuilding:** every derived file can be regenerated from `trip.json` + `routes/` alone, with no cache and no network.
- **Undo and history** _(later)_: add `events.jsonl` (typed events with a `v` field, zod schema per event). Until then, before every write the trip service keeps the previous `trip.json` as `trip.prev.json` (one level of undo): the old bytes are written to `trip.prev.json` first, then the new `trip.json`, so a crash between the two leaves both equal.
- **External tools:** the folder must open correctly in any GPX tool (OsmAnd, Komoot, the author's separate Tauri GPX editor) without the app.

### 7.3 Identity and external edits

Users will rename, move, hand-edit and delete trip folders.

- **Identity is `tripId` inside `trip.json`**, never the folder name.
- **Lookup (built):** the folder-name suffix is tried first and verified against the `tripId` inside `trip.json`; if it misses, every folder is scanned, so a renamed folder is still found. Two folders holding one `tripId` is a `duplicate` error, never an arbitrary pick. An unreadable sibling does not break the lookup.
- **Rescan** _(later)_: scan the trips folder on startup and on window focus, rebuilding `trips-index.json`. Not built yet; lookup scans on demand.
- A chat whose trip can't be found shows the trip as **orphaned** in the UI, with "locate folder" and "detach" actions.
- If `trip.json` fails schema validation (hand edit gone wrong), the trip opens read-only with the zod error shown. The app never overwrites a file it couldn't parse. Built: `load` returns `corrupt`, `invalid` or `newer-version`, and `save` refuses to write over such a file. The read-only UI mode comes with the UI.

### 7.4 File rules

- **Atomic replace:**
  1. Write a hidden `.<name>.tmp-<pid>-<random>` **in the same directory** as the target. This avoids cross-device renames (EXDEV). The temp file is removed on failure, and stale ones a crash left behind are swept when a trip is opened.
  2. fsync the file.
  3. Rename over the target.
  4. fsync the directory (POSIX).
- **Windows** _(later)_: retry the rename with backoff (e.g. 5 tries, 50→800 ms) on EPERM/EBUSY, which antivirus, the indexer or an open GPX viewer cause. After the last retry, surface the error; never fall back to a non-atomic write.
- **Synced folders:** if the trips folder is inside iCloud Drive, OneDrive or Dropbox, warn once in settings. Detect conflict copies (`trip (1).json`, `trip 2.json`) on rescan and show them instead of ignoring them.
- **JSONL (chats):** one line is `{ "v": 1, "message": <ChatMessage> }`, written as the whole line plus `\n` in a single call and fsynced.
  - Because of that, a crash can only leave an **unterminated last line**. If it still parses and validates, it is kept and the newline is restored. If it is torn, it is cut off and a copy is saved as `quarantine/<chatId>.<timestamp>.tail` first.
  - A damaged line that **ends in a newline** (bad JSON, or failing the schema) is not a crash artifact. The whole file is moved to `quarantine/<chatId>.<timestamp>.jsonl`, unchanged, and the error names the line.
  - A quarantined chat is reported as `corrupt` on load and **refuses appends**, so a transcript is never silently replaced by an empty one. The caller starts a new chat. To recover, fix the quarantined file by hand and move it back.
  - Append repairs a torn tail before writing, so lines never glue together. Loading a chat that doesn't exist is `not-found`. Lines are never silently dropped.
  - A chat's last-activity time is the `createdAt` of its last message; no separate `updatedAt` is stored.
- **Schema versions:** every JSON file and every JSONL line carries `"v"`. Upgrades are functions in `core` (`v1 → v2`). On open, data is migrated in memory and written back at the next normal write. A file with a `v` **newer** than the app knows opens read-only.
- **Synchronous writes, single process:** the single-instance lock (§16) guarantees one writer. The store ports are synchronous for that reason; the network ports are async.

---

## 8. The geometry rule, end to end

The model never sees coordinates. These tools let it work with places anyway:

1. `find_place("Fontainebleau-Avon station")` → `[{placeId, label, kind, distanceFromHintKm}]`. The adapter calls the geocoder; coordinates go into the trip's id registry, not to the model.
2. `find_pois(near: placeId | stageId | waypointId, radiusKm, kinds)` → POIs with `poiId`, name, kind, tier and distance. The bounding box is computed by code from the anchor.
3. `points_along(routeId, everyKm | atKm, kinds)` → POIs near the line, with distance along the route.
4. `route(stageId)` → routes the stage's ordered waypoints and returns a summary plus `routeId`. Geometry is written to `routes/` by the trip service.

Waypoints are typed:

```ts
type Waypoint = {
  id: WaypointId;
  kind: "place" | "poi" | "user" | "snap";
  ref?: PlaceId | PoiId; // for place / poi
  lngLat: [number, number]; // only ever in trip.json, never in model context
  label: string;
};
```

A point the user drops on the map becomes a `user` waypoint with its own id (§10), so the model can talk about it.

---

## 9. Agent design

### 9.1 The planner

One conversational agent per chat. Each turn it is rebuilt from `chats/<chatId>.jsonl` plus a **trip digest**.

**Phase** is derived from **trip state**, not by parsing the transcript:

| Trip state                   | Phase      | Planner focus                                                                                                                               |
| ---------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| no trip, or brief incomplete | **Brief**  | gather constraints with `ask_user`: dates and days, km and D+ per day, start and end access (train), overnight type, water, season, fitness |
| brief complete, no stages    | **Plan**   | find places and POIs, then `submit_itinerary`                                                                                               |
| stages exist                 | **Refine** | route, validate, react to violations and map edits with `amend_stage`                                                                       |

A brief is complete when the zod `Brief` schema parses with all required fields. While incomplete, the trip stores a `BriefDraft` (`Brief.partial()`), and the digest ends with a `missing:` line naming the fields still needed.

| Field                                                      | Required | Notes                                                                                                      |
| ---------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `days`                                                     | yes      | integer > 0                                                                                                |
| `maxKmPerDay`, `maxGainPerDay`                             | yes      | km and metres of D+                                                                                        |
| `start`, `end`                                             | yes      | `{ placeId, publicTransport }`; `publicTransport` drives the `access` rule                                 |
| `overnight`                                                | yes      | `camp`, `shelter`, `hut`, `gite` or `any`                                                                  |
| `travel`                                                   | yes      | `{ from: placeId, modes: (train / car / bus / any)[], maxOneWayHours }`: how far from home the hike may be |
| `startDate`, `maxWaterGapKm`, `season`, `fitness`, `notes` | no       |                                                                                                            |

**Home place.** `settings.json` stores a global home place (the user lives near Paris). A new Brief's `travel.from` defaults to it, and a trip may override it to depart from elsewhere. There is no transit routing yet, so the travel-time limit is a _warning_, not a violation (§11).

### 9.2 Trip digest (the planner's view of the present)

Injected into the instructions at the start of every turn. It is short, generated by code from `trip.json`:

- the brief, in one block;
- each stage: id, from → to (labels and ids), km, D+, overnight, routeId;
- open violations (ids, rules, measured vs limit), then unverified warnings;
- **edits since the last turn** (from map edits, §10), as id-level diffs.

The transcript is for dialogue only. When the record is rebuilt, tool outputs older than the last 2 turns are replaced by one-line stubs ("find_pois returned 14 POIs near stage_2"), since the digest already holds the current state.

### 9.3 Tools

| Tool                               | Kind                                                                   | Returns to the model                                                            |
| ---------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `ask_user(question, options?)`     | **client-side** (no `execute`); rendered as a card, answered in the UI | the user's answer                                                               |
| `find_place(query, nearHint?)`     | server → `GeocodePort`                                                 | candidates: `placeId`, label, kind                                              |
| `find_pois(near, radiusKm, kinds)` | server → Overpass cache                                                | POIs: `poiId`, name, kind, water tier, distance; **top 15**                     |
| `points_along(routeId, …)`         | server                                                                 | POIs near the line, distance along route; top 15                                |
| `submit_brief(brief)`              | server, zod-validated                                                  | ack, or structured issues                                                       |
| `submit_itinerary(stages)`         | server, zod-validated                                                  | ack + `stageId`s, or structured issues                                          |
| `amend_stage(stageId, patch)`      | server, zod-validated                                                  | ack, or structured issues                                                       |
| `route(stageId)`                   | server → `RoutingPort`                                                 | km, D+, D−, estimated time, snap distances, `routeId`                           |
| `conditions(tripId)`               | server, **deterministic** (Open-Meteo + suncalc)                       | sunrise and sunset per day, forecast if within range, daylight margin per stage |
| `validate(tripId)`                 | server, deterministic                                                  | violations + warnings (§11)                                                     |
| `scout(stageId, question)`         | server, **synchronous sub-agent** (cheap model)                        | a short structured answer                                                       |
| `critique(tripId)`                 | server, **synchronous sub-agent** (strong model)                       | proposed changes, never edits                                                   |
| `export_trip(tripId)`              | **client-side** (no `execute`); the host asks y/N, the planner exports | paths of the written files                                                      |

M1 implements `ask_user`, `find_place`, `submit_brief`, `submit_itinerary`, `route` and `export_trip`. The rest arrive in M4.

M1 tool details (as built):

- Tools are bound to one trip when created (`createTools(deps)`), so the model never passes a trip id. `export_trip` and the others take no `tripId`.
- Tools reload the trip after every network call and save in the same synchronous block (`route`, `find_place`): the model issues parallel tool calls in one step, and a stale copy saved last would erase the others' writes.
- `export_trip` refuses while any stage has no `routeId`: nothing is written, the store error `unrouted` carries `stageIds`, and the planner returns `{ ok: false, error, unrouted }` so the model routes them first.
- `find_place`: `nearHint` is a `placeId` the model already holds; the server turns it into coordinates. Every candidate shown is saved in `trip.registry.places`. Results contain `placeId`, label and kind only.
- `submit_brief(brief, name?)`: accepts a partial `BriefDraft`, merges it over the stored one (top-level fields), checks every `placeId` is in the registry, optionally sets the trip name, and answers `{ complete, missing }`. A trip starts as "Untitled trip" with an empty brief; the CLI creates the trip and its chat together.
- `submit_itinerary(stages)`: refused until the brief is complete. Stages are `{ from, to, via?, overnight? }` of `placeId`s; it replaces all stages and waypoints, mints stage and waypoint ids, and shares one waypoint between stages that meet at the same place.
- `route(stageId)`: returns km, D+, D−, `routeId`. Estimated time and snap distances are not returned yet (snap distances are stored on the stage).
- Tool results that did nothing are `{ ok: false, issues }` (each issue has the input `path`) or `{ ok: false, error }` for adapter and store failures.
- `TurnHooks` also pass the `toolCallId` (third argument of `onToolCall` and `onToolResult`) so a host can pair a call with its result.
- `export_trip` is client-side like `ask_user` (no `execute`, no SDK approval). The turn stops with a pending `export_trip` call, the host asks the user `y/N`, and the typed line is the next `runTurn` input. See "Export approval" below.
- The system prompt is a separate module (`prompts/`): base rules plus one section per phase. English, replies in the user's language.

Planner loop (as built, `runTurn` in the agent package):

- One turn stores the user's input, or the answer to a pending `ask_user` (the answer becomes that call's tool result, not a second user message), then runs the AI SDK `ToolLoopAgent` with the whole stored transcript. The default limit of 20 model calls per turn applies.
- Instructions are rebuilt before every step from the trip: `systemPrompt(phase)` plus `renderDigest(trip)`. The phase can change inside a turn.
- Every finished step is appended to the chat file as it ends, so a pending `ask_user` is on disk before the host shows it. `pendingQuestion(chats, chatId)` reads it back after a restart.
- A tool whose results come back `ok: false` three times in one turn is removed from the active tools for the rest of that turn, and the instructions tell the model to ask the user instead.
- Text and tool activity are streamed to the host through `TurnHooks`: `onText(delta)`, `onToolCall(name, input)` and `onToolResult(name, ok)` (`ok` is false when the output says `ok: false`). A model failure is returned as an error, never thrown.
- Model: `claude-sonnet-5-5` through Anthropic, hardcoded in `models.ts`; key from `ANTHROPIC_API_KEY` via `SecretsPort`. `toolCallingSelfTest(model)` runs one scripted tool call.
- **Export approval:** `TurnOutcome.pending` is a union: `{ tool: "ask_user", question, options? }` or `{ tool: "export_trip" }` (`pendingQuestion` returns the same). When the pending call is `export_trip`, the next input trimmed and lowercased equal to `y` or `yes` approves: `runTurn` runs `exportTrip(deps.trips, deps.tripId)` and stores `{ ok: true, files }` or the store failure as that call's result. Anything else stores `{ ok: false, declined: true }`. Then the turn continues so the model reports the outcome. The CLI prints `Write the GPX files? [y/N]`, also on `--trip` resume. That prompt is the only confirmation: the refine prompt and the tool description tell the model never to ask about exporting itself (text or `ask_user`), otherwise the user is asked twice.
- Older tool outputs are not trimmed yet; the full transcript is sent.

### 9.4 Submit loop

- Invalid input returns **structured issues**: `[{path: "stages.2.overnight", message: "…"}]`, taken from the zod error.
- Retries are counted **per tool per turn**, max 3 (via `prepareStep`). After that, the agent must call `ask_user` instead of retrying.
- A client-side tool (`ask_user`) ends the loop: the pending call is persisted to the chat record **before** the UI shows the card. Answering it sends the tool output and starts the next turn, so resuming after a restart works with no extra code.

### 9.5 Sub-agents

- **v0:** `scout` and `critique` are synchronous tools. Each runs its own `ToolLoopAgent` (with a read-only tool subset) inside `execute`, and returns a structured result. `conditions` is not an agent at all.
- **(later) Workbench with ack-and-steer**, added only when waiting on a sub-agent visibly hurts. Same tool names, different execution:
  1. The tool returns an ack immediately; a job file is written to `jobs/`.
  2. On completion, the result becomes a **steer** message with id `steer_<jobId>`.
  3. The steer triggers a wake turn only when no turn is running **and no `ask_user` is pending**. Otherwise it waits in the queue.
  4. The job is marked done only after the wake turn persists. Delivery is exactly-once via the steer id.
  5. On startup, stale jobs are recovered.
  6. A notify-only push channel lets the UI pick up wake turns.
- All LLM calls outside the main turn share one semaphore (3 permits).

### 9.6 Models

- Two slots: **strong** (planner, critique) and **cheap** (scout). Each slot is switchable at run time between providers (Anthropic, Mistral; local models later) in `settings.json`.
  - **Status (built):** only the strong slot exists. Until `settings.json` does, `GPX_BUILDER_PROVIDER=anthropic|mistral` (default `anthropic`; any other value is an error) picks the provider for both composition roots. Models: `claude-sonnet-5-5` and `mistral-medium-latest`; keys `ANTHROPIC_API_KEY` / `MISTRAL_API_KEY` through `SecretsPort`. Cheap slot: not built.
- At startup and when a slot changes, run a **tool-calling self-test**: one scripted tool call. A slot that fails shows a warning, since small local models often can't call tools reliably.
  - **Status (built):** both composition roots run `toolCallingSelfTest` once at startup (one real model call); a failure is a warning and the app carries on. Not yet re-run when a slot changes (no settings UI).

---

## 10. Map edits

The map is a second way to change the trip, alongside the planner. Both go through the same trip service.

1. The user drags a waypoint, adds a point or deletes one on the map.
2. The webview sends an `EditCommand` over tRPC: `{kind: "move" | "insert" | "delete", stageId, waypointId?, lngLat?, index?}`.
3. The trip service applies it to `trip.json`, creating a `user` waypoint where needed. It re-routes **only the affected stage**, re-validates, and records the change in `trip.json.pendingEdits`.
4. The next planner turn sees the change in the trip digest's "edits since last turn". The digest clears `pendingEdits` once delivered.

---

## 11. Validation (deterministic, in `core`)

`validate(trip, routes, pois, rules) → { violations: Violation[], warnings: Warning[] }`. Pure function, fully unit-tested.

```ts
type Violation = {
  id: ViolationId;
  rule: RuleId;
  stageId: StageId;
  severity: "error" | "warn";
  measured: number | string;
  limit: number | string;
  atKm?: number;
  message: string;
};
type Warning = { rule: RuleId; stageId?: StageId; message: string }; // unverifiable: the model can't fix these
```

Violations are things the planner can fix. Warnings are things nobody in the app can verify; they go to `report.md` and the UI, and the planner is told not to try to fix them.

**Rules (initial):**

| Rule                                                    | Kind           | Check                                                                                                                                |
| ------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `daily-distance`                                        | violation      | stage km within the brief's limit (+10% tolerance)                                                                                   |
| `daily-gain`                                            | violation      | stage D+ (smoothed, §12.4) within the brief's limit                                                                                  |
| `water-gap`                                             | violation      | max distance between **potable** sources along the stage ≤ brief limit (§12.3)                                                       |
| `overnight`                                             | violation      | stage ends at an overnight option of the requested type, per the region rules file; none found = violation                           |
| `access`                                                | violation      | start and end within the set distance of public transport, if requested                                                              |
| `continuity`                                            | violation      | stage _n_ ends where stage _n+1_ starts                                                                                              |
| `snap-distance`                                         | violation      | any waypoint snapped > 200 m to the path network                                                                                     |
| `private-access`                                        | violation      | route uses `access=private` or `access=no`                                                                                           |
| `backtracking`                                          | warn           | share of repeated segments on a loop > 15%                                                                                           |
| `daylight`                                              | violation      | estimated finish before sunset minus 1 h margin (Naismith-style time estimate)                                                       |
| `waymarked-share`                                       | info in digest | share of the stage on `route=hiking` relations (GR/GRP/PR)                                                                           |
| bivouac legality, spring reliability, seasonal closures | warning        | always "unverified — check locally"                                                                                                  |
| travel time from home                                   | warning        | `brief.travel.maxOneWayHours` can't be verified without transit routing: "unverified — check locally" until a transit service exists |

Tolerances and thresholds live in one `rules.ts` table in `core`.

---

## 12. Geo data and services

### 12.1 Routing

- **Default: ORS `foot-hiking`** with the user's key. The standard plan allows about 2,000 route requests per day, up to 50 waypoints.
- **GraphHopper** is optional. Its free plan allows 5 points per request and non-commercial use only.
- `RoutingPort` exposes `capabilities: { maxWaypoints, profiles }`. The adapter splits a stage into several requests when it has too many waypoints, and stitches the results.
- ORS key is mandatory for now; the CLI composition root fails at startup without `ORS_API_KEY`.
- Splitting a stage over 50 waypoints is _(later)_: for now the adapter returns an `invalid` error.
- Every request sets a snap search radius. The adapter records how far each waypoint moved to reach the path network; the numbers are kept on the stage as `snapDistancesM` (order: from, via..., to).
  A _snap_ is the router moving a waypoint onto the nearest path it can use. The radius is `SNAP_RADIUS_M` = 1000 m (ORS defaults to 350 m and fails outright beyond it); a wide radius lets routing succeed while the distance exposes a suspicious jump. Distances are only recorded for now; the warning threshold is chosen in the validator (M4) from real data.
- Routes are cached for 7 days (OSM data changes, and fresh data is the point of the app). ORS error mapping: code 2009/2010 and HTTP 404 → `not-found`; 2000–2008 and 400/413 → `invalid`; 429 → `rate-limit`; 401/403 → `unavailable` ("check ORS_API_KEY"); 5xx and 2099 → `unavailable`. Quota exhaustion is not documented by ORS: it is assumed to be a 429 until a real answer shows otherwise.
- Prefer, don't follow, waymarked trails: report the GR/PR share (§11). Never route directly along relation geometry; relations are often broken.
- **BRouter offline pack** _(later)_: jlink'd JRE + region segments, behind the same port.

### 12.2 Geocoding

- `GeocodePort`: **Photon** first (OSM data, worldwide, no key, typo tolerant). Nominatim and the IGN Géoplateforme (France only; its default index returns streets, stations need `index=poi`) are _(later)_ adapters. The app is global-first.
- Nominatim: max 1 request per second, identifying `User-Agent`, cache required.
- Results are cached for 30 days. `placeId = geo:photon:<node|way|relation>/<osm id>`; `kind` is the OSM tag as `key=value` (for example `railway=station`, `natural=peak`), never free text.

### 12.3 POIs (Overpass)

- **Tiles:** fixed z12 (about 6.5 km at 48°N). One combined query per tile for all POI kinds, `out center`.
- **Cache:** time-to-live 2–4 weeks, stored with `fetchedAt`.
- **Etiquette:** one request at a time from a queue, identifying `User-Agent` (app + repo URL), backoff on 429/504, configurable endpoint.
- **Water tiers:**

| Tier     | OSM tags                                                                               | Counts for `water-gap` |
| -------- | -------------------------------------------------------------------------------------- | ---------------------- |
| potable  | `amenity=drinking_water`, `man_made=water_tap`, any with `drinking_water=yes`          | yes                    |
| unknown  | `natural=spring` without `drinking_water=yes`, cemetery taps, `drinking_water` missing | no (warning)           |
| resupply | shops, cafés, restaurants with opening hours                                           | no (shown separately)  |

- Anything tagged `seasonal=yes` or `drinking_water=no` is never potable.

- **Overnight options:** `tourism=camp_site` (incl. `camp_site=basic`), `tourism=wilderness_hut`, `amenity=shelter`, `tourism=alpine_hut`, gîtes (`tourism=hostel` / `guest_house` with gîte tags).
- **Region rules file:** a versioned `rules/regions/<region>.json` maps areas to bivouac allowed / banned / designated zones only (e.g. bivouac is generally banned in Île-de-France state forests, with designated areas in Fontainebleau). Missing region = "unverified".

### 12.4 Elevation

- Terrarium (≈25–30 m resolution) is used for display, the elevation profile and 3D.
- **D+ computation** in `core`:
  1. resample the line every 20 m;
  2. smooth (moving average, 5 samples = 100 m; a constant in `core`, tune against real tracks);
  3. count a climb only when it exceeds a 4 m hysteresis threshold.

  Unit-tested against fixture tracks with known D+.

- **Profile:** the elevation profile reads the per-point elevation already in each stage's route geometry (ORS `elevation: true`). Distance is a running haversine sum, so it is geometric and unrelated to the D+ pipeline above. A stage with no usable elevation adds no samples but still counts toward distance.
- **France:** optional `ElevationPort` adapter for the IGN RGE ALTI altimetry service, used for stats when enabled.

### 12.5 Basemap, weather, sun

- **Basemap:** OpenFreeMap hosted vector tiles, online only. See [ADR 0001](adr/0001-online-basemap.md). Style `liberty` in light mode and OpenFreeMap's `dark` style in dark mode (there is no dark liberty), chosen when the map is created. Hillshade and 3D terrain from AWS Terrain Tiles (Terrarium). Never pull tiles from OSM's tile servers.
- **Weather:** Open-Meteo, no key.
- **Sun:** suncalc, computed in the trip's timezone (`Europe/Paris` for France, including the daylight-saving change).

### 12.6 GPX output

- **Tracks (`trk`), not routes (`rte`)**, so apps don't re-route.
- `route.gpx`: one `trk` per day. `route-merged.gpx`: one `trk`, for Komoot / Garmin Connect, which import only the first track.
- Points of interest as `wpt` in `waypoints.gpx`, with `name`, `sym` and `type`.
- `ele` from our own DEM. No fake `time` values.
- Metadata: name, description, link to `report.md`, and OSM copyright:
  `<copyright author="OpenStreetMap contributors"><license>https://opendatacommons.org/licenses/odbl/</license></copyright>`.

### 12.7 Attribution and licences

- "© OpenStreetMap contributors" (ODbL) on the map, in GPX metadata and in `report.md`. OpenFreeMap and IGN attributed where used.
- GPX tracks and `report.md` are Produced Works under ODbL: attribution required.
- POI extracts (`waypoints.gpx`, cached GeoJSON) are derivative databases. If shared, ODbL share-alike applies. `report.md` says so.

---

## 13. Failure handling

| Failure                      | Timeout / retries                 | What the user sees                                        | Turn                            |
| ---------------------------- | --------------------------------- | --------------------------------------------------------- | ------------------------------- |
| LLM 429 / 5xx                | 60 s, 2 retries with backoff      | "provider busy, retrying…", then an error card with retry | fails, transcript kept          |
| LLM can't call tools         | self-test at startup (§9.6)       | warning on the model slot                                 | blocked until slot changes      |
| ORS quota exhausted / 429    | no retry on quota; backoff on 429 | "routing quota reached — resets at …"                     | continues; stage left unrouted  |
| ORS 5xx / timeout            | 20 s, 2 retries                   | "routing unavailable" on the stage                        | continues                       |
| Overpass 429 / 504 / timeout | 60 s, queue + backoff up to 3     | "POI data delayed"; stale cache used if present           | continues with stale or no POIs |
| Geocoder no result / error   | 10 s, fallback to next provider   | `ask_user` to rephrase or pick on map                     | continues                       |
| Open-Meteo error             | 10 s, 1 retry                     | "forecast unavailable"                                    | continues                       |
| Disk write fails             | atomic-write retries (§7.4)       | blocking error with the path                              | fails, nothing partial written  |

Every adapter returns `Result<T, AdapterError>` with a typed error kind. The file stores return `Result<T, StoreError>` with kinds `not-found`, `invalid` (fails the schema), `corrupt` (unparseable), `newer-version`, `duplicate` and `io`. The tool turns that into a message the model can act on.

---

## 14. Testing

All deterministic, **no network, no keys**:

1. **Core units:**
   - contracts and migrations;
   - every validator rule;
   - D+ smoothing against fixture tracks;
   - water tiers;
   - GPX serializer, round-tripped through `@tmcw/togeojson`;
   - phase derivation;
   - trip digest rendering.
2. **Adapters:** recorded fixture responses for ORS, the geocoders and Overpass. File stores run against temp `<APP>_DATA_DIR` / `<APP>_CACHE_DIR` / `<APP>_TRIPS_DIR`, including the Windows-style rename-retry path (simulated EBUSY).
3. **Agent flows:** a fake LLM engine with scripted responses drives full turns:
   - tool calls and submit retries;
   - `ask_user` persistence and resume;
   - map edit → digest;
   - _(later)_ steer wake and crash recovery.
4. **Fixture trips** in `examples/`: a two-day forest loop near Paris, as golden outputs (`trip.json`, `routes/`, GPX, `report.md`).

Core tests also cover: the GPX round trip through `@tmcw/togeojson` (dev dependency), the D+ fixtures (including sub-threshold noise), and id formats.

Gates on every change: `prettier --check`, `eslint`, `tsc --noEmit`, `bun test` (`bun run check` runs all four).

---

## 15. Security and privacy

- **Keys, M1:** read from a gitignored `.env` (`ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`, `ORS_API_KEY`; template in `.env.example`) through `SecretsPort`; only the key of the provider chosen with `GPX_BUILDER_PROVIDER` is required (§9.6). Never logged, never written to trip or data files.
- **Keys, backend phase:** `Bun.secrets` with `persist: "local"` (no roaming on Windows), cached in memory after the first read.
  - On Linux without a running Secret Service, the app says so and offers an explicit fallback: an environment variable, or a key file with 0600 permissions that the user opts into.
  - `Bun.secrets` is marked experimental; it stays behind a `SecretsPort`.
  - **Status (M2, built):** `createSecrets` in `adapters` chains env var → opt-in key file (`<data>/secrets.json`, mode 0600, refused on read if group/other bits are set) → keychain (service `gpx-builder`). `keychainStatus()` reports `{ available, reason }` once the keychain has thrown, so the app can show the "no Secret Service" message. `set`/`delete` exist only on the `AppSecrets` type, not on core's `SecretsPort`; they write to the key file if opted in, else the keychain, and throw on failure.
- **Loopback server:** hardened as in §3.1.
- **Logs:** under `<data>/logs/`, rotated. They never contain keys, full prompts or full model outputs, only ids, tool names, timings and error kinds.
- **What leaves the machine:** model requests send only the context the task needs. The UI states that "local storage" does not mean offline processing.
- No telemetry.
- **Usage meter:** token counts per chat and per sub-agent call. Cost in currency _(later)_, once a price table per model exists; local models show tokens only.

---

## 16. Operations

- **Single-instance lock:** a second launch focuses the existing window. Required by §7.4's single-writer assumption.
  - **Status (M2, primitive built):** `acquireInstanceLock(dataDir)` in `store` creates `<data>/instance.lock` (our pid) exclusively and returns `ok({ release })` or `err("held")`. If the file exists, the owner pid is probed with signal 0: a dead pid or garbage content means a stale lock, which is removed and retaken once. The caller releases on exit. Focusing the existing window is Electrobun's job (apps/desktop). Known ceiling: a reused pid reads as `held`.
- **Crash handling:** handlers for uncaught exceptions and unhandled rejections log the error, flush pending writes and show a restart dialog.
- **Migrations:** run before any write. Data with a newer `v` than the app knows opens read-only (§7.4).
- **Updates** _(later)_: Electrobun's updater or a GitHub Releases check. An update never changes a data format without a migration in `core`.

---

## 17. Build and distribution

- **v0:**
  - build on the author's own OS;
  - CI on Linux (`.github/workflows/bun-checks.yml`, runs on every push to every branch, single `bun-checks` job, required on `main`) runs `prettier --check`, `eslint`, `tsc` and `bun test --coverage`; coverage floor is `coverageThreshold` in `bunfig.toml` (90% lines and functions, applied per file by Bun);
  - releases unsigned.
- **(later):**
  - GitHub Actions matrix (macOS, Windows, Ubuntu), since Electrobun builds per host platform;
  - CEF bundled on Linux;
  - macOS notarization, Windows signing.
- **Licence:** AGPL-3.0.

---

## 18. Milestones

|                    | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Done when                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0** Foundations | Bun workspace, four packages + `apps/cli`, import-law lint, Prettier, `core` (ids, contracts, ports, phase, digest, D+, GPX serializer)                                                                                                                                                                                                                                                                                                                                 | `bun run check` passes. **Done.**                                                                                                                    |
| **M1** Agent (CLI) | `store` (atomic writes, `trip.json`, `routes/`, chat JSONL, data/cache dir seams; settings come later (keys and model slots come from `.env` and flags)), `adapters` (Photon geocoder, ORS `foot-hiking` with elevation, disk cache), `agent` (planner, tools in §9.3 marked M1, Anthropic/Mistral model slots), `apps/cli` chat REPL (built: `bun cli`, `bun cli trips`, `--trip <id>`, `--verbose`; strong slot switchable with `GPX_BUILDER_PROVIDER=anthropic       | mistral` and tool-calling self-test at startup, §9.6; cheap slot and live run still to do)                                                           | A fake-LLM test drives a full turn including an `ask_user` resume; "2-day loop from X" run live from the terminal writes a trip folder whose GPX opens in OsmAnd |
| **M2** Backend     | _Built headless:_ composition root, hardened loopback with a ping route, tRPC router, `/api/chat` stream, tests (§3.1, §20); single-instance lock and keychain `SecretsPort` primitives. _Used by the webview in dev via `bun run serve` (§20)._ _Still to do:_ Electrobun main process (incl. the preload that sets `__GPX_BACKEND__`), wiring the lock and keychain into it; `apps/desktop/src/backend` reuses the M1 packages                                        | App launches; loopback rejects a wrong Host or token; the M1 flow works through tRPC and SSE without a UI; mixed-content check passes on the webview |
| **M3** Frontend    | Webview: chat panel, MapLibre map, elevation profile, trip list; refetch model (§3). _Built:_ webview on the real backend (tRPC reads, `useChat` over `/api/chat`, per-stage route lines; §20 webview decisions, pending review) and the OpenFreeMap basemap. Elevation profile under the expanded map (shadcn chart over recharts; trip or one day; hover moves a dot on the map; slope-coloured route and profile background with a legend). _Still to do:_ map edits | The M1 flow runs from the UI                                                                                                                         |
| **M4** Iterate     | Remaining scope, order decided when we get here: `find_pois` (Overpass), validator (all §11 rules), `conditions`, region rules file, `report.md`, map edits (§10), `amend_stage`, `scout` and `critique`; then one of Workbench, `events.jsonl` undo/history, or BRouter offline pack                                                                                                                                                                                   | A planted violation is caught, fixed by re-routing one stage only, and clears; a map edit appears in the next digest                                 |

---

## 19. Seam directory

| Seam                           | Location                                                      | What it swaps                                         |
| ------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------- |
| Storage                        | composition root + `packages/store`                           | file layout, in one place                             |
| Routing                        | `RoutingPort` + `packages/adapters/routing`                   | ORS ↔ GraphHopper ↔ BRouter                           |
| Geocoding                      | `GeocodePort`                                                 | Photon ↔ Nominatim ↔ IGN                              |
| Elevation                      | `ElevationPort`                                               | Terrarium ↔ IGN RGE ALTI                              |
| Secrets                        | `SecretsPort`                                                 | `.env` ↔ keychain ↔ env var ↔ key file                |
| LLM per role                   | settings model slots + engine factory in the composition root | provider/model, local vs hosted                       |
| Data, cache and trips location | `<APP>_DATA_DIR`, `<APP>_CACHE_DIR`, `<APP>_TRIPS_DIR`        | where files live (also the test seams)                |
| Agent construction             | turn handler takes an optional agent builder                  | scripted engines in tests                             |
| Sub-agent execution            | tool `execute` for `scout` / `critique`                       | synchronous now, Workbench job later, same tool names |
| Composition root               | `apps/cli` ↔ `apps/desktop/src/backend`                       | which shell drives the same packages                  |
| Transport                      | `apps/desktop/src/backend` server + webview client links      | hardened loopback ↔ Electrobun RPC                    |

---

## 20. Decision log and open questions

**Decisions in v1** (from the 2026-10-28 review):

| Decision                                 | Choice                                                                                                                                                | Alternative kept open                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Transport                                | Hardened loopback (§3.1): keeps tRPC + `useChat` streaming unchanged                                                                                  | Electrobun typed RPC: already encrypted, but streaming and the tRPC link must be built by hand |
| Trip storage                             | `trip.json` is the source of truth + `routes/` as evidence; `trip.prev.json` for one-level undo                                                       | `events.jsonl` event log, when undo/history is needed (M4)                                     |
| Route geometry                           | stored in the trip folder, content-addressed `routeId`                                                                                                | — (cache-only geometry made trips unrebuildable)                                               |
| Phase                                    | derived from trip state                                                                                                                               | — (transcript parsing broke with map edits)                                                    |
| Sub-agents                               | synchronous tools in v0                                                                                                                               | Workbench with ack-and-steer (M4)                                                              |
| Default router                           | ORS `foot-hiking`                                                                                                                                     | GraphHopper as optional adapter                                                                |
| Chats                                    | JSONL, one message per line                                                                                                                           | — (whole-file JSON rewrite grew per turn)                                                      |
| Push events                              | none in v0; refetch after mutations                                                                                                                   | notify-only tRPC subscription, with the Workbench                                              |
| Build order (v1.1)                       | Agent via CLI, then backend, then frontend                                                                                                            | Desktop shell first (original M0)                                                              |
| Packages (v1.1)                          | Four packages from M0                                                                                                                                 | Start with two, split at M2                                                                    |
| Ids (v1.1)                               | UUID v4 for `tripId` / `chatId`                                                                                                                       | ULID (sortable, needs a dependency or own code)                                                |
| Keys (v1.1)                              | `.env` through `SecretsPort` until the backend phase                                                                                                  | Keychain from day one                                                                          |
| Travel from home (v1.1)                  | `brief.travel` + global home place; time limit is an unverified warning                                                                               | Transit service now; straight-line distance proxy                                              |
| Result type (v1.1)                       | Own `Result<T, AdapterError>` in `core`                                                                                                               | neverthrow                                                                                     |
| Store ports (v1.1)                       | Synchronous `Result<T, StoreError>`; network ports stay async                                                                                         | Async everywhere (risks interleaved read-modify-write)                                         |
| Settings (v1.1)                          | Deferred; `.env` and CLI flags until a UI needs them                                                                                                  | Settings file in M1                                                                            |
| Trip folder (v1.1)                       | `<yyyy-mm>-<slug>-<8 hex of tripId>`, suffix is a hint only                                                                                           | `<yyyy-mm>-<slug>` with counters on collision                                                  |
| Route id (v1.1)                          | sha256 of a canonical, rounded serialisation                                                                                                          | hash of whatever bytes were written                                                            |
| Stage km (v1.1)                          | Our own haversine length, not the router's `distanceM`                                                                                                | Router figure                                                                                  |
| `RoutedStage` (v1.1)                     | Router answer for a whole stage (was `RouteLeg`)                                                                                                      | Per-pair legs                                                                                  |
| Chat lines (v1.1)                        | Own `ChatMessage` zod contract (text, tool-call, tool-result), mapped to AI SDK messages in the agent                                                 | Store AI SDK `UIMessage` as is                                                                 |
| App data location (v1.1)                 | One hidden `~/.gpx_builder/` with `data/`, `cache/`, `trips/` on every OS; env vars override                                                          | Per-OS app-data folders and `~/Documents/<App>/trips`                                          |
| Derived files (v1.1)                     | Pure builder in `core`, `writeDerived` in the store, `exportTrip(store, tripId)` orchestrates; written only on explicit export                        | Store builds GPX itself; regenerate on every save; orchestration inside the tool               |
| Chat damage (v1.1)                       | Keep an unterminated last line if it parses; cut a torn one (copy saved); quarantine on a damaged complete line; refuse appends to a quarantined chat | Drop bad lines silently; start a fresh file after quarantine                                   |
| Chat timestamps (v1.1)                   | `createdAt` on each message; last activity = last message, no `updatedAt`                                                                             | `updatedAt` on messages or chats                                                               |
| Global first (v1.1)                      | Photon is the default geocoder; ORS with a mandatory key is the router; IGN, Nominatim and BRouter are later adapters                                 | IGN as default (France only)                                                                   |
| Place kind (v1.1)                        | OSM tag as `key=value`                                                                                                                                | Free-text provider labels                                                                      |
| Cache (v1.1)                             | `CachePort` (sync, text) with a disk store; TTL chosen by the adapter: geocoding 30 days, routes 7 days                                               | Long or no expiry for routes                                                                   |
| Snap (v1.1)                              | Radius 1000 m, distances recorded only; threshold decided in M4                                                                                       | ORS default 350 m; an early warning number                                                     |
| Tools bound to a trip (v1.1)             | `createTools(deps)` closes over the trip id; no tool takes a trip id                                                                                  | Model-supplied `tripId` arguments                                                              |
| Brief submission (v1.1)                  | `submit_brief` takes a partial draft, merges, reports `missing`                                                                                       | Only a full brief in one call                                                                  |
| Planner persistence (v1.1)               | Each step is stored as it ends; user input answering a pending `ask_user` is that call's result                                                       | Storing the whole turn at the end                                                              |
| Export approval (v1.1)                   | `export_trip` is a client-side tool answered y/N by the host; the planner runs the export on yes and stores the result                                | SDK `toolApproval`: needs approval request/response parts in the chat format                   |
| Model (v1.1)                             | One hardcoded Anthropic model (superseded by the Mistral rows below)                                                                                  | Env-switchable slots and a Mistral option                                                      |
| Chat id (v1.1)                           | `chatId` = `chat_<uuid of the trip>`: one chat per trip, no mapping to store                                                                          | Independent chat uuid with a stored link                                                       |
| Listing trips (v1.1)                     | `TripStorePort.list()` reads each `trip.json` (skips unreadable), newest `updatedAt` first                                                            | Rescan with `trips-index.json` (deferred, see below)                                           |
| CLI commands (v1.1)                      | `bun cli` new trip; `--trip <id>` resume; `bun cli trips`; `--verbose`; in the REPL `/trips`, `/quit`, `exit`, Ctrl-D                                 | —                                                                                              |
| Empty trips (v1.1)                       | `TripStorePort.delete(tripId)` removes the folder; the CLI deletes a new trip on quit if no message was sent (never a resumed one)                    | Create the trip lazily on the first message                                                    |
| No `--home` flag (v1.1)                  | The start point is given in the conversation and stored in `brief.travel.from`                                                                        | A `--home` flag or a global home place                                                         |
| Parallel tool writes (v1.1)              | Network call first, then load-modify-save synchronously                                                                                               | Disable parallel tool calls; per-trip lock                                                     |
| Stale lock (M2, pending user review)     | pid in `<data>/instance.lock`, created `wx`; dead pid probed with signal 0 means stale, remove and retake once                                        | Pid + process start time (per-OS code, fixes pid reuse); OS `flock` (needs FFI)                |
| Port extension (M2, pending user review) | `SecretsPort` unchanged; `set`/`delete` only on `WritableSecrets` / `AppSecrets` in `adapters`                                                        | Extend `SecretsPort` now (env adapter would have to throw)                                     |
| Secrets chain (M2, pending user review)  | `createSecrets`: env → key file → keychain, in `adapters`; failing keychain is skipped and exposed via `keychainStatus()`                             | Chain left to the composition root; keychain first                                             |
| Key file (M2, pending user review)       | `<data>/secrets.json`, path passed by the caller (opt-in), mode 0600                                                                                  | Path from a setting (no settings yet)                                                          |
| Strict export (v1.1)                     | Export refuses unrouted stages: `StoreError` kind `unrouted` + `stageIds`, planner returns `unrouted` to the model                                    | Export routed stages only; export with a warning                                               |

**Decisions in M2, backend (2026-11-08).** All rows are **pending user review**: they were agreed with the coordinator while the user was away.

| Decision                           | Choice                                                                                                                                                                                                                                                         | Alternative kept open                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Router in core (M2)                | `createAppRouter({ trips, chats, now? })` and the `AppRouter` type live in `core/server/app-router.ts`, built from injected ports; the webview imports the type only, through the `@gpx-builder/core/server/app-router` export                                 | Router in `apps/desktop/src/backend`; type re-exported                            |
| Router split (M2)                  | Two routers in `core/server/routers/` merged with `mergeRouters`, like the tRPC Bun example: `core.ts` (trips: list, get, create, route, export) and `ai.ts` (`chats.messages`). Paths stay flat. The agent stream stays on `/api/chat`; see `docs/backend.md` | Chat as a tRPC subscription (drops `useChat`); prefixed paths (`core.trips.list`) |
| Route names (M2)                   | Core CRUD is served under `/api/file/*` (tRPC, e.g. `/api/file/trips.list`) and the agent under `/api/chat`; no `/trpc`                                                                                                                                        | `/trpc`                                                                           |
| tRPC procedures (M2)               | `trips.list`, `trips.get`, `trips.create`, `trips.route`, `trips.export`, `chats.messages`. No delete, no send: chat goes through `/api/chat`                                                                                                                  | Flat names; a `chats.pending` procedure                                           |
| `trips.list` (M2)                  | Full `Trip[]`, newest `updatedAt` first (home cards need stats); loads each trip from the port's list                                                                                                                                                          | The port's `{id, name, updatedAt}` summaries                                      |
| `trips.create` (M2)                | Empty "Untitled trip", `brief: {}`, and `trip.chatId` set to `chat_<trip uuid>` (`chatIdOf` moved into `core`; the CLI uses it too)                                                                                                                            | Leave `chatId` unset and derive it in the webview                                 |
| `trips.route` (M2)                 | `{ stageId, line: Position3[] }[]`, one entry per routed stage in stage order                                                                                                                                                                                  | One flat `LngLat[]` (what the mock returns)                                       |
| `trips.export` (M2)                | Explicit user action: runs `exportTrip` without y/N and returns the paths. An unrouted stage is `PRECONDITION_FAILED`                                                                                                                                          | Same approval flow as the planner tool                                            |
| Store errors in tRPC (M2)          | `not-found` → `NOT_FOUND`, `unrouted` → `PRECONDITION_FAILED`, anything else → `INTERNAL_SERVER_ERROR`                                                                                                                                                         | Error shapes carrying the `StoreError` kind                                       |
| Chat request (M2)                  | `POST /api/chat` with `{ tripId, text }`, not `useChat`'s `{ messages }`: the server owns the transcript, and `text` is a new message or the answer to the pending question (the `runTurn` rule). Client: `prepareSendMessagesRequest`                         | Send the whole message list                                                       |
| Chat stream (M2)                   | AI SDK UIMessage SSE: `start`, text blocks, `tool-input-available` / `tool-output-available` (`dynamic`, output is only `{ ok }`), `data-pending` with the `PendingQuestion`, `error` on failure, `finish`                                                     | Full tool outputs in the stream                                                   |
| Pending question after reload (M2) | The webview derives it from `chats.messages` (last tool-call without a result)                                                                                                                                                                                 | A `chats.pending` procedure                                                       |
| One turn per trip (M2)             | A second `/api/chat` for a trip with a turn in flight gets 409                                                                                                                                                                                                 | Queue it                                                                          |
| Preflight and token (M2)           | `OPTIONS` is checked for Host and Origin only (browsers send no `Authorization` on preflight); all other requests need the token                                                                                                                               | —                                                                                 |
| Headless entry (M2)                | `bun run serve` starts the server on a random port with the dev origin `http://localhost:5173` (override: `GPX_BUILDER_ALLOWED_ORIGINS`) and prints the token to the terminal. Replaced by Electrobun                                                          | —                                                                                 |
| New dependencies (M2)              | `@trpc/server` (core, desktop), `@trpc/client` (desktop), `ai` and `zod` also declared in `apps/desktop`; `@gpx-builder/agent` exports `./test-util` for tests                                                                                                 | —                                                                                 |

**Decisions: Mistral provider (2026-11-12, pending user review).**

| Decision          | Choice                                                                                                                                                                                             | Alternative kept open                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Provider switch   | `GPX_BUILDER_PROVIDER=anthropic\|mistral`, default anthropic, unknown value is an error; read only in the composition roots (`providerFromEnv`), `createStrongModel(secrets, provider)` stays pure | `settings.json` (later); model code reading the env    |
| Mistral SDK       | `@ai-sdk/mistral` **4.0.79**, exact: the newest release on `@ai-sdk/provider` 4.0.35, the one `ai` 7.0.162 uses. 4.0.80+ pull a newer provider and fail the type check (new `ping` stream part)    | Latest 4.0.84 (needs an `ai` bump)                     |
| Models            | One strong slot: `claude-sonnet-5-5` / `mistral-medium-latest` (`STRONG_MODEL_ID`, `MISTRAL_STRONG_MODEL_ID`)                                                                                      | Cheap slot, per-slot choice (with `settings.json`)     |
| Key               | `MISTRAL_API_KEY` through the `createSecrets` chain; the CLI requires only the chosen provider's key                                                                                               | —                                                      |
| Startup self-test | Both roots call `toolCallingSelfTest` after building the model; failure logs a warning and continues (§9.6, §13)                                                                                   | Fail hard; re-run on slot change (when settings exist) |

**Open questions:**

- **Name** of the app (replaces `<App>`).
- **Licence variant:** `AGPL-3.0-only` vs `AGPL-3.0-or-later`.
- **Offline use on the trail** as a requirement? It would pull the BRouter pack and region downloads earlier.
- CEF on all platforms vs Linux only.
- Importing existing GPX files as the starting point for a trip.
- Trip history and preferences carried across sessions (LearnHarness's "library" idea).
- **Transit routing** to verify `brief.travel` (Navitia, Transitous/MOTIS, ...): needed to turn the travel-time warning into a rule.
- **Which provider fills the cheap slot**, and defaults (strong slot: env-switched anthropic/mistral, see the Mistral decisions).
- **GPX formatting:** compact (today) or pretty-printed.
- **`Stage.overnight`** stores only the kind; the night's place is the stage's `to` waypoint. Revisit when the `overnight` rule is built.
- **M4 ordering** relative to the frontend, once M1 is done.
- **Home place without settings:** decided for now: the start point is given in the conversation (`brief.travel.from`), no flag. Revisit when `settings.json` exists.
- **Deferred file safety:** Windows rename retry and the trip rescan with `trips-index.json`.

**Frontend scaffold (2026-11-06).** `apps/desktop/src/webview` is a Vite + React SPA (TanStack Router and Query) that runs in a plain browser (`bun run --cwd apps/desktop dev`), with mock data in `fixtures/` behind `api.ts`; M2 swaps `api.ts` for tRPC. Client state is **Zustand** (`ui-store.ts`), only for UI state; trips and chat stay in Query. Alternatives kept open: Jotai, or Router search params with no store. Tailwind v4 and shadcn/ui (Radix, `new-york`, `components.json`, `@/` alias) are set up; add components with `bunx shadcn@latest add <name>` from `apps/desktop`, then fix the generated `cn` import to `@/lib/utils`. **Look (minimalist mountain):** slate neutrals with a glacier-blue primary, 0.375rem radius, system font stack (nothing bundled, works offline), light and dark following the OS via `prefers-color-scheme` (theme tokens in `index.css`). `apps/desktop` has its own tsconfig (DOM lib), and a lint zone limits the webview to `core/browser`.

**Frontend layout (2026-11-06).** Home `/` has no navbar: a centered chat box starts a new trip, with the 6 most recent trips in a 3x2 card grid underneath. Trip `/trips/$tripId` has a collapsible left sidebar (New chat, all trips, Settings stub), messages above a bottom input, and a strip above the input with trip totals (days, km, gain, loss) next to a clickable map thumbnail that expands into an overlay over the messages (input stays visible). The map is an SVG placeholder until MapLibre; the tile source (PMTiles) is still to be decided. `mapExpanded` lives in Zustand.

**Theme reset (2026-11-07).** The custom slate/glacier-blue palette was dropped: the app uses the stock shadcn neutral theme (`baseColor: neutral`, `--radius: 0.625rem`, OS-driven dark mode) until a real theme is chosen. Only tokens in `index.css` change when that happens.

**UI direction: learnharness-like (2026-11-08).** Reference: github.com/amosblomqvist/learnharness (minimalist, flat, hairline borders, mono caps labels, serif titles, the graph is the home). Decisions:

- **Home `/`:** no sidebar; the map is full-bleed and draws every trip's route; floating chat input at the bottom, the 6 most recent trips as pill chips above it, trip search and Settings on top. Search filters the chips.
- **Trip view:** sidebar (search, per-trip status line and relative time from `updatedAt`, Settings pinned), serif title with phase chips (`brief`/`plan`/`refine`, from `core` `phase()`), floating mini-map with totals at the bottom right that expands over the messages.
- **Type:** Source Serif 4 (titles) and JetBrains Mono (the `caps` utility: small uppercase labels), bundled with `@fontsource-variable` so it works offline; system sans for body. Fonts are to be reviewed by the author.
- **Theme:** light and dark follow the OS, neutral warm surfaces, pastel sage primary, peach and lavender for route colours (`--sage`, `--peach`, `--lavender`), 0.75rem radius.
- **Left out for now:** background-jobs panel and the model/cost line.

**Map: MapLibre in the webview (2026-11-08).** `MapView` is real MapLibre GL JS (v6, named imports, no default export) with the OpenFreeMap basemap (§12.5; `liberty` light, hosted `dark` style in dark mode, picked at load, compact attribution on the interactive maps). If the style or tiles fail to load (offline), the map falls back to a blank background, the routes still draw and a "Basemap unavailable" caption shows (404 tiles are ignored). A style load wipes layers, so the route layer is re-added on every `style.load`. Routes are drawn as one GeoJSON line layer (`line-color` from a per-feature `color`) and the view fits their bounds; the thumbnail is non-interactive, the home and overlay maps are interactive, and only the interactive ones get stacked +/− zoom buttons (bottom-right, above the attribution, disabled at the min/max zoom). The map takes route geometry (`LngLat[]` from the trip's `routes/` files), not GPX files; GPX stays an export format. The browser mock has no route geometry (the SVG wavy lines were removed); real trips come with the backend. Paint colours are hex because MapLibre can't read CSS variables or oklch. Three gotchas: (1) maplibre-gl 6 ships its worker as a separate file, so Vite needs `setWorkerUrl(workerUrl)` with `maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url`, or tiles are fetched but never drawn. (2) `maplibre-gl.css` sets `position: relative` on the container and is unlayered, so it beats Tailwind v4's layered utilities; the container is sized with `size-full`, never `absolute inset-0`. (3) Before any route loads the camera starts on Paris (`[2.3522, 48.8566]`, zoom 10, the home place), then fits the routes. MapLibre "Image ... could not be loaded" errors (a style naming a missing sprite icon) are ignored, not treated as offline.

**Webview talks to the backend (2026-11-12, pending user review).**

- **Client:** `webview/api.ts` is a tRPC client (`@trpc/client` + `@trpc/tanstack-react-query`) typed by a type-only import of `AppRouter` from `core/server/app-router`, over `<url>/api/file` with the bearer token. Components keep TanStack Query; `invalidateTrip` (trip, list, route and chat keys) runs after a mutation and after a finished chat turn (§3 refresh model). The mock api bodies are gone; `fixtures/trips.ts` stays as test data only.
- **Chat:** `useChat` from `@ai-sdk/react` (4.0.166, the release built on the pinned `ai` 7.0.162) with a transport that POSTs only `{tripId, text}` to `/api/chat`; the server owns the transcript. History comes from `chats.messages`, the live turn from `useChat`; live messages are cleared after the invalidation lands, so nothing shows twice. Text is streamed; each tool call is one muted line (running / ✓ / ✗), for stored history too.
- **Pending:** `data-pending` (live) or the last unanswered `ask_user` / `export_trip` call (stored, so it survives a reload) renders the question with option buttons, or yes/no for the export. The answer is the next send. Hidden while a turn runs; the input is disabled while a turn runs (the server answers 409 otherwise).
- **Home:** creates the trip (`trips.create`), then navigates to `/trips/$tripId?first=<text>`; the trip view sends it once and clears the param.
- **Backend address:** production/Electrobun sets `globalThis.__GPX_BACKEND__ = { url, token }` in a preload before the bundle loads, or calls the exported `setBackend`. Dev only (`import.meta.env.DEV`, removed from builds): `?api=<url>&token=<token>` is read once into `sessionStorage` and stripped from the URL; `bun run serve` prints that ready link. A dev exception to §3.1.
- **Place search:** a debounced (400 ms, ≥3 chars) box at the map's top-left calls `places.search`; picking a result `flyTo`s it, zoom chosen by OSM kind (`flyTarget` in `map-geo.ts`). No marker, no trip change.
- **Map:** one line per routed stage from `trips.route` (home: every trip's stages; trip view: its own).

**Elevation profile (2026-11-13, pending user review).**

- **Chart:** shadcn `chart` (a wrapper over `recharts`, pinned 3.10.1), shown only under the expanded map. A `Trip | Day 1 | Day 2…` selector (local component state) switches between the whole trip and one stage.
- **Pure module:** `webview/components/profile-geo.ts` (no MapLibre, no DOM). `profileSamples(stages, stageId?)` returns `{distanceKm, elevationM, point}[]` (distance accumulates across stages; one day restarts at 0). `pointAtDistance(samples, km)` interpolates between samples and clamps at both ends. Distance uses `haversineM` from core.
- **Hover:** the chart reports the hovered distance, `pointAtDistance` turns it into a map point, and `MapView` draws it as a marker (`marker` prop). The hover point is state of `ExpandedMap`, not `TripView`, so hovering re-renders only the map and chart, not the chat.
- **Missing elevation:** samples with a non-finite elevation are dropped; with fewer than two samples the chart shows "No elevation data". The route still draws.

**Slope colours (2026-11-14, pending user review).**

- **Bands:** grade is measured over 100 m centred on each sample (never across a stage joint; clamped at a stage's ends; sparse samples widen the window to their neighbours). A segment takes the mean grade of its two ends. Five bands: above +8% red, +3 to +8% orange, −3 to +3% neutral, −8 to −3% light blue, below −8% blue. Exactly ±3% and ±8% belong to the steeper band. Colours are hex (`BAND_COLORS`) because MapLibre can't read CSS variables or oklch.
- **Pure module:** `profile-geo.ts` gains `bandOf`, `gradePct(samples, i)`, `profileBands(samples)` (spans for the chart) and `slopeSegments(stages)` (band-coloured lines for the map); `ProfileSample` now carries its `stageId`. `map-geo.ts`'s `slopeRoutes` replaces `stageRoutes`: one `MapRoute` per band segment, coloured by band, so the existing GeoJSON layer is unchanged. The home thumbnails are coloured too.
- **Profile:** the area fill is a hard-stop linear gradient from `profileBands`, with a five-swatch legend under the chart. The map always shows every stage; the day selector only changes the chart.
- **Missing elevation:** a stage with no usable elevation is drawn as one neutral line. A single point without elevation inside a stage is skipped and bridged by a chord (known shortcut).
