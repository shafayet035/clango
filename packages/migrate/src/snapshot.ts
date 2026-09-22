import {
  MigrationError,
  columnFor,
  manyToManyFields,
  searchableFields,
  toSnakeCase,
  type AnyModel,
  type Field,
  type ReferentialAction,
  type Registry,
  type StorageClass,
} from "@clango/core";

import type {
  CheckSnapshot,
  ColumnDefault,
  ColumnSnapshot,
  ForeignKeySnapshot,
  FtsSnapshot,
  IndexSnapshot,
  SchemaSnapshot,
  TableSnapshot,
} from "./types";

/** Current on-disk snapshot format version. */
export const SNAPSHOT_VERSION = 1;

const TIMESTAMP_DEFAULT: ColumnDefault = {
  kind: "expression",
  sql: "(unixepoch() * 1000)",
};

function storageClassFor(kind: Field["kind"]): StorageClass {
  switch (kind) {
    case "integer":
    case "decimal":
    case "boolean":
    case "datetime":
      return "INTEGER";
    default:
      return "TEXT";
  }
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function literal(sql: string): ColumnDefault {
  return { kind: "literal", sql };
}

function decimalScale(field: Field): number {
  const scale = (field.options as { scale?: number }).scale;
  return scale ?? 2;
}

function defaultFor(field: Field): ColumnDefault | undefined {
  const options = field.options as { default?: unknown; scale?: number };
  const value = options.default;
  if (value === undefined) return undefined;

  switch (field.kind) {
    case "datetime":
      if (value === "now") return TIMESTAMP_DEFAULT;
      if (value instanceof Date) return literal(String(value.getTime()));
      return literal(String(value as number));
    case "boolean":
      return literal(value === true ? "1" : "0");
    case "integer":
      return literal(String(value as number));
    case "decimal": {
      const factor = 10 ** decimalScale(field);
      return literal(String(Math.round((value as number) * factor)));
    }
    case "json":
      return literal(quoteLiteral(JSON.stringify(value)));
    default:
      return literal(quoteLiteral(String(value)));
  }
}

function buildColumn(property: string, field: Field): ColumnSnapshot {
  const options = field.options as { optional?: boolean };
  const column: {
    name: string;
    property: string;
    type: StorageClass;
    notNull: boolean;
    defaultValue?: ColumnDefault;
    scale?: number;
  } = {
    name: columnFor(property),
    property,
    type: storageClassFor(field.kind),
    notNull: options.optional !== true,
  };
  const defaultValue = defaultFor(field);
  if (defaultValue !== undefined) column.defaultValue = defaultValue;
  if (field.kind === "decimal") column.scale = decimalScale(field);
  return column;
}

function automaticColumns(): ColumnSnapshot[] {
  return [
    { name: "id", property: "id", type: "TEXT", notNull: true },
    {
      name: columnFor("createdAt"),
      property: "createdAt",
      type: "INTEGER",
      notNull: true,
      defaultValue: TIMESTAMP_DEFAULT,
    },
    {
      name: columnFor("updatedAt"),
      property: "updatedAt",
      type: "INTEGER",
      notNull: true,
      defaultValue: TIMESTAMP_DEFAULT,
    },
  ];
}

function buildChecks(model: AnyModel): CheckSnapshot[] {
  const checks: CheckSnapshot[] = [];
  for (const [property, field] of Object.entries(model.fields)) {
    if (field.kind !== "choice") continue;
    const values = field.values ?? [];
    const column = columnFor(property);
    const list = values.map(quoteLiteral).join(", ");
    checks.push({
      name: `${model.tableName}_${column}_check`,
      expression: `"${column}" IN (${list})`,
    });
  }
  return checks;
}

function buildForeignKeys(model: AnyModel): ForeignKeySnapshot[] {
  const keys: ForeignKeySnapshot[] = [];
  for (const [property, field] of Object.entries(model.fields)) {
    if (field.kind !== "foreignKey") continue;
    const target = field.ref?.();
    if (target === undefined) {
      throw new MigrationError(
        `Model "${model.name}" field "${property}" does not resolve to a model. ` +
          "Foreign key targets must be lazy references, for example `() => Author`.",
      );
    }
    const options = field.options as {
      onDelete?: ReferentialAction;
      onUpdate?: ReferentialAction;
    };
    const key: {
      columns: string[];
      refTable: string;
      refColumns: string[];
      onDelete?: ReferentialAction;
      onUpdate?: ReferentialAction;
    } = {
      columns: [columnFor(property)],
      refTable: target.tableName,
      refColumns: ["id"],
    };
    if (options.onDelete !== undefined) key.onDelete = options.onDelete;
    if (options.onUpdate !== undefined) key.onUpdate = options.onUpdate;
    keys.push(key);
  }
  return keys;
}

function buildIndexes(model: AnyModel): IndexSnapshot[] {
  const indexes: IndexSnapshot[] = [];
  for (const [property, field] of Object.entries(model.fields)) {
    if (field.kind === "manyToMany") continue;
    const column = columnFor(property);
    const options = field.options as { unique?: boolean; index?: boolean };
    if (options.unique === true) {
      indexes.push({
        name: `uniq_${model.tableName}_${column}`,
        table: model.tableName,
        columns: [column],
        unique: true,
      });
      continue;
    }
    if (options.index === true || field.kind === "foreignKey") {
      indexes.push({
        name: `idx_${model.tableName}_${column}`,
        table: model.tableName,
        columns: [column],
        unique: false,
      });
    }
  }
  return indexes;
}

function joinColumnName(model: AnyModel): string {
  return `${toSnakeCase(model.modelName)}_id`;
}

function buildJoinTable(
  model: AnyModel,
  property: string,
  field: Field,
): { table: TableSnapshot; indexes: IndexSnapshot[] } {
  const target = field.ref?.();
  if (target === undefined) {
    throw new MigrationError(
      `Model "${model.name}" field "${property}" does not resolve to a model.`,
    );
  }
  const options = field.options as { through?: string };
  const name = options.through ?? `${model.tableName}_${toSnakeCase(property)}`;
  const sourceColumn = joinColumnName(model);
  const targetColumn = joinColumnName(target);
  if (sourceColumn === targetColumn) {
    throw new MigrationError(
      `Model "${model.name}" field "${property}" is a self-referential many-to-many relation, ` +
        "which needs an explicit `through` table name. This is not supported yet.",
    );
  }

  const table: TableSnapshot = {
    name,
    kind: "join",
    columns: [
      { name: sourceColumn, property: sourceColumn, type: "TEXT", notNull: true },
      { name: targetColumn, property: targetColumn, type: "TEXT", notNull: true },
    ],
    primaryKey: [sourceColumn, targetColumn],
    checks: [],
    foreignKeys: [
      {
        columns: [sourceColumn],
        refTable: model.tableName,
        refColumns: ["id"],
        onDelete: "cascade",
      },
      {
        columns: [targetColumn],
        refTable: target.tableName,
        refColumns: ["id"],
        onDelete: "cascade",
      },
    ],
  };

  return {
    table,
    indexes: [
      { name: `idx_${name}_${targetColumn}`, table: name, columns: [targetColumn], unique: false },
    ],
  };
}

function buildModelTable(model: AnyModel): TableSnapshot {
  const columns = automaticColumns();
  for (const [property, field] of Object.entries(model.fields)) {
    if (field.kind === "manyToMany") continue;
    columns.push(buildColumn(property, field));
  }
  return {
    name: model.tableName,
    kind: "model",
    owner: model.name,
    columns,
    primaryKey: ["id"],
    checks: buildChecks(model),
    foreignKeys: buildForeignKeys(model),
  };
}

/**
 * Builds the schema snapshot for a project. Tables and indexes are sorted by name so snapshots are
 * byte-stable and diffs are deterministic.
 */
export function buildSnapshot(registry: Registry): SchemaSnapshot {
  const tables: TableSnapshot[] = [];
  const indexes: IndexSnapshot[] = [];
  const fts: FtsSnapshot[] = [];

  for (const { model } of registry.models) {
    tables.push(buildModelTable(model));
    indexes.push(...buildIndexes(model));

    const searchable = searchableFields(model);
    if (searchable.length > 0) {
      fts.push({
        table: `${model.tableName}_fts`,
        sourceTable: model.tableName,
        columns: searchable.map(columnFor),
      });
    }

    for (const [property, field] of manyToManyFields(model)) {
      const join = buildJoinTable(model, property, field);
      tables.push(join.table);
      indexes.push(...join.indexes);
    }
  }

  return {
    version: SNAPSHOT_VERSION,
    tables: [...tables].sort((a, b) => a.name.localeCompare(b.name)),
    indexes: [...indexes].sort((a, b) => a.name.localeCompare(b.name)),
    fts: [...fts].sort((a, b) => a.table.localeCompare(b.table)),
  };
}

/** Serializes a snapshot to the JSON stored in `migrations/_snapshot.json`. */
export function serializeSnapshot(snapshot: SchemaSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

/** Parses and validates a snapshot. Throws {@link MigrationError} for unsupported formats. */
export function parseSnapshot(json: string): SchemaSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new MigrationError("The snapshot file is not valid JSON.", { cause });
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new MigrationError("The snapshot file must contain an object.");
  }
  const candidate = parsed as Partial<SchemaSnapshot>;
  if (candidate.version !== SNAPSHOT_VERSION) {
    throw new MigrationError(
      `Unsupported snapshot version ${String(candidate.version)}. Expected ${SNAPSHOT_VERSION}.`,
    );
  }
  if (
    !Array.isArray(candidate.tables) ||
    !Array.isArray(candidate.indexes) ||
    !Array.isArray(candidate.fts)
  ) {
    throw new MigrationError("The snapshot file is missing `tables`, `indexes` or `fts`.");
  }
  return candidate as SchemaSnapshot;
}

/** An empty snapshot, used when a project has no migrations yet. */
export function emptySnapshot(): SchemaSnapshot {
  return { version: SNAPSHOT_VERSION, tables: [], indexes: [], fts: [] };
}
