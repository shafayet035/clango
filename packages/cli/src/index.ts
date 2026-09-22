/**
 * Programmatic entry point for `@clango/cli`. The binary lives in `dist/cli.js`; these exports let
 * tests and tooling drive the same commands.
 */

export {
  CliUsageError,
  DEFAULT_CONFIG_PATH,
  DEFAULT_MIGRATIONS_DIR,
  parseArgs,
  renderHelp,
  type CliCommand,
  type CliOptions,
  type MigrationTarget,
  type ParsedCommand,
} from "./args";
export { buildSuperuserSql, type SuperuserSqlOptions } from "./createsuperuser";
export { runInit, runStartapp, type GenerateResult } from "./generate";
export { appFiles, projectFiles, type GeneratedFile, type InitOptions } from "./generators";
export { loadConfig } from "./load-config";
export { main, type CliIo } from "./main";
export { runMakemigrations, SNAPSHOT_FILE, type MakemigrationsResult } from "./makemigrations";
export { runMigrate, type MigrateResult } from "./migrate";
export { formatMigrationNumber, parseMigrationNumber, slugify } from "./slug";
export {
  activeTenants,
  buildTenantListSql,
  parseTenantRows,
  planTenantMigrations,
  type TenantMigrationStep,
  type TenantRow,
} from "./tenants";
export { VERSION } from "./version";
