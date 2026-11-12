import { createAnthropic } from "@ai-sdk/anthropic";
import { createMistral } from "@ai-sdk/mistral";
import type { LanguageModel } from "ai";
import {
  err,
  ok,
  type Result,
  type SecretsPort,
} from "@gpx-builder/core/server";

/** The planner's models. Hardcoded on purpose for now; changing one is a one-line edit. */
export const STRONG_MODEL_ID = "claude-sonnet-5-5";
export const MISTRAL_STRONG_MODEL_ID = "mistral-medium-latest";

export type Provider = "anthropic" | "mistral";

const KEYS: Record<Provider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  mistral: "MISTRAL_API_KEY",
};

/** The secret holding the API key of a provider. */
export const providerKey = (provider: Provider): string => KEYS[provider];

/** `GPX_BUILDER_PROVIDER`: unset means anthropic; anything unknown is an error, not a silent default. */
export function providerFromEnv(
  env: Record<string, string | undefined>,
): Result<Provider, { message: string }> {
  const v = env.GPX_BUILDER_PROVIDER;
  if (!v) return ok("anthropic");
  return v === "anthropic" || v === "mistral"
    ? ok(v)
    : err({
        message: `GPX_BUILDER_PROVIDER must be anthropic or mistral, got "${v}"`,
      });
}

export async function createStrongModel(
  secrets: SecretsPort,
  provider: Provider = "anthropic",
): Promise<Result<LanguageModel, { message: string }>> {
  const apiKey = await secrets.get(KEYS[provider]);
  if (!apiKey) return err({ message: `${KEYS[provider]} is not set` });
  return ok(
    provider === "mistral"
      ? createMistral({ apiKey })(MISTRAL_STRONG_MODEL_ID)
      : createAnthropic({ apiKey })(STRONG_MODEL_ID),
  );
}
