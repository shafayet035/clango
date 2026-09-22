import {
  resolveField,
  searchableFields,
  type AnyModel,
  type Field,
  type FieldKind,
} from "@clango/core";
import { quoteIdentifier } from "@clango/orm";
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, ne, sql, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { getTableColumns } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

import { decodeCursor, encodeCursor } from "./cursor";
import { badRequest } from "./errors";

/** Rows returned per page when `limit` is omitted. */
export const DEFAULT_LIMIT = 25;

/** Largest page a client may request. */
export const MAX_LIMIT = 100;

/** Exact counts are reported up to this many rows; beyond it the count is reported as capped. */
export const COUNT_CAP = 10_000;

const MAX_ORDER_KEYS = 3;
const RESERVED_PARAMS: readonly string[] = ["cursor", "limit", "search", "order"];

/** Comparison operators accepted in filter query parameters. */
export type FilterOp = "eq" | "ne" | "in" | "gt" | "gte" | "lt" | "lte";

/** One key of a list ordering. `id` is always appended as a tie breaker. */
export interface OrderKey {
  readonly property: string;
  readonly direction: "asc" | "desc";
  readonly kind: FieldKind;
}

interface Filter {
  readonly property: string;
  readonly op: FilterOp;
  readonly value: unknown;
}

interface ParsedListQuery {
  readonly filters: readonly Filter[];
  readonly order: readonly OrderKey[];
  readonly limit: number;
  readonly cursor?: { readonly order: readonly string[]; readonly values: readonly unknown[] };
  readonly search: string | null;
}

/** Pagination metadata returned alongside a page of rows. */
export interface ListPage {
  /** Exact row count up to {@link COUNT_CAP}. */
  readonly count: number;
  /** `true` when the real count is at least {@link COUNT_CAP}, so `count` is a lower bound. */
  readonly countCapped: boolean;
  readonly limit: number;
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

/** The body of a list response. */
export interface ListResult {
  readonly data: readonly Record<string, unknown>[];
  readonly page: ListPage;
}

function isFilterable(kind: FieldKind): boolean {
  switch (kind) {
    case "string":
    case "email":
    case "slug":
    case "url":
    case "integer":
    case "decimal":
    case "boolean":
    case "datetime":
    case "date":
    case "choice":
    case "foreignKey":
      return true;
    default:
      return false;
  }
}

function isOrderable(kind: FieldKind): boolean {
  return isFilterable(kind);
}

function allowedOps(kind: FieldKind): readonly FilterOp[] {
  switch (kind) {
    case "integer":
    case "decimal":
    case "datetime":
    case "date":
    case "string":
    case "email":
    case "slug":
    case "url":
      return ["eq", "ne", "in", "gt", "gte", "lt", "lte"];
    default:
      return ["eq", "ne", "in"];
  }
}

function coerceScalar(field: Field, raw: string): unknown {
  switch (field.kind) {
    case "integer": {
      const value = Number(raw);
      if (!Number.isInteger(value)) throw badRequest(`Expected an integer, received "${raw}".`);
      return value;
    }
    case "decimal": {
      const value = Number(raw);
      if (!Number.isFinite(value)) throw badRequest(`Expected a number, received "${raw}".`);
      return value;
    }
    case "boolean": {
      if (raw === "true" || raw === "1") return true;
      if (raw === "false" || raw === "0") return false;
      throw badRequest(`Expected a boolean, received "${raw}".`);
    }
    case "datetime": {
      const value = Number.isNaN(Number(raw)) ? new Date(raw) : new Date(Number(raw));
      if (Number.isNaN(value.getTime())) {
        throw badRequest(`Expected a timestamp, received "${raw}".`);
      }
      return value;
    }
    case "date": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        throw badRequest(`Expected a date formatted as YYYY-MM-DD, received "${raw}".`);
      }
      return raw;
    }
    case "choice": {
      const values = field.values ?? [];
      if (!values.includes(raw)) {
        throw badRequest(
          `Expected one of ${values.map((v) => `"${v}"`).join(", ")}, received "${raw}".`,
        );
      }
      return raw;
    }
    default:
      return raw;
  }
}

function parseFilters(model: AnyModel, params: URLSearchParams): Filter[] {
  const filters: Filter[] = [];
  for (const [key, raw] of params.entries()) {
    if (RESERVED_PARAMS.includes(key)) continue;
    const [property, op = "eq"] = key.split(".") as [string, FilterOp | undefined];
    const field = resolveField(model.fields, property);
    if (field === undefined) {
      throw badRequest(`Unknown filter "${property}".`);
    }
    if (!isFilterable(field.kind)) {
      throw badRequest(`Cannot filter by "${property}".`);
    }
    const resolvedOp = op ?? "eq";
    if (!allowedOps(field.kind).includes(resolvedOp)) {
      throw badRequest(`Operator "${resolvedOp}" is not supported for "${property}".`);
    }
    if (resolvedOp === "in") {
      const values = raw
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      if (values.length === 0) throw badRequest(`Filter "${key}" needs at least one value.`);
      filters.push({
        property,
        op: resolvedOp,
        value: values.map((entry) => coerceScalar(field, entry)),
      });
      continue;
    }
    filters.push({ property, op: resolvedOp, value: coerceScalar(field, raw) });
  }
  return filters;
}

