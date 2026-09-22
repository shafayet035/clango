import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { collectDatabases, collectRegistry, type ClangoConfig } from "@clango/core";

import { CliUsageError, type CliOptions } from "./args";
import { loadConfig } from "./load-config";

/** Outcome of a `migrate` run. */
export interface MigrateResult {
  readonly applied: readonly string[];
}

export function resolveWrangler(cwd: string): string {
  const override = process.env["CLANGO_WRANGLER"];
  if (override !== undefined && override.length > 0) return override;
  const binary = process.platform === "win32" ? "wrangler.cmd" : "wrangler";
  const local = join(cwd, "node_modules", ".bin", binary);
  return existsSync(local) ? local : binary;
}

/**
 * Applies pending migrations by delegating to `wrangler d1 migrations apply`, one database at a
 * time. Wrangler owns the migration ledger (`d1_migrations`) and the D1 connection, so Clango only
 * has to point it at the right directory.
 */
export async function runMigrate(
  options: CliOptions,
  cwd: string,
  log: (message: string) => void = () => {},
): Promise<MigrateResult> {
  const config: ClangoConfig = await loadConfig(options.config, cwd, log);
  const registry = collectRegistry(config);
  const available = collectDatabases(config);

  const selected = options.databases.length > 0 ? options.databases : available;
  for (const database of selected) {
    if (!available.includes(database)) {
      throw new CliUsageError(
        `Database "${database}" is not used by any model. Available: ${available.join(", ") || "(none)"}.`,
      );
    }
    const binding = config.databases?.[database]?.binding;
    if (binding === undefined) {
      throw new CliUsageError(`Database "${database}" has no binding in ${options.config}.`);
    }
  }
  void registry;

  const wrangler = resolveWrangler(cwd);
  const applied: string[] = [];

  for (const database of selected) {
    const binding = (config.databases as Record<string, { binding: string }>)[database]?.binding;
    const args = ["d1", "migrations", "apply", binding as string];
    if (options.target === "local") args.push("--local");
    if (options.target === "remote") args.push("--remote");

    log(`Applying migrations for ${database} (${binding})...`);
    const result = spawnSync(wrangler, args, { cwd, stdio: "inherit" });
    if (result.error !== undefined) {
      throw new CliUsageError(
        `Could not run "${wrangler}". Install wrangler or set CLANGO_WRANGLER.\n${result.error.message}`,
        { cause: result.error },
      );
    }
    if (result.status !== 0) {
      throw new CliUsageError(
        `wrangler exited with code ${String(result.status)} while migrating ${database}. ` +
          `Check that the "${binding}" binding declares \`migrations_dir\`: "${options.migrationsDir}/${database}".`,
      );
    }
    applied.push(database);
  }

  log(`Applied migrations for ${applied.length} database${applied.length === 1 ? "" : "s"}.`);
  return { applied };
}
