import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  define: {
    // Default the displayed app version to the package version so release
    // builds don't fall back to the hardcoded "0.1.0"; an explicit env var
    // still wins.
    "import.meta.env.VITE_PROOF_HELPER_APP_VERSION": JSON.stringify(
      process.env.VITE_PROOF_HELPER_APP_VERSION ?? pkg.version,
    ),
  },
  build: {
    target: "es2022",
    minify: false,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts",
  },
});
