import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { WritableSecrets } from "./keychain-secrets";

/**
 * Opt-in key file ({ name: value } JSON, mode 0600) for machines without a
 * keychain. Refuses to read a file other users can access (POSIX only).
 */
export const createFileSecrets = (path: string): WritableSecrets => {
  const read = (): Record<string, string> => {
    if (!existsSync(path)) return {};
    if (process.platform !== "win32" && (statSync(path).mode & 0o077) !== 0)
      throw new Error(`${path} must be readable by its owner only (chmod 600)`);
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  };
  const write = (data: Record<string, string>) => {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    chmodSync(tmp, 0o600); // mode above is masked by umask only downwards, be explicit
    renameSync(tmp, path);
  };
  return {
    get: async (name) => read()[name] || undefined,
    set: async (name, value) => write({ ...read(), [name]: value }),
    delete: async (name) => {
      const data = read();
      delete data[name];
      write(data);
    },
  };
};
