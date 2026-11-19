import { expect, test } from "bun:test";
import { parseTheme, resolveTheme } from "./theme";

test("parseTheme keeps known values and falls back to system", () => {
  for (const t of ["light", "system", "dark"] as const)
    expect(parseTheme(t)).toBe(t);
  for (const bad of [null, "", "Dark", "auto"])
    expect(parseTheme(bad)).toBe("system");
});

test("resolveTheme follows the OS only for system", () => {
  expect(resolveTheme("system", true)).toBe("dark");
  expect(resolveTheme("system", false)).toBe("light");
  expect(resolveTheme("light", true)).toBe("light");
  expect(resolveTheme("dark", false)).toBe("dark");
});
