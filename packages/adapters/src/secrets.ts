import type { SecretsPort } from "@gpx-builder/core/server";
import { createEnvSecrets } from "./env-secrets";
import { createFileSecrets } from "./file-secrets";
import {
  createKeychainSecrets,
  type KeychainBackend,
  type WritableSecrets,
} from "./keychain-secrets";

export type KeychainStatus = { available: boolean; reason?: string };

export type AppSecrets = WritableSecrets & { keychainStatus(): KeychainStatus };

/**
 * The app's secrets: env var first (explicit override, keeps a dev `.env`
 * working), then the opt-in key file, then the OS keychain. `set`/`delete`
 * go to the key file when it is opted in, else to the keychain. A keychain
 * that throws (Linux without Secret Service) is marked unavailable and
 * skipped; `keychainStatus()` carries the reason for the UI to show.
 */
export const createSecrets = ({
  service,
  backend,
  keyFilePath,
  env = process.env,
}: {
  service?: string;
  backend?: KeychainBackend;
  keyFilePath?: string;
  env?: Record<string, string | undefined>;
} = {}): AppSecrets => {
  const fromEnv: SecretsPort = createEnvSecrets(env);
  const file = keyFilePath ? createFileSecrets(keyFilePath) : undefined;
  const keychain = createKeychainSecrets({ service, backend });
  let status: KeychainStatus = { available: true };

  const viaKeychain = async <T>(
    run: () => Promise<T>,
  ): Promise<T | undefined> => {
    if (!status.available) return undefined;
    try {
      return await run();
    } catch (e) {
      status = { available: false, reason: (e as Error).message };
      return undefined;
    }
  };

  return {
    keychainStatus: () => status,
    async get(name) {
      return (
        (await fromEnv.get(name)) ??
        (await file?.get(name)) ??
        (await viaKeychain(() => keychain.get(name)))
      );
    },
    async set(name, value) {
      if (file) return file.set(name, value);
      await keychain.set(name, value); // throws: the caller must know it was not stored
    },
    async delete(name) {
      if (file) return file.delete(name);
      await keychain.delete(name);
    },
  };
};
