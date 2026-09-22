import {
  ClangoError,
  DEFAULT_TENANT_HEADER,
  collectRegistry,
  tenantBindingFor,
  type AnyModel,
  type ClangoConfig,
  type Registry,
} from "@clango/core";

/**
 * Database routing.
 *
 * Models never touch `env` directly — they ask the router, which is what lets an app move between
 * databases, a tenant be served from its own database, and a future Postgres driver be plugged in
 * without touching a single model definition (D-013).
 */

/** The raw handle the query layer runs against. */
export type DriverDialect = "d1";

/** A database resolved from the Worker environment. */
export interface DatabaseDriver {
  /** Logical database name used in `defineConfig`, for example `DB_MAIN`. */
  readonly name: string;
  /** Binding name actually used, which for a tenant is the tenant's own binding. */
  readonly binding: string;
  readonly dialect: DriverDialect;
  /** The binding, for raw SQL and `batch`. */
  readonly db: D1Database;
  /**
   * A session for this driver.
   *
   * Sessions give sequential consistency — reads see this request's earlier writes — and, once read
   * replication is enabled on the database, they are what routes reads to a nearby replica. They are
   * cheap to open and are meant to be created once per request, not reused across requests.
   *
   * Safe to call on a database without read replication: queries then run on the primary.
   */
  session(): D1DatabaseSession;
}

/** Builds a driver. Swapping this is how a non-D1 driver would be introduced. */
export type DriverFactory = (options: {
  readonly name: string;
  readonly binding: string;
  readonly env: object;
}) => DatabaseDriver;

/**
 * Resolves a logical database name to its driver.
 *
 * With tenancy enabled the router is created per request, because which binding serves a model
 * depends on who is asking.
 */
export interface DatabaseRouter {
  database(name: string): DatabaseDriver;
  /** The registry the router was built from, so callers do not rebuild it. */
  readonly registry: Registry;
}

/** Options accepted by {@link createRouter}. */
export interface RouterOptions {
  /** Tenant slug. When present, bindings resolve through `tenantBindingFor`. */
  readonly tenant?: string;
  /** Overrides how a driver is built. Defaults to {@link d1DriverFactory}. */
  readonly driverFactory?: DriverFactory;
}

function isD1Database(value: unknown): value is D1Database {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { prepare?: unknown }).prepare === "function" &&
    typeof (value as { batch?: unknown }).batch === "function"
  );
}

/** The default driver: a D1 binding plus its session API. */
export const d1DriverFactory: DriverFactory = ({ name, binding, env }) => {
  const bound = (env as Record<string, unknown>)[binding];
  if (!isD1Database(bound)) {
    throw new ClangoError(
      `Binding "${binding}" for database "${name}" is missing or is not a D1 database. ` +
        "Check `wrangler.jsonc` and rerun `wrangler types`.",
    );
  }
  return {
    name,
    binding,
    dialect: "d1",
    db: bound,
    session: () => bound.withSession(),
  };
};

/** Reads the tenant slug from a request using the configured strategy. */
export function tenantFromRequest(config: ClangoConfig, request: Request): string | null {
  const header = config.tenants?.header ?? DEFAULT_TENANT_HEADER;
  const value = request.headers.get(header);
  if (value === null || value.trim().length === 0) return null;
  return value.trim().toLowerCase();
}

/**
 * Creates a router for one environment, optionally scoped to a tenant.
 *
 * Every database a model actually uses must be bound: for a tenant that means the tenant-specific
 * binding exists in `wrangler.jsonc`, which is exactly why tenant count is bounded by the binding
 * ceiling (D-055).
 */
export function createRouter(
  config: ClangoConfig,
  env: object,
  options: RouterOptions = {},
): DatabaseRouter {
  const registry = collectRegistry(config);
  const factory = options.driverFactory ?? d1DriverFactory;
  const drivers = new Map<string, DatabaseDriver>();

  for (const name of new Set(registry.models.map((entry) => entry.database))) {
    const declared = config.databases?.[name];
    if (declared === undefined) {
      throw new ClangoError(
        `Database "${name}" is used by a model but is not declared in \`defineConfig({ databases })\`.`,
      );
    }
    const binding =
      options.tenant === undefined
        ? declared.binding
        : tenantBindingFor(config, name, options.tenant);
    drivers.set(name, factory({ name, binding, env }));
  }

  return {
    registry,
    database(name: string): DatabaseDriver {
      const driver = drivers.get(name);
      if (driver === undefined) {
        throw new ClangoError(`Database "${name}" is not used by any model in this project.`);
      }
      return driver;
    },
  };
}

/** Convenience wrapper for the common single-environment case. */
export function createD1Router(
  config: ClangoConfig,
  env: object,
  options: RouterOptions = {},
): DatabaseRouter {
  return createRouter(config, env, options);
}

/** Builds the tenant's binding name without creating a driver. */
export function bindingForTenant(config: ClangoConfig, database: string, tenant: string): string {
  return tenantBindingFor(config, database, tenant);
}

/** Type guard used by callers that accept a router or build one lazily. */
export function isDatabaseRouter(value: unknown): value is DatabaseRouter {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as DatabaseRouter).database === "function"
  );
}

/** Model names a router serves, in registry order. */
export function modelsOf(router: DatabaseRouter): readonly AnyModel[] {
  return router.registry.models.map((entry) => entry.model);
}
