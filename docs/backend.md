# Backend guide

How the desktop backend (`apps/desktop/src/backend`) works, from a request arriving to the LLM answering. The decisions behind it are in `architecture.md` (§3, §3.1, §20).

## The big picture

```
Webview ── HTTP ──▶ server.ts  (Bun.serve on 127.0.0.1:<random port>)
                      │  1. the gate: Host, Origin, token
                      ├─ /ping        → { ok: true }
                      ├─ /api/file/*  → tRPC router      (trips, files, transcript reads)
                      └─ /api/chat    → api-chat.ts         (runs the agent, streams the answer)
```

Two kinds of work, kept apart:

|               | Core (files)                                                    | AI (LLM)                            |
| ------------- | --------------------------------------------------------------- | ----------------------------------- |
| Route         | `/api/file/*`                                                   | `/api/chat`                         |
| Transport     | request → JSON response                                         | request → Server-Sent Events stream |
| Code          | `core/server/routers/file-router.ts` (+ `chat-router.ts` reads) | `backend/api-chat.ts` → `runTurn`   |
| Talks to LLM? | never                                                           | yes, with tools                     |

## Files

```
packages/core/src/server/
  app-router.ts         createAppRouter(deps) + the AppRouter type (what the webview imports)
  routers/
    base.ts             shared: initTRPC, AppRouterDeps, input schema, store-error → tRPC error
    file-router.ts      trips.list / get / create / route / export
    chat-router.ts      chats.messages (the transcript)
    place-router.ts     places.search (geocoder for the map's search box)
apps/desktop/src/backend/
  server.ts             Bun.serve + the gate + dispatch by path
  api-chat.ts           /api/chat: one agent turn, streamed
  composition-root.ts   builds stores, ports, model
  serve.ts              headless dev entry (`bun run serve`)
  server.test.ts        tests
```

