import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src/webview") } },
  root: "src/webview",
  // MapLibre 6 loads its worker by a path relative to its own file, which the dev pre-bundler breaks.
  optimizeDeps: { exclude: ["maplibre-gl"] },
  plugins: [react(), tailwindcss()],
  build: { outDir: "../../dist", emptyOutDir: true },
});
