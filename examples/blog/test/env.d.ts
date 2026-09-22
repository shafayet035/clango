/// <reference types="@cloudflare/vitest-plugin/types" />

import type { D1Migration } from "@cloudflare/vitest-plugin";

declare global {
  interface Env {
    /** Migrations read from disk by `vitest.config.ts`. */
    TEST_MIGRATIONS: D1Migration[];
    /** Set in tests so the development identity adapter trusts the `x-dev-user` header. */
    ALLOW_DEV_AUTH: string;
    R2_ACCOUNT_ID: string;
    R2_ACCESS_KEY_ID: string;
    R2_SECRET_ACCESS_KEY: string;
  }

  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
      ALLOW_DEV_AUTH: string;
      R2_ACCOUNT_ID: string;
      R2_ACCESS_KEY_ID: string;
      R2_SECRET_ACCESS_KEY: string;
    }
  }
}
