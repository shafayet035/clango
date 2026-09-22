/**
 * Clango's schema engine: builds snapshots from the model registry, diffs them and renders the SQL
 * needed to apply the difference. Pure and Workers-compatible — all file I/O lives in the CLI.
 */

export {
  renderAddColumn,
  renderCreateFts,
  renderCreateIndex,
  renderCreateTable,
  renderDropFts,
  renderDropFtsTriggers,
  renderDropIndex,
  renderDropTable,
  renderFtsTriggers,
  renderPopulateFts,
  renderRebuildTable,
  quoteIdentifier,
  REBUILD_SUFFIX,
} from "./ddl";
export { DEFER_FOREIGN_KEYS, planMigration, renderMigrationFile } from "./plan";
export {
  buildSnapshot,
  emptySnapshot,
  parseSnapshot,
  serializeSnapshot,
  SNAPSHOT_VERSION,
} from "./snapshot";
export type {
  CheckSnapshot,
  ColumnDefault,
  ColumnSnapshot,
  ForeignKeySnapshot,
  FtsSnapshot,
  IndexSnapshot,
  MigrationPlan,
  SchemaChange,
  SchemaSnapshot,
  TableSnapshot,
} from "./types";
