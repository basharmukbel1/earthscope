// Self-contained dev harness for the Earth engine (not part of the app build).
// Run from the project root:
//   npx vite --config src/components/earth/__dev__/vite.config.mjs --port 5179
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = fileURLToPath(new URL("../../../../", import.meta.url));

export default defineConfig({
  root: here,
  publicDir: projectRoot + "public",
  plugins: [react()],
  resolve: { alias: { "@": projectRoot + "src" } },
  server: { fs: { allow: [projectRoot] }, strictPort: true },
  clearScreen: false,
});
