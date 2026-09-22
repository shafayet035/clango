import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { ClangoConfig } from "@clango/core";
import { collectRegistry } from "@clango/core";
import { build, type Plugin } from "esbuild";

import { CliUsageError } from "./args";

/**
 * Keeps everything published under `@clango/*` in the bundle (it is TypeScript source, not
 * JavaScript) while leaving the project's other dependencies to Node's resolver.
 */
const externalizeDependencies: Plugin = {
  name: "clango-externalize",
  setup(buildApi) {
    buildApi.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith("@clango/")) return undefined;
      return { path: args.path, external: true };
    });
  },
};

function isConfig(value: unknown): value is ClangoConfig {
  return (
    typeof value === "object" && value !== null && Array.isArray((value as { apps?: unknown }).apps)
  );
}

/**
 * Bundles and imports the project's `clango.config.ts`.
 *
 * The bundle is written inside the project's `node_modules`, so bare imports in the config (for
 * example an auth library) resolve against the project exactly as they would at runtime.
 *
 * @param configPath - Path to the config file, relative to `cwd`.
 * @param cwd - Directory to resolve from, usually `process.cwd()`.
 */
export async function loadConfig(
  configPath: string,
  cwd: string,
  log: (message: string) => void = () => {},
): Promise<ClangoConfig> {
  const absolute = resolve(cwd, configPath);
  if (!existsSync(absolute)) {
    throw new CliUsageError(`Config file not found: ${absolute}`);
  }

  const cacheDirectory = join(cwd, "node_modules", ".clango");
  mkdirSync(cacheDirectory, { recursive: true });
  const outfile = join(cacheDirectory, "config.mjs");

  try {
    await build({
      entryPoints: [absolute],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: "inline",
      logLevel: "silent",
      plugins: [externalizeDependencies],
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new CliUsageError(`Failed to load ${configPath}:\n${message}`, { cause });
  }

  const imported = (await import(pathToFileURL(outfile).href)) as { default?: unknown };
  if (!isConfig(imported.default)) {
    throw new CliUsageError(
      `${configPath} must \`export default defineConfig({ ... })\` from "@clango/core".`,
    );
  }

  try {
    collectRegistry(imported.default);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new CliUsageError(message, { cause });
  }

  log(`Loaded ${configPath}`);
  return imported.default;
}
