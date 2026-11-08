import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileSecrets } from "./file-secrets";
import {
  createKeychainSecrets,
  type KeychainBackend,
} from "./keychain-secrets";
import { createSecrets } from "./secrets";

/** In-memory stand-in for Bun.secrets: the real keychain is never touched. */
function fakeBackend(fail?: string) {
  const store = new Map<string, string>();
  const calls = { get: 0 };
  const backend = {
    get: async ({ service, name }) => {
      calls.get++;
      if (fail) throw new Error(fail);
      return store.get(`${service}/${name}`) ?? null;
    },
    set: async ({ service, name, value }) => {
      if (fail) throw new Error(fail);
      store.set(`${service}/${name}`, value);
    },
    delete: async ({ service, name }) => store.delete(`${service}/${name}`),
  } satisfies KeychainBackend;
  return { backend, store, calls };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "secrets-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("keychain: reads through the service name and caches hits", async () => {
  const { backend, store, calls } = fakeBackend();
  store.set("gpx-builder/ORS_API_KEY", "k1");
  const secrets = createKeychainSecrets({ backend });
  expect(await secrets.get("ORS_API_KEY")).toBe("k1");
  expect(await secrets.get("ORS_API_KEY")).toBe("k1");
  expect(calls.get).toBe(1);
});

test("keychain: a miss is undefined and not cached", async () => {
  const { backend, store, calls } = fakeBackend();
  const secrets = createKeychainSecrets({ backend });
  expect(await secrets.get("X")).toBeUndefined();
  store.set("gpx-builder/X", "v");
  expect(await secrets.get("X")).toBe("v");
  expect(calls.get).toBe(2);
});

test("keychain: set and delete update the backend and the cache", async () => {
  const { backend, store } = fakeBackend();
  const secrets = createKeychainSecrets({ backend });
  await secrets.set("X", "v");
  expect(store.get("gpx-builder/X")).toBe("v");
  await secrets.delete("X");
  expect(await secrets.get("X")).toBeUndefined();
});

test("key file: round-trips with mode 0600", async () => {
  const path = join(dir, "secrets.json");
  const secrets = createFileSecrets(path);
  await secrets.set("A", "1");
  await secrets.set("B", "2");
  await secrets.delete("A");
  expect(await secrets.get("A")).toBeUndefined();
  expect(await secrets.get("B")).toBe("2");
  expect(statSync(path).mode & 0o777).toBe(0o600);
});

test.skipIf(process.platform === "win32")(
  "key file: refuses a file others can read",
  async () => {
    const path = join(dir, "secrets.json");
    writeFileSync(path, '{"A":"1"}');
    chmodSync(path, 0o644);
    expect(createFileSecrets(path).get("A")).rejects.toThrow("owner only");
  },
);

test("chain: env wins over key file, key file over keychain", async () => {
  const { backend, store } = fakeBackend();
  store.set("gpx-builder/A", "keychain");
  store.set("gpx-builder/B", "keychain");
  store.set("gpx-builder/C", "keychain");
  const keyFilePath = join(dir, "secrets.json");
  const file = createFileSecrets(keyFilePath);
  await file.set("A", "file");
  await file.set("B", "file");
  const secrets = createSecrets({ backend, keyFilePath, env: { A: "env" } });
  expect(await secrets.get("A")).toBe("env");
  expect(await secrets.get("B")).toBe("file");
  expect(await secrets.get("C")).toBe("keychain");
});

test("chain: a failing keychain is skipped and reported once", async () => {
  const { backend, calls } = fakeBackend("no Secret Service");
  const secrets = createSecrets({ backend, env: { A: "env" } });
  expect(secrets.keychainStatus()).toEqual({ available: true });
  expect(await secrets.get("A")).toBe("env");
  expect(calls.get).toBe(0);
  expect(await secrets.get("B")).toBeUndefined();
  expect(await secrets.get("B")).toBeUndefined();
  expect(calls.get).toBe(1);
  expect(secrets.keychainStatus()).toEqual({
    available: false,
    reason: "no Secret Service",
  });
});

test("chain: set goes to the key file when opted in, else the keychain", async () => {
  const { backend, store } = fakeBackend();
  const keyFilePath = join(dir, "secrets.json");
  await createSecrets({ backend, keyFilePath, env: {} }).set("A", "1");
  expect(store.size).toBe(0);
  expect(await createFileSecrets(keyFilePath).get("A")).toBe("1");
  await createSecrets({ backend, env: {} }).set("B", "2");
  expect(store.get("gpx-builder/B")).toBe("2");
});

test("chain: set with a failing keychain throws instead of losing the key", () => {
  const { backend } = fakeBackend("locked");
  expect(createSecrets({ backend, env: {} }).set("A", "1")).rejects.toThrow(
    "locked",
  );
});
