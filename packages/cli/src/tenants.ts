import {
  CLANGO_TENANT_MODEL,
  CONTROL_MODELS,
  collectRegistry,
  columnFor,
  tenantBindingFor,
  type ClangoConfig,
} from "@clango/core";
import { quoteIdentifier } from "@clango/migrate";

/** A tenant as read from the control database. */
export interface TenantRow {
  readonly slug: string;
  readonly suspended: boolean;
}

/** The statement that lists tenants to migrate. */
export function buildTenantListSql(): string {
  const table = quoteIdentifier(CONTROL_MODELS[0].tableName);
  return `SELECT ${columnFor("slug")} AS slug, ${columnFor("suspended")} AS suspended FROM ${table}`;
}

/**
 * Reads `wrangler d1 execute --json` output.
 *
 * Wrangler wraps results in an array (one entry per statement) and the shape has changed between
 * versions, so this accepts both `[{ results: [...] }]` and `{ results: [...] }` and ignores
 * anything else rather than crashing on an unexpected wrapper.
 */
export function parseTenantRows(output: string): readonly TenantRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return [];
  }

  const container = Array.isArray(parsed) ? parsed[0] : parsed;
  const results = (container as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];

  const rows: TenantRow[] = [];
  for (const entry of results) {
    const record = entry as { slug?: unknown; suspended?: unknown };
    if (typeof record.slug !== "string" || record.slug.length === 0) continue;
    rows.push({
      slug: record.slug,
      suspended: record.suspended === 1 || record.suspended === true,
    });
  }
  return rows;
}

/** Tenants that should be migrated, in a stable order. */
export function activeTenants(rows: readonly TenantRow[]): readonly TenantRow[] {
  return rows.filter((row) => !row.suspended).sort((a, b) => a.slug.localeCompare(b.slug));
}

/** One `migrate` invocation for a tenant. */
export interface TenantMigrationStep {
  readonly tenant: string;
  readonly database: string;
  readonly binding: string;
}

/**
 * Expands tenants × databases into the list of migrations to apply.
 *
 * Every tenant database shares the project's schema, so the same migrations directory is applied to
 * each; what differs is only the binding the migration runs against.
 */
export function planTenantMigrations(
  config: ClangoConfig,
  tenants: readonly TenantRow[],
  options: { readonly databases?: readonly string[] } = {},
): readonly TenantMigrationStep[] {
  const registry = collectRegistry(config);
  const all = [...new Set(registry.models.map((entry) => entry.database))].sort();
  const selected =
    options.databases === undefined || options.databases.length === 0
      ? all
      : [...options.databases].sort();

  const steps: TenantMigrationStep[] = [];
  for (const tenant of activeTenants(tenants)) {
    for (const database of selected) {
      steps.push({
        tenant: tenant.slug,
        database,
        binding: tenantBindingFor(config, database, tenant.slug),
      });
    }
  }
  return steps;
}

export { CLANGO_TENANT_MODEL };
