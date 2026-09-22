import { MigrationError } from "@clango/core";

import {
  renderAddColumn,
  renderBackupTable,
  renderCreateFts,
  renderCreateIndex,
  renderCreateTable,
  renderDropFts,
  renderDropIndex,
  renderDropTable,
  renderFtsTriggers,
  renderPopulateFts,
  renderRebuildTable,
  renderRestoreTable,
} from "./ddl";
import type {
  ColumnSnapshot,
  MigrationPlan,
  SchemaChange,
  SchemaSnapshot,
  TableSnapshot,
} from "./types";

/** Emitted once at the top of a migration that rebuilds or drops tables. */
export const DEFER_FOREIGN_KEYS = "PRAGMA defer_foreign_keys = on";

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner !== null && typeof inner === "object" && !Array.isArray(inner)) {
      return Object.fromEntries(
        Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return inner;
  });
}

function stableEqual(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function columnEquals(a: ColumnSnapshot, b: ColumnSnapshot): boolean {
  return (
    a.name === b.name &&
    a.type === b.type &&
    a.notNull === b.notNull &&
    a.scale === b.scale &&
    stableEqual(a.defaultValue, b.defaultValue)
  );
}

function canAddColumn(column: ColumnSnapshot): boolean {
  return !column.notNull || column.defaultValue?.kind === "literal";
}

function assertAddable(table: string, column: ColumnSnapshot): void {
  if (column.notNull && column.defaultValue === undefined) {
    throw new MigrationError(
      `Cannot add NOT NULL column "${table}"."${column.name}" without a default. ` +
        "Declare the field with `optional: true` or give it a `default`.",
    );
  }
}

function statementsFor(change: SchemaChange): string[] {
  switch (change.kind) {
    case "createTable": {
      const statements = [renderCreateTable(change.table)];
      for (const index of change.indexes) statements.push(renderCreateIndex(index));
      if (change.fts !== undefined) {
        statements.push(renderCreateFts(change.fts));
        statements.push(...renderFtsTriggers(change.fts));
      }
      return statements;
    }
    case "dropTable":
      return renderDropTable(change.table, change.fts);
    case "addColumn":
      return [renderAddColumn(change.table, change.column)];
    case "rebuildTable":
      return renderRebuildTable(
        change.previous,
        change.next,
        change.indexes,
        change.fts,
        change.previousFts,
      );
    case "createIndex":
      return [renderCreateIndex(change.index)];
    case "dropIndex":
      return [renderDropIndex(change.index)];
    case "createFts":
      return [
        renderCreateFts(change.fts),
        renderPopulateFts(change.fts),
        ...renderFtsTriggers(change.fts),
      ];
    case "dropFts":
      return renderDropFts(change.fts);
    case "recreateFts":
      return [
        ...renderDropFts(change.previous),
        renderCreateFts(change.next),
        renderPopulateFts(change.next),
        ...renderFtsTriggers(change.next),
      ];
  }
}

function pick<K extends SchemaChange["kind"]>(
  changes: readonly SchemaChange[],
  kind: K,
): Extract<SchemaChange, { kind: K }>[] {
  return changes.filter(
    (change): change is Extract<SchemaChange, { kind: K }> => change.kind === kind,
  );
}

function diffColumns(
  previous: TableSnapshot,
  next: TableSnapshot,
): {
  added: ColumnSnapshot[];
  removed: ColumnSnapshot[];
  changed: ColumnSnapshot[];
} {
  const previousColumns = new Map(previous.columns.map((column) => [column.name, column]));
  const nextColumns = new Map(next.columns.map((column) => [column.name, column]));
  return {
    added: next.columns.filter((column) => !previousColumns.has(column.name)),
    removed: previous.columns.filter((column) => !nextColumns.has(column.name)),
    changed: next.columns.filter((column) => {
      const before = previousColumns.get(column.name);
      return before !== undefined && !columnEquals(before, column);
    }),
  };
}

function rebuildReasons(
  previous: TableSnapshot,
  next: TableSnapshot,
  added: readonly ColumnSnapshot[],
  removed: readonly ColumnSnapshot[],
  changed: readonly ColumnSnapshot[],
): string[] {
  const reasons: string[] = [];
  if (removed.length > 0) {
    reasons.push(`removed ${removed.map((column) => `"${column.name}"`).join(", ")}`);
  }
  if (changed.length > 0) {
    reasons.push(`changed ${changed.map((column) => `"${column.name}"`).join(", ")}`);
  }
  if (!stableEqual(previous.checks, next.checks)) reasons.push("changed check constraints");
  if (!stableEqual(previous.foreignKeys, next.foreignKeys)) reasons.push("changed foreign keys");
  if (previous.primaryKey.join("\u0000") !== next.primaryKey.join("\u0000")) {
    reasons.push("changed primary key");
  }
  const blocked = added.filter((column) => !canAddColumn(column));
  if (blocked.length > 0) {
    reasons.push(
      `added ${blocked.map((column) => `"${column.name}"`).join(", ")} requiring a rebuild`,
    );
  }
  return reasons;
}

/**
 * Walks the referential graph of `previous` to find every table a rebuild would cascade into.
 *
 * `DROP TABLE` behaves like `DELETE FROM` while foreign keys are enabled, so rebuilding a table
 * that `ON DELETE CASCADE` or `ON DELETE SET NULL` children point at destroys their rows. Those
 * tables are backed up before the rebuild and restored afterwards. `ON DELETE RESTRICT` cannot be
 * deferred by SQLite and blocks the rebuild outright, so it is reported instead.
 */
function referentialDependents(
  previous: SchemaSnapshot,
  roots: Iterable<string>,
): { preserve: string[]; blocked: string[] } {
  const preserve = new Set<string>();
  const blocked = new Set<string>();
  const queue = [...roots];
  const seen = new Set<string>(queue);

  while (queue.length > 0) {
    const table = queue.shift() as string;
    for (const candidate of previous.tables) {
      if (candidate.name === table) continue;
      for (const key of candidate.foreignKeys) {
        if (key.refTable !== table) continue;
        const action = key.onDelete ?? "no action";
        if (action === "restrict") {
          blocked.add(`"${candidate.name}" restricts "${table}"`);
          continue;
        }
        if (action !== "cascade" && action !== "set null") continue;
        if (preserve.has(candidate.name)) continue;
        preserve.add(candidate.name);
        if (!seen.has(candidate.name)) {
          seen.add(candidate.name);
          queue.push(candidate.name);
        }
      }
    }
  }

  return { preserve: [...preserve].sort(), blocked: [...blocked].sort() };
}

/**
 * Compares two snapshots and produces the statements needed to move the database from `previous`
 * to `next`.
 *
 * The plan is deterministic: the same pair of snapshots always produces the same SQL. Rebuilds
 * carry a `PRAGMA defer_foreign_keys = on` statement so foreign keys are checked once at the end of
 * the migration transaction, and `destructive` lists every change that discards data.
 */
export function planMigration(previous: SchemaSnapshot, next: SchemaSnapshot): MigrationPlan {
  const changes: SchemaChange[] = [];
  const destructive: string[] = [];
  const summary: string[] = [];

  const previousTables = new Map(previous.tables.map((table) => [table.name, table]));
  const nextTables = new Map(next.tables.map((table) => [table.name, table]));
  const previousIndexes = new Map(previous.indexes.map((index) => [index.name, index]));
  const nextIndexes = new Map(next.indexes.map((index) => [index.name, index]));
  const previousFts = new Map(previous.fts.map((fts) => [fts.table, fts]));
  const nextFts = new Map(next.fts.map((fts) => [fts.table, fts]));
  const previousFtsBySource = new Map(previous.fts.map((fts) => [fts.sourceTable, fts]));
  const nextFtsBySource = new Map(next.fts.map((fts) => [fts.sourceTable, fts]));

  const createdTables = new Set<string>();
  const rebuiltTables = new Set<string>();
  const droppedTables = new Set<string>();

  for (const table of previous.tables) {
    if (!nextTables.has(table.name)) droppedTables.add(table.name);
  }

  for (const name of droppedTables) {
    const referencing = next.tables.find((table) =>
      table.foreignKeys.some((key) => key.refTable === name),
    );
    if (referencing !== undefined) {
      throw new MigrationError(
        `Cannot drop table "${name}" because "${referencing.name}" still references it. ` +
          "Remove the relation first.",
      );
    }
  }

  for (const table of next.tables) {
    if (previousTables.has(table.name)) continue;
    createdTables.add(table.name);
    const indexes = next.indexes.filter((index) => index.table === table.name);
    const fts = nextFtsBySource.get(table.name);
    changes.push(
      fts === undefined
        ? { kind: "createTable", table, indexes }
        : { kind: "createTable", table, indexes, fts },
    );
    summary.push(`Create table "${table.name}"`);
  }

  for (const table of next.tables) {
    const before = previousTables.get(table.name);
    if (before === undefined) continue;

    const { added, removed, changed } = diffColumns(before, table);
    for (const column of added) assertAddable(table.name, column);

    const reasons = rebuildReasons(before, table, added, removed, changed);
    if (reasons.length > 0) {
      rebuiltTables.add(table.name);
      const indexes = next.indexes.filter((index) => index.table === table.name);
      const fts = nextFtsBySource.get(table.name);
      const previousTableFts = previousFtsBySource.get(table.name);
      changes.push({
        kind: "rebuildTable",
        previous: before,
        next: table,
        indexes,
        ...(fts === undefined ? {} : { fts }),
        ...(previousTableFts === undefined ? {} : { previousFts: previousTableFts }),
        reasons,
      });
      summary.push(`Rebuild table "${table.name}" (${reasons.join("; ")})`);
      for (const column of removed) {
        destructive.push(`Drop column "${table.name}"."${column.name}"`);
      }
      continue;
    }

    for (const column of added) {
      changes.push({ kind: "addColumn", table: table.name, column });
      summary.push(`Add column "${table.name}"."${column.name}"`);
    }
  }

  for (const table of previous.tables) {
    if (!droppedTables.has(table.name)) continue;
    const fts = previousFtsBySource.get(table.name);
    changes.push(
      fts === undefined ? { kind: "dropTable", table } : { kind: "dropTable", table, fts },
    );
    summary.push(`Drop table "${table.name}"`);
    destructive.push(`Drop table "${table.name}"`);
  }

  for (const index of next.indexes) {
    if (createdTables.has(index.table) || rebuiltTables.has(index.table)) continue;
    const before = previousIndexes.get(index.name);
    if (before === undefined) {
      changes.push({ kind: "createIndex", index });
      summary.push(`Create index "${index.name}"`);
      continue;
    }
    if (!stableEqual(before, index)) {
      changes.push({ kind: "dropIndex", index: before });
      changes.push({ kind: "createIndex", index });
      summary.push(`Recreate index "${index.name}"`);
    }
  }

  for (const index of previous.indexes) {
    if (nextIndexes.has(index.name)) continue;
    if (!nextTables.has(index.table)) continue;
    if (createdTables.has(index.table) || rebuiltTables.has(index.table)) continue;
    changes.push({ kind: "dropIndex", index });
    summary.push(`Drop index "${index.name}"`);
  }

  for (const fts of next.fts) {
    if (createdTables.has(fts.sourceTable) || rebuiltTables.has(fts.sourceTable)) continue;
    const before = previousFts.get(fts.table);
    if (before === undefined) {
      changes.push({ kind: "createFts", fts });
      summary.push(`Create full-text index "${fts.table}"`);
      continue;
    }
    if (!stableEqual(before.columns, fts.columns)) {
      changes.push({ kind: "recreateFts", previous: before, next: fts });
      summary.push(`Recreate full-text index "${fts.table}"`);
    }
  }

  for (const fts of previous.fts) {
    if (nextFts.has(fts.table)) continue;
    if (!nextTables.has(fts.sourceTable)) continue;
    if (rebuiltTables.has(fts.sourceTable)) continue;
    changes.push({ kind: "dropFts", fts });
    summary.push(`Drop full-text index "${fts.table}"`);
  }

  const statements: string[] = [];
  const needsDefer = changes.some(
    (change) => change.kind === "rebuildTable" || change.kind === "dropTable",
  );
  if (needsDefer) statements.push(DEFER_FOREIGN_KEYS);

  const { preserve, blocked } = referentialDependents(previous, rebuiltTables);
  if (blocked.length > 0) {
    throw new MigrationError(
      `Cannot rebuild a table that is referenced with ON DELETE RESTRICT: ${blocked.join(", ")}. ` +
        'SQLite cannot defer RESTRICT. Use `onDelete: "no action"` (the default) and enforce the rule in application code.',
    );
  }
  const overlap = preserve.filter((table) => rebuiltTables.has(table));
  if (overlap.length > 0) {
    throw new MigrationError(
      `Cannot rebuild a referential parent and its cascade dependents in the same migration: ${overlap.join(
        ", ",
      )}. Run makemigrations again to split the rebuild into separate migrations.`,
    );
  }

  for (const table of preserve) statements.push(renderBackupTable(table));

  const order: readonly SchemaChange["kind"][] = [
    "dropIndex",
    "dropFts",
    "dropTable",
    "createTable",
    "addColumn",
    "rebuildTable",
    "createFts",
    "recreateFts",
    "createIndex",
  ];
  for (const kind of order) {
    for (const change of pick(changes, kind)) {
      statements.push(...statementsFor(change));
    }
  }

  for (const table of preserve) statements.push(...renderRestoreTable(table));

  return { changes, destructive, statements, summary };
}

/** Renders the SQL file contents for a plan. */
export function renderMigrationFile(plan: MigrationPlan, name: string): string {
  const lines: string[] = [
    `-- Migration ${name}`,
    "-- Generated by Clango. Do not edit by hand.",
    ...plan.summary.map((entry) => `-- - ${entry}`),
    "",
  ];
  for (const statement of plan.statements) {
    lines.push(`${statement};`, "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