This follows the [tRPC Bun example](https://github.com/trpc/trpc/tree/main/examples/bun): `Bun.serve` calls `fetchRequestHandler`, and an `appRouter` is built from sub-routers. Ours merges two with `t.mergeRouters`, so paths stay flat (`trips.list`, not `core.trips.list`).

## Why the router lives in `core`

`AppRouter` is a **type** the webview uses to get end-to-end types. If the router lived in the backend, the webview would have to import backend code. So the router is in `core`, and it receives its dependencies (`trips`, `chats` ports) as arguments (`createAppRouter({ trips, chats })`). `core` imports nothing from the other packages; the backend injects the real disk stores. The webview writes `import type { AppRouter } from "@gpx-builder/core/server/app-router"`, and ESLint allows that one import and nothing else from `core/server`.

## 1. The gate (every request, `server.ts`)

In order:

1. **Host** must be exactly `127.0.0.1:<port>`. Blocks DNS rebinding.
2. **Origin**: if present, must be on the allowlist (`null` always fails). If absent, only safe methods (GET/HEAD/OPTIONS) pass. Blocks other browser tabs.
3. `OPTIONS` (CORS preflight) is answered here, without a token, because browsers never send one on preflight.
4. **Token**: `Authorization: Bearer <random per-launch token>`, compared in constant time. Blocks other local processes.

Responses get `Access-Control-Allow-Origin` set to the one allowed origin, never `*`.

## 2. tRPC (core work)

`fetchRequestHandler` from `@trpc/server/adapters/fetch` takes a web `Request` and returns a `Response`, which is exactly what `Bun.serve` gives and expects.

| Procedure        | Kind     | Does                                                                                   |
| ---------------- | -------- | -------------------------------------------------------------------------------------- |
| `trips.list`     | query    | all readable trips, newest first                                                       |
| `trips.get`      | query    | one trip (`NOT_FOUND` if missing)                                                      |
| `trips.create`   | mutation | empty "Untitled trip" with `chatId = chat_<trip uuid>`                                 |
| `trips.route`    | query    | `{stageId, line}[]` for each routed stage                                              |
| `trips.export`   | mutation | writes the GPX files, returns the paths (`PRECONDITION_FAILED` if a stage is unrouted) |
| `chats.messages` | query    | the stored transcript (`[]` before the first message)                                  |
| `places.search`  | query    | `{query}` → geocoder candidates; a geocoder failure is a tRPC error. Saves nothing     |

Each procedure calls a store **port** and returns plain JSON. Store errors become tRPC errors in `routers/base.ts` (`not-found` → `NOT_FOUND`).

## 3. The chat (AI work, `api-chat.ts`)

Request: `POST /api/chat` with `{ tripId, text }`. `text` is either a new message or the answer to the question the agent is waiting on.

`runTurn` (package `agent`) does this:

1. **Saves the input** to `chats/<chatId>.jsonl`. If the last assistant message has an unanswered `ask_user`, the text becomes that call's result instead of a new message.
2. **Builds the agent fresh**: system prompt for the trip's phase (brief / plan / refine) plus a digest of `trip.json`. The trip is the truth, not the transcript.
3. **Loops** (AI SDK `ToolLoopAgent`): the model answers with text and/or tool calls.
   - **Server tools** (`find_place`, `route`, `submit_brief`, `submit_itinerary`) have an `execute`. The SDK runs them and feeds the result back to the model. They are bound to the trip, and the model only sees ids, never coordinates.
   - **Client tools** (`ask_user`, `export_trip`) have no `execute`. The loop stops and the call stays pending, because only the human can answer.
   - Every finished step is written to the JSONL straight away, so a pending question survives a restart.
4. Stops when the model stops, after 20 model calls, or when a tool has failed 3 times (that tool is then removed for the turn).

`api-chat.ts` turns `runTurn`'s hooks into stream chunks (AI SDK UIMessage format, over SSE):

| Happens                                  | Chunk                                   |
| ---------------------------------------- | --------------------------------------- |
| turn begins                              | `start`                                 |
| model text                               | `text-start`, `text-delta`…, `text-end` |
| tool called                              | `tool-input-available`                  |
| tool finished                            | `tool-output-available` (`{ ok }` only) |
| turn ended on `ask_user` / `export_trip` | `data-pending` with the question        |
| model or store failure                   | `error`                                 |
| end                                      | `finish`                                |

A second request for a trip that already has a turn running gets `409`.

### A full example

```
POST {tripId, text: "plan a hike"}
   model: "Let me ask." + ask_user("How many days?")   ← server stops the loop
   stream: text… tool-input-available, data-pending {question}
   (webview shows a question card)

POST {tripId, text: "2"}
   runTurn: "2" becomes the ask_user result
   model: "Two days then."  → text… finish
```

Nothing is held in memory between the two requests. The file on disk is the state.

## Failure handling

- **Stuck turns:** `runTurn` gives the model stream a total limit of 5 min, 60 s without a chunk, and 90 s per tool. On expiry the turn ends with an error chunk and the per-trip lock is released.
- **Quiet streams:** Bun closes a connection silent for 10 s, so `/api/chat` sends a transient `data-ping` every 5 s.
- **Errors:** tRPC errors carry no stack trace (`isDev: false`), and Bun's error page is off (`development: false`).
- **Chat input:** text is trimmed and must not be empty. A trip whose `trip.json` is damaged answers 500 with the store message, not 404.
- **Startup:** `startServer` refuses a token shorter than 32 characters, and `serve.ts` takes the single-instance lock, so two servers never write the same stores.

## Testing and running

```sh
bun test apps/desktop                      # gate, tRPC round trip, chat stream with a fake model
bun run serve           # needs ANTHROPIC_API_KEY and ORS_API_KEY in .env; prints url and token
curl -H "Authorization: Bearer <token>" http://127.0.0.1:<port>/ping
```

Tests use `scriptedModel` (`packages/agent/src/test-util.ts`), a fake LLM that plays a script, one entry per model step. `startServer({ token, allowedOrigins, deps, port? })` takes everything as arguments, so a test can start a server on a random port without Electrobun.

## Adding things

- **A new CRUD procedure**: add it to `routers/file-router.ts`, using a port. If it needs a new port, add it to `AppRouterDeps` and inject it in `composition-root.ts`.
- **A new agent tool**: in `packages/agent/src/tools`; the server needs no change.
- **A new HTTP route** (not tRPC): a handler file like `api-chat.ts`, one `else if` in `server.ts`.
