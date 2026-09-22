import { collectRegistry, type AnyModel, type ClangoConfig, type Registry } from "@clango/core";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import { buildTable } from "./schema";
import type { DatabaseDriver } from "./router";

export {
  bindingForTenant,
  createD1Router,
  createRouter,
  d1DriverFactory,
  isDatabaseRouter,
  modelsOf,
  tenantFromRequest,
  type DatabaseDriver,
  type DatabaseRouter,
  type DriverDialect,
  type DriverFactory,
  type RouterOptions,
} from "./router";
export { clientForDriver, drizzleOverSession, type DrizzleD1Database } from "./client";
export { buildTable, quoteIdentifier, TIMESTAMP_DEFAULT } from "./schema";

/** Drizzle tables for every model in a project, indexed by model name and by table name. */
export interface DatabaseSchema {
  /** Drizzle table for a qualified model name, for example `"blog.Post"`. */
  table(modelName: string): SQLiteTable;
  /** Drizzle table for a SQL table name, for example `"blog_post"`. */
  tableByName(tableName: string): SQLiteTable;
  /** Every table in the project, keyed by qualified model name. */
  readonly byModel: ReadonlyMap<string, SQLiteTable>;
}

/**
 * Builds the runtime Drizzle schema for every model in the registry.
 *
 * Throws when asked for a model that is not part of the project, so typos surface immediately
 * instead of turning into `undefined` queries.
 */
export function buildSchema(registry: Registry): DatabaseSchema {
  const byModel = new Map<string, SQLiteTable>();
  const byTable = new Map<string, SQLiteTable>();

  for (const { model } of registry.models) {
    const table = buildTable(model);
    byModel.set(model.name, table);
    byTable.set(model.tableName, table);
  }

  function require(map: ReadonlyMap<string, SQLiteTable>, key: string, kind: string): SQLiteTable {
    const table = map.get(key);
    if (table === undefined) {
      throw new Error(`No ${kind} "${key}" is registered in this project.`);
    }
    return table;
  }

  return {
    byModel,
    table: (modelName: string) => require(byModel, modelName, "model"),
    tableByName: (tableName: string) => require(byTable, tableName, "table"),
  };
}

/** Convenience helper returning the Drizzle tables for a whole project configuration. */
export function schemaFor(config: ClangoConfig): DatabaseSchema {
  return buildSchema(collectRegistry(config));
}

/** Creates a Drizzle client for a single D1 database. */
export function createDrizzle(driver: DatabaseDriver): DrizzleD1Database {
  return drizzle(driver.db);
}

/** Re-exported so consumers can type model values without importing `@clango/core` directly. */
export type { AnyModel };
