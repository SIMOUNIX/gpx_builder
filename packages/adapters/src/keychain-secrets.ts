import type { SecretsPort } from "@gpx-builder/core/server";

/** The slice of `Bun.secrets` we use. Experimental API: nothing else imports it. */
export type KeychainBackend = Pick<
  typeof Bun.secrets,
  "get" | "set" | "delete"
>;

export type WritableSecrets = SecretsPort & {
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
};

/**
 * OS keychain through `Bun.secrets` (`persist: "local"`: no roaming on Windows),
 * cached in memory after the first read. Backend errors propagate; the chain
 * in secrets.ts decides what an unavailable keychain means.
 */
export const createKeychainSecrets = ({
  service = "gpx-builder",
  backend = Bun.secrets,
}: { service?: string; backend?: KeychainBackend } = {}): WritableSecrets => {
  const cache = new Map<string, string>();
  return {
    async get(name) {
      const hit = cache.get(name);
      if (hit !== undefined) return hit;
      const value = await backend.get({ service, name });
      if (!value) return undefined; // misses are not cached: a key may be added later
      cache.set(name, value);
      return value;
    },
    async set(name, value) {
      await backend.set({ service, name, value, persist: "local" });
      cache.set(name, value);
    },
    async delete(name) {
      await backend.delete({ service, name });
      cache.delete(name);
    },
  };
};
