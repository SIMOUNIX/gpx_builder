import type { CachePort } from "@gpx-builder/core/server";
import type { FetchFn } from "./http";

export const memoryCache = (): CachePort & { size: () => number } => {
  const m = new Map<string, string>();
  return {
    get: (k) => m.get(k),
    set: (k, v) => void m.set(k, v),
    size: () => m.size,
  };
};

/** A fetch that answers from a queue and records what it was asked. */
export function fakeFetch(...answers: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn: FetchFn = async (url, init = {}) => {
    calls.push({ url, init });
    const next = answers.shift();
    if (next === undefined) throw new Error("fakeFetch: no answer queued");
    if (next instanceof Error) throw next;
    return next;
  };
  return { fn, calls };
}

export const json = (body: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });

export const noWait = { sleep: async () => {} };
