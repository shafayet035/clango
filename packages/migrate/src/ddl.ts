import type {
  ColumnSnapshot,
  ForeignKeySnapshot,
  FtsSnapshot,
  IndexSnapshot,
  TableSnapshot,
} from "./types";

/** Suffix used for the temporary table during a rebuild. */
export const REBUILD_SUFFIX = "__clango_new";

/** Suffix used for the row backup taken while rebuilding a referential parent. */
export const BACKUP_SUFFIX = "__clango_bak";

/** Quotes a SQL identifier, escaping embedded double quotes. */
export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function renderColumn(column: ColumnSnapshot): string {
  const parts = [quoteIdentifier(column.name), column.type];
  if (column.notNull) parts.push("NOT NULL");
  if (column.defaultValue !== undefined) parts.push(`DEFAULT ${column.defaultValue.sql}`);
  return parts.join(" ");
}

function renderForeignKey(table: string, key: ForeignKeySnapshot): string {
  const name = `${table}_${key.columns.join("_")}_fk`;
  const parts = [
    `CONSTRAINT ${quoteIdentifier(name)} FOREIGN KEY (${key.columns.map(quoteIdentifier).join(", ")})`,
    `REFERENCES ${quoteIdentifier(key.refTable)} (${key.refColumns.map(quoteIdentifier).join(", ")})`,
  ];
  if (key.onDelete !== undefined) parts.push(`ON DELETE ${key.onDelete.toUpperCase()}`);
  if (key.onUpdate !== undefined) parts.push(`ON UPDATE ${key.onUpdate.toUpperCase()}`);
  return parts.join(" ");
}

/** Renders a `CREATE TABLE` statement. `tableName` overrides the name, used for rebuilds. */
export function renderCreateTable(table: TableSnapshot, tableName: string = table.name): string {
  const constraints: string[] = [
    `CONSTRAINT ${quoteIdentifier(`${table.name}_pk`)} PRIMARY KEY (${table.primaryKey
      .map(quoteIdentifier)
      .join(", ")})`,
  ];
  for (const check of table.checks) {
    constraints.push(`CONSTRAINT ${quoteIdentifier(check.name)} CHECK (${check.expression})`);
  }
  for (const key of table.foreignKeys) {
    constraints.push(renderForeignKey(table.name, key));
  }
  const body = [...table.columns.map(renderColumn), ...constraints];
  return `CREATE TABLE ${quoteIdentifier(tableName)} (\n  ${body.join(",\n  ")}\n)`;
}

/** Renders `ALTER TABLE ... ADD COLUMN`. */
export function renderAddColumn(table: string, column: ColumnSnapshot): string {
  return `ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${renderColumn(column)}`;
}

/** Renders a `CREATE INDEX` statement. */
export function renderCreateIndex(index: IndexSnapshot): string {
  const unique = index.unique ? "UNIQUE " : "";
  return `CREATE ${unique}INDEX ${quoteIdentifier(index.name)} ON ${quoteIdentifier(index.table)} (${index.columns
    .map(quoteIdentifier)
    .join(", ")})`;
}

/** Renders a `DROP INDEX` statement. */
export function renderDropIndex(index: IndexSnapshot): string {
  return `DROP INDEX IF EXISTS ${quoteIdentifier(index.name)}`;
}

function ftsColumns(fts: FtsSnapshot): string[] {
  return ["id", ...fts.columns];
}

function ftsColumnList(fts: FtsSnapshot): string {
  return ftsColumns(fts).map(quoteIdentifier).join(", ");
}

/** Renders `CREATE VIRTUAL TABLE ... USING fts5(...)`, with the source id column unindexed. */
export function renderCreateFts(fts: FtsSnapshot): string {
  const columns = [`${quoteIdentifier("id")} UNINDEXED`, ...fts.columns.map(quoteIdentifier)];
  return `CREATE VIRTUAL TABLE ${quoteIdentifier(
    fts.table,
  )} USING fts5(\n  ${columns.join(",\n  ")}\n)`;
}

function triggerName(fts: FtsSnapshot, suffix: "ai" | "ad" | "au"): string {
  return `${fts.table}_${suffix}`;
}

function newRowValues(fts: FtsSnapshot): string {
  return ftsColumns(fts)
    .map((column) => `new.${quoteIdentifier(column)}`)
    .join(", ");
}

/** Renders the three triggers that keep an FTS5 table in sync with its source table. */
export function renderFtsTriggers(fts: FtsSnapshot): string[] {
  const columns = ftsColumnList(fts);
  const source = quoteIdentifier(fts.sourceTable);
  const target = quoteIdentifier(fts.table);
  const deleteRow = `DELETE FROM ${target} WHERE ${quoteIdentifier("id")} = old.${quoteIdentifier("id")}`;
  return [
    `CREATE TRIGGER ${quoteIdentifier(triggerName(fts, "ai"))} AFTER INSERT ON ${source} BEGIN\n` +
      `  INSERT INTO ${target} (${columns}) VALUES (${newRowValues(fts)});\nEND`,
    `CREATE TRIGGER ${quoteIdentifier(triggerName(fts, "ad"))} AFTER DELETE ON ${source} BEGIN\n` +
      `  ${deleteRow};\nEND`,
    `CREATE TRIGGER ${quoteIdentifier(triggerName(fts, "au"))} AFTER UPDATE ON ${source} BEGIN\n` +
      `  ${deleteRow};\n  INSERT INTO ${target} (${columns}) VALUES (${newRowValues(fts)});\nEND`,
  ];
}

