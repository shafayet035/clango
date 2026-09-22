import { columnFor, type AnyModel, type Field } from "@clango/core";
import { sql } from "drizzle-orm";
import {
  customType,
  integer,
  sqliteTable,
  text,
  type SQLiteColumnBuilder,
  type SQLiteTable,
} from "drizzle-orm/sqlite-core";

/** Quotes a SQL identifier, escaping embedded double quotes. */
export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** SQL expression used for the automatic `createdAt`/`updatedAt` columns. */
export const TIMESTAMP_DEFAULT = sql`(unixepoch() * 1000)`;

type ColumnBuilder = SQLiteColumnBuilder;

/**
 * Column builders are heavily generic: the type of `.default()` is narrowed per data type, so no
 * single instantiation accepts every kind. Modifiers are applied through a structural view and the
 * finished builder is cast once, at the internal boundary of this module.
 */
interface Modifiable {
  notNull(): Modifiable;
  default(value: unknown): Modifiable;
}

function applyModifiers(column: unknown, optional: boolean, defaultValue: unknown): ColumnBuilder {
  let result = column as Modifiable;
  if (!optional) result = result.notNull();
  if (defaultValue !== undefined) result = result.default(defaultValue);
  return result as ColumnBuilder;
}

function decimalScale(field: Field): number {
  return (field.options as { scale?: number }).scale ?? 2;
}

/**
 * `decimal` columns store integer minor units (D-006) but expose major units everywhere else, so
 * conversion happens here rather than leaking into the query layer.
 */
function decimalColumn(name: string, scale: number): unknown {
  const factor = 10 ** scale;
  return customType<{ data: number; driverData: number }>({
    dataType: () => "integer",
    fromDriver: (value) => value / factor,
    toDriver: (value) => Math.round(value * factor),
  })(name);
}

function defaultFor(field: Field): unknown {
  const value = (field.options as { default?: unknown }).default;
  if (value === undefined) return undefined;
  switch (field.kind) {
    case "datetime":
      if (value === "now") return TIMESTAMP_DEFAULT;
      if (value instanceof Date) return value;
      return new Date(value as number);
    case "decimal":
      return value;
    default:
      return value;
  }
}

function concreteColumn(field: Field, name: string): unknown {
  switch (field.kind) {
    case "integer":
      return integer(name);
    case "decimal":
      return decimalColumn(name, decimalScale(field));
    case "boolean":
      return integer(name, { mode: "boolean" });
    case "datetime":
      return integer(name, { mode: "timestamp_ms" });
    case "json":
      return text(name, { mode: "json" });
    case "manyToMany":
      throw new Error("manyToMany fields do not map to columns.");
    default:
      return text(name);
  }
}

/**
 * Builds a Drizzle column for a model field.
 *
 * Values are stored exactly as the migration engine declares them: `decimal` as integer minor
 * units, `boolean` as `0`/`1`, `datetime` as epoch milliseconds exposed as a `Date`, and `json` as
 * serialized `TEXT`. Conversion of decimals to major units happens in the query layer.
 */
function buildColumn(property: string, field: Field): ColumnBuilder {
  const optional = (field.options as { optional?: boolean }).optional === true;
  return applyModifiers(concreteColumn(field, columnFor(property)), optional, defaultFor(field));
}

function automaticColumns(): Record<string, ColumnBuilder> {
  return {
    id: applyModifiers(text("id").primaryKey(), false, undefined),
    createdAt: applyModifiers(
      integer(columnFor("createdAt"), { mode: "timestamp_ms" }),
      false,
      TIMESTAMP_DEFAULT,
    ),
    updatedAt: applyModifiers(
      integer(columnFor("updatedAt"), { mode: "timestamp_ms" }),
      false,
      TIMESTAMP_DEFAULT,
    ),
  };
}

/**
 * Builds the Drizzle table for a model at runtime from its definition, so the model definition
 * stays the single source of truth and no schema file has to be generated and kept in sync.
 *
 * Foreign keys are intentionally absent: SQLite enforces them through the SQL the migration engine
 * emits, and Drizzle does not need them for query building. Relation metadata arrives with the
 * query API in M2.
 */
export function buildTable(model: AnyModel): SQLiteTable {
  const columns: Record<string, ColumnBuilder> = automaticColumns();
  for (const [property, field] of Object.entries(model.fields)) {
    if (field.kind === "manyToMany") continue;
    columns[property] = buildColumn(property, field);
  }
  return sqliteTable(model.tableName, columns) as unknown as SQLiteTable;
}
