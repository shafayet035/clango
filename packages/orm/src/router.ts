import { ClangoError, collectRegistry, type ClangoConfig, type Registry } from "@clango/core";

/** A D1 database resolved from the Worker environment. */
export interface DatabaseDriver {
  /** Logical database name used in `defineConfig`, for example `DB_MAIN`. */
  readonly name: string;
  /** Binding name declared in `wrangler.jsonc`, for example `DB_MAIN`. */
  readonly binding: string;
  readonly db: D1Database;
}

/**
 * Resolves a logical database name to its driver. Models never touch `env` directly — they ask the
 * router, which is what will let M6 route individual apps to separate or per-tenant databases.
 */
export interface DatabaseRouter {
  database(name: string): DatabaseDriver;
}

function isD1Database(value: unknown): value is D1Database {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { prepare?: unknown }).prepare === "function" &&
    typeof (value as { batch?: unknown }).batch === "function"
  );
}

/**
 * Creates a router backed by D1 bindings.
 *
 * @param config - The project configuration produced by `defineConfig`.
 * @param env - The Worker environment. Every database the project actually uses must be bound.
 */
export function createD1Router(config: ClangoConfig, env: object): DatabaseRouter {
  const registry: Registry = collectRegistry(config);
  const bindings = env as Record<string, unknown>;
  const databases = new Map<string, DatabaseDriver>();

  for (const name of new Set(registry.models.map((entry) => entry.database))) {
    const database = config.databases?.[name];
    if (database === undefined) {
      throw new ClangoError(
        `Database "${name}" is used by a model but is not declared in \`defineConfig({ databases })\`.`,
      );
    }
    const bound = bindings[database.binding];
    if (!isD1Database(bound)) {
      throw new ClangoError(
        `Binding "${database.binding}" for database "${name}" is missing or is not a D1 database. ` +
          "Check `wrangler.jsonc` and rerun `wrangler types`.",
      );
    }
    databases.set(name, { name, binding: database.binding, db: bound });
  }

  return {
    database(name: string): DatabaseDriver {
      const driver = databases.get(name);
      if (driver === undefined) {
        throw new ClangoError(`Database "${name}" is not used by any model in this project.`);
      }
      return driver;
    },
  };
}
