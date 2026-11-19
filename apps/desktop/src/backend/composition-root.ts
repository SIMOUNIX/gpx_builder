import {
  createEnvSecrets,
  createOrsRouter,
  createOverpassPois,
  createPhotonGeocoder,
} from "@gpx-builder/adapters";
import {
  createStrongModel,
  providerFromEnv,
  toolCallingSelfTest,
} from "@gpx-builder/agent";
import {
  createChatStore,
  createDiskCache,
  createTripStore,
  resolveDirs,
} from "@gpx-builder/store";
import type { ServerDeps } from "./server";

/** Composition root: wires the same packages as apps/cli. Throws on missing configuration. */
export async function compose(): Promise<ServerDeps> {
  const dirs = resolveDirs();
  const secrets = createEnvSecrets(); // ponytail: keychain SecretsPort comes with Electrobun
  const orsKey = await secrets.get("ORS_API_KEY");
  if (!orsKey) throw new Error("missing ORS_API_KEY (set in .env)");
  const provider = providerFromEnv(process.env); // ponytail: settings.json replaces the env var
  if (!provider.ok) throw new Error(provider.error.message);
  const model = await createStrongModel(secrets, provider.value);
  if (!model.ok) throw new Error(model.error.message);
  const selfTest = await toolCallingSelfTest(model.value);
  if (!selfTest.ok)
    console.warn(
      `warning: ${provider.value} tool-calling self-test failed: ${selfTest.error.message}`,
    );

  const cache = createDiskCache({ cacheDir: dirs.cacheDir });
  return {
    trips: createTripStore({ tripsDir: dirs.tripsDir }),
    chats: createChatStore({ dataDir: dirs.dataDir }),
    geocode: createPhotonGeocoder({ cache }),
    routing: createOrsRouter({ apiKey: orsKey, cache }),
    pois: createOverpassPois(),
    model: model.value,
  };
}
