import { expect, test } from "bun:test";
import { requestJson } from "./http";
import { fakeFetch, json, noWait } from "./helpers.test-util";

test("returns the JSON body and sends a User-Agent", async () => {
  const f = fakeFetch(json({ a: 1 }));
  const r = await requestJson("https://x.test", {}, { fetch: f.fn, ...noWait });
  expect(r).toEqual({ ok: true, value: { a: 1 } });
  expect(new Headers(f.calls[0]!.init.headers).get("user-agent")).toBe(
    "gpx-builder",
  );
});

test("retries 5xx then succeeds", async () => {
  const f = fakeFetch(json({}, 503), json({}, 500), json({ ok: 1 }));
  const r = await requestJson("https://x.test", {}, { fetch: f.fn, ...noWait });
  expect(r.ok).toBe(true);
  expect(f.calls).toHaveLength(3);
});

test("gives up after the retries with unavailable", async () => {
  const f = fakeFetch(json({}, 503), json({}, 503), json({}, 503));
  const r = await requestJson("https://x.test", {}, { fetch: f.fn, ...noWait });
  expect(r).toEqual({
    ok: false,
    error: { kind: "unavailable", message: "HTTP 503" },
  });
});

test("retries a network failure", async () => {
  const f = fakeFetch(new Error("ECONNRESET"), json({ ok: 1 }));
  const r = await requestJson("https://x.test", {}, { fetch: f.fn, ...noWait });
  expect(r.ok).toBe(true);
});

test("never retries a 4xx", async () => {
  const f = fakeFetch(json({}, 400), json({ ok: 1 }));
  const r = await requestJson("https://x.test", {}, { fetch: f.fn, ...noWait });
  expect(r).toMatchObject({ ok: false, error: { kind: "invalid" } });
  expect(f.calls).toHaveLength(1);
});

test("429 is rate-limit and keeps Retry-After", async () => {
  const f = fakeFetch(json({}, 429, { "retry-after": "12" }));
  const r = await requestJson("https://x.test", {}, { fetch: f.fn, ...noWait });
  expect(r).toEqual({
    ok: false,
    error: { kind: "rate-limit", message: "HTTP 429", retryAfterSec: 12 },
  });
});

test("401 and 403 are unavailable, 404 not-found", async () => {
  for (const [status, kind] of [
    [401, "unavailable"],
    [403, "unavailable"],
    [404, "not-found"],
  ] as const) {
    const f = fakeFetch(json({}, status));
    const r = await requestJson("https://x.test", {}, { fetch: f.fn });
    expect(r).toMatchObject({ ok: false, error: { kind } });
  }
});

test("a timeout is reported, not retried", async () => {
  const e = new Error("slow");
  e.name = "TimeoutError";
  const f = fakeFetch(e, json({ ok: 1 }));
  const r = await requestJson("https://x.test", {}, { fetch: f.fn, ...noWait });
  expect(r).toMatchObject({ ok: false, error: { kind: "timeout" } });
  expect(f.calls).toHaveLength(1);
});

test("a non-JSON success is unavailable", async () => {
  const f = fakeFetch(new Response("<html>", { status: 200 }));
  const r = await requestJson("https://x.test", {}, { fetch: f.fn });
  expect(r).toMatchObject({ ok: false, error: { kind: "unavailable" } });
});
