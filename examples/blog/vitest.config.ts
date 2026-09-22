import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./migrations/DB_MAIN"),
          // The example's dev identity adapter only trusts the x-dev-user header when this is set.
          ALLOW_DEV_AUTH: "true",
        },
      },
    })),
  ],
});