function parseLimit(params: URLSearchParams): number {
  const raw = params.get("limit");
  if (raw === null) return DEFAULT_LIMIT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw badRequest(`limit must be an integer between 1 and ${MAX_LIMIT}.`);
  }
  return value;
}

function parseOrder(model: AnyModel, params: URLSearchParams): OrderKey[] {
  const explicit = params.get("order");
  const specs =
    explicit === null
      ? (model.meta.ordering ?? []).filter((spec) => {
          const property = spec.startsWith("-") ? spec.slice(1) : spec;
          const field = resolveField(model.fields, property);
          return field !== undefined && isOrderable(field.kind);
        })
      : explicit
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);

  const keys: OrderKey[] = [];
  for (const spec of specs) {
    const direction = spec.startsWith("-") ? "desc" : "asc";
    const property = spec.startsWith("-") ? spec.slice(1) : spec;
    const field = resolveField(model.fields, property);
    if (field === undefined) {
      if (explicit === null) continue;
      throw badRequest(`Cannot order by "${property}": no such field.`);
    }
    if (!isOrderable(field.kind)) {
      if (explicit === null) continue;
      throw badRequest(`Cannot order by "${property}".`);
    }
    if (keys.length >= MAX_ORDER_KEYS) {
      throw badRequest(`At most ${MAX_ORDER_KEYS} order keys are allowed.`);
    }
    keys.push({ property, direction, kind: field.kind });
  }

  if (!keys.some((key) => key.property === "id")) {
    keys.push({ property: "id", direction: "asc", kind: "string" });
  }
  return keys;
}

/**
 * Builds an FTS5 MATCH expression from free text.
 *
 * Every token is wrapped in an FTS5 string literal, so operators and quotes in user input cannot
 * change the query; the final token gets a `*` for prefix matching as the user types.
 */
export function buildMatchExpression(term: string): string {
  const tokens = term
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) throw badRequest("search must not be empty.");
  return tokens
    .map((token, index) => {
      const quoted = `"${token.replace(/"/g, '""')}"`;
      return index === tokens.length - 1 ? `${quoted}*` : quoted;
    })
    .join(" AND ");
}

/** Returns the ordering signature stored in cursors, for example `["-publishedAt", "id"]`. */
export function orderSignature(order: readonly OrderKey[]): string[] {
  return order.map((key) => `${key.direction === "desc" ? "-" : ""}${key.property}`);
}

function parseListQuery(model: AnyModel, params: URLSearchParams): ParsedListQuery {
  const search = params.get("search");
  if (search !== null) {
    if (search.trim().length === 0) throw badRequest("search must not be empty.");
    if (searchableFields(model).length === 0) {
      throw badRequest("This model does not support search.");
    }
  }

  const rawCursor = params.get("cursor");
  const query: {
    filters: readonly Filter[];
    order: readonly OrderKey[];
    limit: number;
    cursor?: { readonly order: readonly string[]; readonly values: readonly unknown[] };
    search: string | null;
  } = {
    filters: parseFilters(model, params),
    order: parseOrder(model, params),
    limit: parseLimit(params),
    search,
  };

  if (rawCursor !== null) {
    const cursor = decodeCursor(rawCursor);
    if (orderSignature(query.order).join(",") !== cursor.order.join(",")) {
      throw badRequest("The cursor was issued for a different ordering.");
    }
    query.cursor = cursor;
  }

  return query;
}

function coerceCursorValue(key: OrderKey, value: unknown): unknown {
  if (value === null) return null;
  switch (key.kind) {
    case "datetime": {
      const date = value instanceof Date ? value : new Date(value as string | number);
      if (Number.isNaN(date.getTime())) throw badRequest("The cursor is not valid.");
      return date;
    }
    case "boolean":
      return value === true || value === 1 || value === "1";
    case "integer":
    case "decimal": {
      const number = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(number)) throw badRequest("The cursor is not valid.");
      return number;
    }
    default:
      return value;
  }
}

function joinSql(parts: readonly SQL[], separator: SQL): SQL {
  const [first, ...rest] = parts;
  if (first === undefined) return sql``;
  return rest.reduce((accumulator, part) => sql`${accumulator}${separator}${part}`, first);
}

function filterCondition(column: SQLiteColumn, filter: Filter): SQL {
  switch (filter.op) {
    case "eq":
      return eq(column, filter.value);
    case "ne":
      return ne(column, filter.value);
    case "in":
      return inArray(column, filter.value as unknown[]);
    case "gt":
      return gt(column, filter.value);
    case "gte":
      return gte(column, filter.value);
    case "lt":
      return lt(column, filter.value);
    case "lte":
      return lte(column, filter.value);
  }
}

