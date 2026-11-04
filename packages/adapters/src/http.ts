import {
  err,
  ok,
  type AdapterError,
  type Result,
} from "@gpx-builder/core/server";

// FIXME: add repository when repo is public
export const USER_AGENT = "gpx-builder";

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export type HttpOptions = {
  fetch?: FetchFn;
  timeoutMs?: number;
  /** Extra attempts after the first, for 5xx and network failures only. */
  retries?: number;
  /** Injected so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
};

/** A provider can recognise its own error bodies before the generic status mapping. */
export type Classify = (
  status: number,
  body: unknown,
) => AdapterError | undefined;

const statusError = (status: number, message: string): AdapterError => {
  if (status === 429) return { kind: "rate-limit", message };
  if (status === 404) return { kind: "not-found", message };
  if (status >= 500) return { kind: "unavailable", message };
  if (status === 401 || status === 403) return { kind: "unavailable", message };
  return { kind: "invalid", message };
};

/**
 * One JSON request with a timeout, a few retries and every failure turned into
 * an AdapterError. 4xx is never retried: asking again won't change the answer.
 */
export async function requestJson(
  url: string,
  init: RequestInit,
  opts: HttpOptions & { classify?: Classify } = {},
): Promise<Result<unknown>> {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const retries = opts.retries ?? 2;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const headers = { "User-Agent": USER_AGENT, ...init.headers };

  let last: AdapterError = { kind: "unavailable", message: "no attempt made" };
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1));
    let res: Response;
    try {
      res = await doFetch(url, {
        ...init,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (e instanceof Error && e.name === "TimeoutError") {
        return err({
          kind: "timeout",
          message: `no answer in ${timeoutMs} ms`,
        });
      }
      last = {
        kind: "unavailable",
        message: e instanceof Error ? e.message : String(e),
      };
      continue;
    }

    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }

    if (res.ok) {
      return body === undefined
        ? err({ kind: "unavailable", message: "response is not JSON" })
        : ok(body);
    }

    // TODO: explain
    const retryAfter = Number(res.headers.get("retry-after"));
    const known =
      opts.classify?.(res.status, body) ??
      statusError(res.status, `HTTP ${res.status}`);
    last =
      Number.isFinite(retryAfter) && res.headers.has("retry-after")
        ? { ...known, retryAfterSec: retryAfter }
        : known;
    if (res.status < 500) return err(last);
  }
  return err(last);
}
