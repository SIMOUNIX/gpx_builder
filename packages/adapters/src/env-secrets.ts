import type { SecretsPort } from "@gpx-builder/core/server";

/** Reads secrets from the environment (Bun loads `.env` into it). An empty value counts as unset. */
export const createEnvSecrets = (
  env: Record<string, string | undefined> = process.env,
): SecretsPort => ({
  get: async (name) => env[name] || undefined,
});
