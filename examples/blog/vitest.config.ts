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
          // Pre-signed uploads need an S3 API token; these stand in for the real secrets.
          R2_ACCOUNT_ID: "testaccount",
          R2_ACCESS_KEY_ID: "testkey",
          R2_SECRET_ACCESS_KEY: "testsecret",
        },
      },
    })),
  ],
});
