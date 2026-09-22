import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5174,
    proxy: {
      // `wrangler dev` serves the Worker, which owns the admin API. In production the same Worker
      // serves this app's build output, so there is no proxy at all.
      "/admin/api": { target: "http://localhost:8787", changeOrigin: true },
      "/api": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
});
