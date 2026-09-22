import { defineConfig } from "@clango/core";

import blog from "./src/app";
import { devAuthAdapter } from "./src/dev-auth";

export default defineConfig({
  apps: [blog],
  databases: { DB_MAIN: { binding: "DB_MAIN" } },
  admin: { enabled: true },
  // Swapping this for `createBetterAuthAdapter({ ... })` from `@clango/auth-better-auth` is the
  // whole change: authorization data stays in Clango's tables either way.
  auth: { enabled: true, adapter: devAuthAdapter },
  // The R2 binding cannot sign URLs, so presigned uploads use an S3 API token. The three credential
  // names below must exist as secrets (`wrangler secret put`) or in `.dev.vars` locally.
  files: {
    binding: "FILES",
    bucket: "clango-blog-files",
    accountId: "R2_ACCOUNT_ID",
    accessKeyId: "R2_ACCESS_KEY_ID",
    secretAccessKey: "R2_SECRET_ACCESS_KEY",
  },
  tasks: { binding: "TASKS", queue: "clango-blog-tasks" },
  cache: { binding: "CACHE", prefix: "blog:" },
  // Database-per-tenant: a request carrying `x-clango-tenant: acme` is served from DB_MAIN_ACME.
  // Requests without the header keep using DB_MAIN, so tenancy is inert until a tenant is sent.
  tenants: { enabled: true, database: "DB_MAIN" },
});
