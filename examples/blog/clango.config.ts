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
});
