import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Optional language-model backend on :8787 (contract: docs/API_CONTRACTS.md §3). Enable with VITE_AI_ENDPOINT=/api/interpret.
  server: { proxy: { "/api": { target: "http://localhost:8787", changeOrigin: true } } },
  preview: { proxy: { "/api": { target: "http://localhost:8787", changeOrigin: true } } },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/three")) return "three";
          if (id.includes("node_modules/d3-") || id.includes("topojson")) return "d3";
          if (id.includes("node_modules/motion") || id.includes("framer-motion")) return "motion";
          if (id.includes("node_modules/react") || id.includes("react-router") || id.includes("scheduler")) return "react";
        },
      },
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
} as never);
