import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src/webview") } },
  root: "src/webview",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../../dist", emptyOutDir: true },
});
