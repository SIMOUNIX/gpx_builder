import { expect, test } from "bun:test";
import { z } from "zod";
import { failAdapter, failIssues, failStore, issuesOf } from "./results";

test("issuesOf turns zod issues into path + message", () => {
  const r = z.object({ a: z.object({ b: z.string() }) }).safeParse({ a: {} });
  expect(r.success).toBe(false);
  expect(issuesOf(r.error!)).toEqual([
    { path: "a.b", message: expect.any(String) },
  ]);
});

test("failures carry issues or a kind-prefixed error", () => {
  expect(failIssues([{ path: "x", message: "bad" }])).toEqual({
    ok: false,
    issues: [{ path: "x", message: "bad" }],
  });
  expect(failStore({ kind: "corrupt", message: "m" }).error).toBe("corrupt: m");
  expect(failAdapter({ kind: "timeout", message: "t" }).error).toBe(
    "timeout: t",
  );
});
