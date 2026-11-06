import { createHash } from "node:crypto";
import {
  RouteId,
  err,
  mintTripId,
  ok,
  type GeocodeCandidate,
  type GeocodePort,
  type Position3,
  type RoutedStage,
  type RoutingPort,
  type Trip,
  type TripStorePort,
} from "@gpx-builder/core/server";
import type { AgentDeps } from "./deps";

/** In-memory store: the agent only knows the port, never the real one. */
export function memoryTrips(initial: Trip) {
  let trip = initial;
  const routes = new Map<string, Position3[]>();
  const derived: Record<string, string> = {};
  const store: TripStorePort = {
    create: () => ok(undefined),
    list: () =>
      ok([{ id: trip.tripId, name: trip.name, updatedAt: trip.updatedAt }]),
    load: () => ok(trip),
    save: (t) => {
      trip = t;
      return ok(undefined);
    },
    writeRoute: (_id, line) => {
      const id = RouteId.parse(
        `route_${createHash("sha256").update(JSON.stringify(line)).digest("hex").slice(0, 16)}`,
      );
      routes.set(id, line);
      return ok(id);
    },
    readRoute: (_t, id) => {
      const line = routes.get(id);
      return line
        ? ok(line)
        : err({ kind: "not-found", message: `no route ${id}` });
    },
    writeDerived: (_t, files) => {
      Object.assign(derived, files);
      return ok(Object.keys(files).map((n) => `/trip/${n}`));
    },
  };
  return { store, trip: () => trip, derived };
}

export const emptyTrip = (): Trip => ({
  v: 1,
  tripId: mintTripId(),
  name: "Untitled trip",
  createdAt: "2026-11-04T10:00:00.000Z",
  updatedAt: "2026-11-04T10:00:00.000Z",
  brief: {},
  stages: [],
  waypoints: {},
  registry: { places: {}, pois: {} },
});

export const fakeGeocode = (
  candidates: GeocodeCandidate[],
): GeocodePort & { calls: unknown[] } => {
  const calls: unknown[] = [];
  return {
    calls,
    async search(q) {
      calls.push(q);
      return ok(candidates);
    },
  };
};

export const fakeRouting = (
  routed: RoutedStage,
): RoutingPort & { calls: unknown[] } => {
  const calls: unknown[] = [];
  return {
    calls,
    capabilities: { maxWaypoints: 50, profiles: ["foot-hiking"] },
    async route(q) {
      calls.push(q);
      return ok(routed);
    },
  };
};

export const depsFor = (
  trips: ReturnType<typeof memoryTrips>,
  geocode: GeocodePort,
  routing: RoutingPort,
): AgentDeps => ({
  tripId: trips.trip().tripId,
  trips: trips.store,
  geocode,
  routing,
});

/** Calls a tool's `execute` the way the loop would. */
export const run = async <T>(
  t: { execute?: (input: never, options: never) => unknown },
  input: unknown,
): Promise<T> =>
  (await t.execute!(
    input as never,
    { toolCallId: "t1", messages: [] } as never,
  )) as T;

// ---- chat store and scripted model, for planner tests ----

import { MockLanguageModelV4 } from "ai/test";
import {
  type ChatId,
  type ChatMessage,
  type ChatStorePort,
} from "@gpx-builder/core/server";

export function memoryChats(): ChatStorePort & { all: () => ChatMessage[] } {
  const messages: ChatMessage[] = [];
  return {
    append: (_id: ChatId, m) => {
      messages.push(structuredClone(m));
      return ok(undefined);
    },
    load: () =>
      messages.length === 0
        ? err({ kind: "not-found", message: "no chat" })
        : ok(structuredClone(messages)),
    all: () => messages,
  };
}

/** What the fake model says in one step: text, tool calls, or both. */
export type Script = {
  text?: string;
  calls?: { name: string; input: unknown }[];
  fail?: string;
};

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** A model that follows a script, one entry per step, and remembers what it was sent. */
export function scriptedModel(script: Script[]) {
  let i = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const step = script[i++] ?? { text: "(script ended)" };
      if (step.fail) throw new Error(step.fail);
      const parts: unknown[] = [{ type: "stream-start", warnings: [] }];
      if (step.text !== undefined) {
        parts.push(
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: step.text },
          { type: "text-end", id: "t" },
        );
      }
      (step.calls ?? []).forEach((c, n) =>
        parts.push({
          type: "tool-call",
          toolCallId: `call_${i}_${n}`,
          toolName: c.name,
          input: JSON.stringify(c.input),
        }),
      );
      parts.push({
        type: "finish",
        usage,
        finishReason: {
          unified: step.calls?.length ? "tool-calls" : "stop",
          raw: undefined,
        },
      });
      return {
        stream: new ReadableStream({
          start(c) {
            for (const p of parts) c.enqueue(p as never);
            c.close();
          },
        }),
      };
    },
  });
}
