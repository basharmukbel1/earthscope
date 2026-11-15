// Dev-only Vite config for the chart QA gallery.
// Run from the project root:  npx vite --config src/components/charts/__dev__/vite.gallery.config.mjs --port 5178
// then open http://localhost:5178/__dev__/index.html
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

const chartsDir = fileURLToPath(new URL("..", import.meta.url));
const srcDir = fileURLToPath(new URL("../../..", import.meta.url));
const projectDir = fileURLToPath(new URL("../../../..", import.meta.url));

export default defineConfig({
  root: chartsDir,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": srcDir } },
  // Own optimizer cache so this harness never invalidates the app's dev server cache.
  cacheDir: `${projectDir}node_modules/.vite-chart-gallery`,
  optimizeDeps: {
    include: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom/client", "motion/react", "d3-scale", "d3-shape", "d3-array"],
  },
  server: { port: 5178, strictPort: true, open: false },
  logLevel: "info",
});
