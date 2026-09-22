import { chmodSync } from "node:fs";

import { build } from "esbuild";

await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  banner: { js: "#!/usr/bin/env node" },
  // esbuild ships CommonJS with dynamic requires, which cannot be inlined into an ESM bundle.
  external: ["esbuild"],
  logLevel: "info",
});

chmodSync("dist/cli.js", 0o755);
