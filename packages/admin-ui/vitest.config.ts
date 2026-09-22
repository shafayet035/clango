import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Only pure modules are tested here: the Workers pool has no DOM, so React components are covered
// by `vite build` and by the routing tests in the blog example.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
});
