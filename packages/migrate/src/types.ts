import type { ReferentialAction, StorageClass } from "@clango/core";

/**
 * A column default. `literal` defaults are usable by `ALTER TABLE ADD COLUMN`; `expression`
 * defaults (such as `unixepoch()`) are not, and force a table rebuild.
 */
export interface ColumnDefault {
  readonly kind: "literal" | "expression";
  readonly sql: string;
}

/** A single column in a snapshot. */
export interface ColumnSnapshot {
  /** SQL column name, for example `published_at`. */
  readonly name: string;
  /** TypeScript property name, for example `publishedAt`. */
  readonly property: string;
  readonly type: StorageClass;
  readonly notNull: boolean;
  readonly defaultValue?: ColumnDefault;
  /** Number of decimal places, for `decimal` columns stored as integer minor units. */
  readonly scale?: number;
}

/** A table-level foreign key. */
export interface ForeignKeySnapshot {
  readonly columns: readonly string[];
  readonly refTable: string;
  readonly refColumns: readonly string[];
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
}

/** A named table-level `CHECK` constraint. */
export interface CheckSnapshot {
  readonly name: string;
  readonly expression: string;
}

/** A table, either backing a model or a many-to-many join. */
export interface TableSnapshot {
  readonly name: string;
  readonly kind: "model" | "join";
  /** Qualified model name, for model tables. Used for diagnostics. */
  readonly owner?: string;
  readonly columns: readonly ColumnSnapshot[];
  readonly primaryKey: readonly string[];
  readonly checks: readonly CheckSnapshot[];
  readonly foreignKeys: readonly ForeignKeySnapshot[];
}

/** A `CREATE INDEX` statement. Unique indexes are used for `unique: true` fields. */
export interface IndexSnapshot {
  readonly name: string;
  readonly table: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
}

/** An FTS5 virtual table shadowing a model table. */
export interface FtsSnapshot {
  readonly table: string;
  readonly sourceTable: string;
  /** Column names included in the index. */
  readonly columns: readonly string[];
}

/** The complete schema state of a database at a point in time. */
export interface SchemaSnapshot {
  readonly version: 1;
  readonly tables: readonly TableSnapshot[];
  readonly indexes: readonly IndexSnapshot[];
  readonly fts: readonly FtsSnapshot[];
}

/** A single planned change between two snapshots. */
export type SchemaChange =
  | {
      readonly kind: "createTable";
      readonly table: TableSnapshot;
      readonly indexes: readonly IndexSnapshot[];
      readonly fts?: FtsSnapshot;
    }
  | {
      readonly kind: "dropTable";
      readonly table: TableSnapshot;
      readonly fts?: FtsSnapshot;
    }
  | {
      readonly kind: "addColumn";
      readonly table: string;
      readonly column: ColumnSnapshot;
    }
  | {
      readonly kind: "rebuildTable";
      readonly previous: TableSnapshot;
      readonly next: TableSnapshot;
      readonly indexes: readonly IndexSnapshot[];
      readonly fts?: FtsSnapshot;
      readonly previousFts?: FtsSnapshot;
      readonly reasons: readonly string[];
    }
  | { readonly kind: "createIndex"; readonly index: IndexSnapshot }
  | { readonly kind: "dropIndex"; readonly index: IndexSnapshot }
  | { readonly kind: "createFts"; readonly fts: FtsSnapshot }
  | { readonly kind: "dropFts"; readonly fts: FtsSnapshot }
  | {
      readonly kind: "recreateFts";
      readonly previous: FtsSnapshot;
      readonly next: FtsSnapshot;
    };

/** The result of diffing two snapshots. */
export interface MigrationPlan {
  readonly changes: readonly SchemaChange[];
  /** Human-readable descriptions of changes that lose data. */
  readonly destructive: readonly string[];
  /** SQL statements, in execution order, without a trailing semicolon. */
  readonly statements: readonly string[];
  /** Human-readable one-line descriptions of every change. */
  readonly summary: readonly string[];
}
