import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Встраивается в Bitrix24 placement (iframe) — см. docs/bitrix24-integration.md §4.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: process.env.VITE_API_URL || "http://localhost:3001", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
