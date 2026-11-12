import { expect, test } from "bun:test";
import {
  createStrongModel,
  MISTRAL_STRONG_MODEL_ID,
  providerFromEnv,
  STRONG_MODEL_ID,
} from "./models";
import { toolCallingSelfTest } from "./self-test";
import { scriptedModel } from "./test-util";

const modelId = (r: { ok: boolean; value?: unknown }) =>
  (r.value as { modelId: string }).modelId;

test("provider comes from the env: anthropic by default, unknown is an error", () => {
  expect(providerFromEnv({})).toEqual({ ok: true, value: "anthropic" });
  expect(providerFromEnv({ GPX_BUILDER_PROVIDER: "mistral" })).toEqual({
    ok: true,
    value: "mistral",
  });
  const bad = providerFromEnv({ GPX_BUILDER_PROVIDER: "foo" });
  expect(!bad.ok && bad.error.message).toContain('"foo"');
});

test("the provider picks the model; each needs its own key", async () => {
  const keys: Record<string, string> = { MISTRAL_API_KEY: "k" };
  const secrets = { get: async (n: string) => keys[n] };
  expect(modelId(await createStrongModel(secrets, "mistral"))).toBe(
    MISTRAL_STRONG_MODEL_ID,
  );
  expect(await createStrongModel(secrets)).toEqual({
    ok: false,
    error: { message: "ANTHROPIC_API_KEY is not set" },
  });
  keys.ANTHROPIC_API_KEY = "k";
  expect(modelId(await createStrongModel(secrets))).toBe(STRONG_MODEL_ID);
  expect(
    await createStrongModel({ get: async () => undefined }, "mistral"),
  ).toEqual({
    ok: false,
    error: { message: "MISTRAL_API_KEY is not set" },
  });
});

test("self-test passes a model that calls the tool and warns on one that does not", async () => {
  const good = scriptedModel([
    { calls: [{ name: "ping", input: { word: "ok" } }] },
  ]);
  expect(await toolCallingSelfTest(good)).toEqual({
    ok: true,
    value: undefined,
  });
  const bad = await toolCallingSelfTest(scriptedModel([{ text: "pong" }]));
  expect(!bad.ok && bad.error.message).toContain("tool call");
  const down = await toolCallingSelfTest(scriptedModel([{ fail: "boom" }]));
  expect(!down.ok && down.error.message).toContain("boom");
});