/** Renders statements dropping an FTS5 table's sync triggers without dropping the index. */
export function renderDropFtsTriggers(fts: FtsSnapshot): string[] {
  return [
    `DROP TRIGGER IF EXISTS ${quoteIdentifier(triggerName(fts, "ai"))}`,
    `DROP TRIGGER IF EXISTS ${quoteIdentifier(triggerName(fts, "ad"))}`,
    `DROP TRIGGER IF EXISTS ${quoteIdentifier(triggerName(fts, "au"))}`,
  ];
}

/** Renders statements dropping an FTS5 table and its triggers. */
export function renderDropFts(fts: FtsSnapshot): string[] {
  return [...renderDropFtsTriggers(fts), `DROP TABLE IF EXISTS ${quoteIdentifier(fts.table)}`];
}

/** Renders the statement that copies existing rows into a freshly created FTS5 table. */
export function renderPopulateFts(fts: FtsSnapshot): string {
  return `INSERT INTO ${quoteIdentifier(fts.table)} (${ftsColumnList(
    fts,
  )}) SELECT ${ftsColumnList(fts)} FROM ${quoteIdentifier(fts.sourceTable)}`;
}

/** Renders `DROP TABLE`, preceded by dropping the table's FTS mirror when present. */
export function renderDropTable(table: TableSnapshot, fts?: FtsSnapshot): string[] {
  const statements = fts === undefined ? [] : renderDropFts(fts);
  statements.push(`DROP TABLE ${quoteIdentifier(table.name)}`);
  return statements;
}

function sameColumns(a: FtsSnapshot, b: FtsSnapshot): boolean {
  return (
    a.columns.length === b.columns.length && a.columns.every((column, i) => b.columns[i] === column)
  );
}

/**
 * Renders a SQLite table rebuild: create the replacement table, copy every shared column, swap it
 * in, recreate indexes and refresh the FTS mirror.
 *
 * `DROP TABLE` performs an implicit `DELETE` while foreign keys are enabled, which fires
 * `ON DELETE CASCADE` and `ON DELETE SET NULL` on child tables and silently destroys their rows.
 * Because the rebuilt table is by definition a referential parent, {@link planMigration} backs up
 * and restores those children around the rebuild (see `preserveReferencedRows`). This function only
 * renders the structural change; `PRAGMA defer_foreign_keys = on` is emitted once by the planner
 * ahead of any rebuild.
 */
export function renderRebuildTable(
  previous: TableSnapshot,
  next: TableSnapshot,
  indexes: readonly IndexSnapshot[],
  fts: FtsSnapshot | undefined,
  previousFts: FtsSnapshot | undefined,
): string[] {
  const temporary = `${next.name}${REBUILD_SUFFIX}`;
  const nextColumns = new Map(next.columns.map((column) => [column.name, column]));
  const shared = previous.columns.filter((column) => nextColumns.has(column.name));

  const statements: string[] = [];
  const ftsDropped =
    previousFts !== undefined && (fts === undefined || !sameColumns(previousFts, fts));
  const ftsCreated = fts !== undefined && (previousFts === undefined || ftsDropped);

  if (previousFts !== undefined) {
    statements.push(...renderDropFtsTriggers(previousFts));
  }
  if (ftsDropped && previousFts !== undefined) {
    statements.push(`DROP TABLE IF EXISTS ${quoteIdentifier(previousFts.table)}`);
  }

  statements.push(renderCreateTable(next, temporary));

  if (shared.length > 0) {
    const columns = shared.map((column) => quoteIdentifier(column.name)).join(", ");
    statements.push(
      `INSERT INTO ${quoteIdentifier(temporary)} (${columns}) SELECT ${columns} FROM ${quoteIdentifier(
        previous.name,
      )}`,
    );
  }

  statements.push(`DROP TABLE ${quoteIdentifier(previous.name)}`);
  statements.push(
    `ALTER TABLE ${quoteIdentifier(temporary)} RENAME TO ${quoteIdentifier(next.name)}`,
  );

  for (const index of indexes) {
    statements.push(renderCreateIndex(index));
  }

  if (fts !== undefined) {
    if (ftsCreated) {
      statements.push(renderCreateFts(fts));
      statements.push(renderPopulateFts(fts));
    }
    statements.push(...renderFtsTriggers(fts));
  }

  return statements;
}

/** Renders a row backup for a table that a rebuild would otherwise cascade-delete. */
export function renderBackupTable(table: string): string {
  return `CREATE TABLE ${quoteIdentifier(table + BACKUP_SUFFIX)} AS SELECT * FROM ${quoteIdentifier(
    table,
  )}`;
}

/** Renders the restore of a table backed up by {@link renderBackupTable}. */
export function renderRestoreTable(table: string): string[] {
  const backup = quoteIdentifier(table + BACKUP_SUFFIX);
  return [
    `DELETE FROM ${quoteIdentifier(table)}`,
    `INSERT INTO ${quoteIdentifier(table)} SELECT * FROM ${backup}`,
    `DROP TABLE ${backup}`,
  ];
}
