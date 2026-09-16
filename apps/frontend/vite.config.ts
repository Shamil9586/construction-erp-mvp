import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const apiTarget = process.env.VITE_API_URL || "http://localhost:3001";

// Встраивается в Bitrix24 placement (iframe) — см. docs/bitrix24-integration.md §4.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@construction-erp/domain": fileURLToPath(new URL("../../packages/domain/src/index.ts", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
