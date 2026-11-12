import { expect, test } from "bun:test";
import {
  getBackend,
  parseDevBackend,
  readDevBackend,
  setBackend,
} from "./backend";

test("parseDevBackend reads the query, else the stored value", () => {
  const b = { url: "http://127.0.0.1:1234", token: "abc" };
  expect(parseDevBackend("?api=http://127.0.0.1:1234&token=abc", null)).toEqual(
    b,
  );
  expect(parseDevBackend("", JSON.stringify(b))).toEqual(b);
  expect(parseDevBackend("?api=x", null)).toBeUndefined();
  expect(parseDevBackend("", "not json")).toBeUndefined();
  expect(parseDevBackend("", '{"url":"u"}')).toBeUndefined();
});

test("readDevBackend stores the pair and strips only api and token", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  const dev = readDevBackend(
    "http://localhost:5173/trips/x?first=hi&api=http://127.0.0.1:1&token=abc",
    storage,
  );
  expect(dev).toEqual({
    backend: { url: "http://127.0.0.1:1", token: "abc" },
    cleanUrl: "http://localhost:5173/trips/x?first=hi",
  });
  // A reload without the params falls back to the stored pair.
  expect(readDevBackend("http://localhost:5173/", storage)?.backend).toEqual(
    dev?.backend,
  );
  expect(
    readDevBackend("http://localhost:5173/", {
      getItem: () => null,
      setItem: () => {},
    }),
  ).toBeUndefined();
});

test("getBackend returns what setBackend set", () => {
  setBackend({ url: "http://127.0.0.1:2", token: "t" });
  expect(getBackend()).toEqual({ url: "http://127.0.0.1:2", token: "t" });
});

test("getBackend in dev takes the link's pair and strips it from the URL", () => {
  const g = globalThis as Record<string, unknown>;
  const env = import.meta.env as Record<string, unknown>;
  const saved = {
    location: g.location,
    sessionStorage: g.sessionStorage,
    history: g.history,
    dev: env.DEV,
  };
  let replaced: unknown;
  g.location = {
    href: "http://localhost:5173/?first=hi&api=http://127.0.0.1:3&token=zz",
  };
  g.sessionStorage = { getItem: () => null, setItem: () => {} };
  g.history = {
    replaceState: (_a: unknown, _b: unknown, url: unknown) => (replaced = url),
  };
  env.DEV = true;
  setBackend(undefined);
  try {
    expect(getBackend()).toEqual({ url: "http://127.0.0.1:3", token: "zz" });
    expect(replaced).toBe("http://localhost:5173/?first=hi");
    setBackend(undefined);
    g.location = { href: "http://localhost:5173/" };
    expect(() => getBackend()).toThrow("no backend");
  } finally {
    Object.assign(g, saved);
    env.DEV = saved.dev;
    setBackend(undefined);
  }
});
