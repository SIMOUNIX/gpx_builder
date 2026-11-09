import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import tseslint from "typescript-eslint";

// Import law: core imports nothing from the repo,
// store/adapters/agent import core only, apps/cli is the composition root.
const others = (self) =>
  ["core", "store", "adapters", "agent"].filter((p) => p !== self);
const zones = ["core", "store", "adapters", "agent"].flatMap((self) =>
  (self === "core" ? others(self) : others(self).filter((p) => p !== "core"))
    .concat("apps")
    .map((from) => ({
      target: `./packages/${self}`,
      from: from === "apps" ? "./apps" : `./packages/${from}`,
    })),
);

// The webview may import core/browser, and the AppRouter type from core/server/app-router.
const webviewZones = [
  { from: "./packages/core/src/server", except: ["./app-router.ts"] },
  { from: "./packages/store" },
  { from: "./packages/adapters" },
  { from: "./packages/agent" },
].map((z) => ({ target: "./apps/desktop/src/webview", ...z }));

export default tseslint.config(
  { ignores: ["node_modules", "apps/desktop/dist"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    plugins: { import: importPlugin },
    settings: {
      "import/resolver": { typescript: { project: "./tsconfig.json" } },
    },
    rules: {
      "import/no-restricted-paths": [
        "error",
        { zones: [...zones, ...webviewZones] },
      ],
    },
  },
);
