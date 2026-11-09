import { expect, test } from "bun:test";
import { createStrongModel, STRONG_MODEL_ID } from "./models";

test("no API key is an error, a key gives the strong model", async () => {
  const none = await createStrongModel({ get: async () => undefined });
  expect(none).toEqual({
    ok: false,
    error: { message: "ANTHROPIC_API_KEY is not set" },
  });
  const some = await createStrongModel({ get: async () => "k" });
  expect(some.ok && (some.value as { modelId: string }).modelId).toBe(
    STRONG_MODEL_ID,
  );
});
