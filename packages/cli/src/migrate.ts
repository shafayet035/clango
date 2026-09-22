import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  CLANGO_TENANT_MODEL,
  collectDatabases,
  collectRegistry,
  type ClangoConfig,
} from "@clango/core";

import { CliUsageError, type CliOptions } from "./args";
import { loadConfig } from "./load-config";
import { buildTenantListSql, parseTenantRows, planTenantMigrations } from "./tenants";

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

  // The tenant registry lives with the other framework tables.
  const controlEntry = collectRegistry(config).byName.get(CLANGO_TENANT_MODEL);
  const controlBinding =
    controlEntry === undefined ? undefined : config.databases?.[controlEntry.database]?.binding;

  if (options.allTenants) {
    if (config.tenants?.enabled !== true || controlBinding === undefined) {
      throw new CliUsageError(
        "migrate --all-tenants needs tenancy: set `tenants: { enabled: true }` in defineConfig and " +
          "declare the database that hosts the tenant registry.",
      );
    }
    return migrateAllTenants(options, cwd, log, {
      wrangler,
      selected,
      config,
      controlBinding,
    });
  }

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

/** Reads the tenant registry from the control database. */
function readTenants(
  wrangler: string,
  cwd: string,
  binding: string,
  target: CliOptions["target"],
): ReturnType<typeof parseTenantRows> {
  const args = ["d1", "execute", binding, "--json", "--command", buildTenantListSql()];
  if (target === "local" || target === "remote") args.push(`--${target}`);

  const result = spawnSync(wrangler, args, { cwd, encoding: "utf8" });
  if (result.error !== undefined) {
    throw new CliUsageError(
      `Could not read the tenant registry through "${wrangler}".\n${result.error.message}`,
      { cause: result.error },
    );
  }
  if (result.status !== 0) {
    throw new CliUsageError(
      `Reading the tenant registry from "${binding}" failed. Has the control database been migrated?\n${
        result.stderr ?? ""
      }`,
    );
  }
  return parseTenantRows(result.stdout ?? "");
}

/**
 * Applies migrations to every active tenant.
 *
 * Each tenant database shares the project's schema, so the same directory is applied to each; only
 * the binding differs. Bindings come from the same derivation the request router uses, which is why
 * a tenant whose binding is missing from `wrangler.jsonc` fails loudly here rather than at runtime.
 */
function migrateAllTenants(
  options: CliOptions,
  cwd: string,
  log: (message: string) => void,
  context: {
    wrangler: string;
    selected: readonly string[];
    config: ClangoConfig;
    controlBinding: string;
  },
): MigrateResult {
  const tenants = readTenants(context.wrangler, cwd, context.controlBinding, options.target);
  const steps = planTenantMigrations(context.config, tenants, { databases: context.selected });
  if (steps.length === 0) {
    log("No active tenants to migrate.");
    return { applied: [] };
  }

  log(`Migrating ${steps.length} tenant database(s)...`);
  const applied: string[] = [];
  for (const step of steps) {
    const args = ["d1", "migrations", "apply", step.binding];
    if (options.target === "local" || options.target === "remote") args.push(`--${options.target}`);
    log(`  ${step.tenant} → ${step.database} (${step.binding})`);
    const result = spawnSync(context.wrangler, args, { cwd, stdio: "inherit" });
    if (result.status !== 0) {
      throw new CliUsageError(
        `Migrating tenant "${step.tenant}" failed on binding "${step.binding}". Declare it in ` +
          `wrangler.jsonc with \`migrations_dir\`: "${options.migrationsDir}/${step.database}".`,
      );
    }
    applied.push(step.tenant);
  }

  log(`Applied migrations for ${applied.length} tenant database(s).`);
  return { applied };
}
