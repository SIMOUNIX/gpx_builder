import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import {
  err,
  ok,
  type Result,
  type SecretsPort,
} from "@gpx-builder/core/server";

/** The planner's model. Hardcoded on purpose for now; changing it is a one-line edit. */
export const STRONG_MODEL_ID = "claude-sonnet-5-5";

export async function createStrongModel(
  secrets: SecretsPort,
): Promise<Result<LanguageModel, { message: string }>> {
  const apiKey = await secrets.get("ANTHROPIC_API_KEY");
  if (!apiKey) return err({ message: "ANTHROPIC_API_KEY is not set" });
  return ok(createAnthropic({ apiKey })(STRONG_MODEL_ID));
}