/**
 * Converts a sort value to the representation D1 expects.
 *
 * Values placed in a raw `sql` fragment bypass Drizzle's column mapping, so a `Date` or `boolean`
 * would otherwise be handed to D1 as-is and rejected.
 */
export function toDriverValue(kind: FieldKind, value: unknown): unknown {
  if (value === null) return null;
  switch (kind) {
    case "datetime":
      return value instanceof Date ? value.getTime() : value;
    case "boolean":
      return value === true ? 1 : 0;
    default:
      return value;
  }
}

/**
 * Builds a keyset predicate for "rows after the cursor".
 *
 * Handles mixed sort directions and nulls. SQLite sorts `NULL` first for `ASC` and last for `DESC`,
 * so a value can be "after" the cursor in three ways: a plain comparison, a null cursor followed by
 * a non-null value (ascending), or a non-null cursor followed by a null value (descending).
 */
export function keysetCondition(
  columns: Readonly<Record<string, SQLiteColumn>>,
  order: readonly OrderKey[],
  values: readonly unknown[],
): SQL {
  const clauses: SQL[] = [];
  for (let index = 0; index < order.length; index++) {
    const key = order[index] as OrderKey;
    const column = columns[key.property] as SQLiteColumn;
    const value = values[index];
    const parts: SQL[] = [];
    const driverValue = toDriverValue(key.kind, value);
    for (let prefix = 0; prefix < index; prefix++) {
      const earlier = order[prefix] as OrderKey;
      parts.push(
        sql`${columns[earlier.property] as SQLiteColumn} IS ${toDriverValue(earlier.kind, values[prefix])}`,
      );
    }
    parts.push(
      key.direction === "asc"
        ? sql`(${column} > ${driverValue} OR (${driverValue} IS NULL AND ${column} IS NOT NULL))`
        : sql`(${column} < ${driverValue} OR (${driverValue} IS NOT NULL AND ${column} IS NULL))`,
    );
    clauses.push(sql`(${joinSql(parts, sql` AND `)})`);
  }
  return sql`(${joinSql(clauses, sql` OR `)})`;
}

function searchCondition(model: AnyModel, idColumn: SQLiteColumn, term: string): SQL {
  const fts = quoteIdentifier(`${model.tableName}_fts`);
  return sql`${idColumn} IN (SELECT ${sql.raw('"id"')} FROM ${sql.raw(fts)} WHERE ${sql.raw(fts)} MATCH ${buildMatchExpression(term)})`;
}

/** Options accepted by {@link listRows}. */
export interface ListOptions {
  readonly model: AnyModel;
  readonly table: SQLiteTable;
  readonly db: DrizzleD1Database;
  readonly params: URLSearchParams;
  /** Overrides {@link COUNT_CAP}. Useful for embedding Clango lists in an API of your own. */
  readonly countCap?: number;
}

/**
 * Runs a list query: bounded count, keyset pagination, filters and FTS5 search.
 *
 * The count is capped at {@link COUNT_CAP} rows so the endpoint cannot be made to scan an entire
 * table, and the page reads one row beyond `limit` to detect whether a next page exists.
 */
export async function listRows(options: ListOptions): Promise<ListResult> {
  const { model, table, db, params, countCap = COUNT_CAP } = options;
  const columns = getTableColumns(table) as unknown as Record<string, SQLiteColumn>;
  const query = parseListQuery(model, params);

  const conditions: SQL[] = [];
  if (query.search !== null) {
    conditions.push(searchCondition(model, columns["id"] as SQLiteColumn, query.search));
  }
  for (const filter of query.filters) {
    conditions.push(filterCondition(columns[filter.property] as SQLiteColumn, filter));
  }
  if (query.cursor !== undefined) {
    const values = query.cursor.values.map((value, index) =>
      coerceCursorValue(query.order[index] as OrderKey, value),
    );
    conditions.push(keysetCondition(columns, query.order, values));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const ordering = query.order.map((key) => {
    const column = columns[key.property] as SQLiteColumn;
    return key.direction === "desc" ? desc(column) : asc(column);
  });

  const pageQuery = db
    .select()
    .from(table)
    .where(where)
    .orderBy(...ordering)
    .limit(query.limit + 1);

  const countQuery = db.select({ count: sql<number>`count(*)` }).from(
    db
      .select({ one: sql<number>`1` })
      .from(table)
      .where(where)
      .limit(countCap + 1)
      .as("clango_count"),
  );

  const [rows, counted] = await db.batch([pageQuery, countQuery]);

  const hasMore = rows.length > query.limit;
  const data = (hasMore ? rows.slice(0, query.limit) : rows) as Record<string, unknown>[];
  const rawCount = Number((counted[0] as { count?: unknown } | undefined)?.count ?? 0);
  const last = data[data.length - 1];

  return {
    data,
    page: {
      count: Math.min(rawCount, countCap),
      countCapped: rawCount > countCap,
      limit: query.limit,
      hasMore,
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor({
              order: orderSignature(query.order),
              values: query.order.map((key) => last[key.property]),
            })
          : null,
    },
  };
}
