import {
  ADMIN_LOG_MODEL_NAME,
  ClangoError,
  collectRegistry,
  columnFor,
  newUlid,
  permissionCodename,
  type PermissionAction,
  type AnyModel,
  type ClangoConfig,
  type RegisteredModel,
  type Registry,
} from "@clango/core";
import {
  ApiError,
  badRequest,
  buildValidation,
  installFallbacks,
  listRows,
  notFound,
  readJsonBody,
  validationFailed,
} from "@clango/api";
import {
  buildSchema,
  createD1Router,
  quoteIdentifier,
  type DatabaseRouter,
  type DatabaseSchema,
} from "@clango/orm";
import { eq, getTableColumns } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";

import {
  Authorization,
  can,
  clangoAuth,
  requireStaff,
  type AuthorizedUser,
  type ClangoAuthVariables,
} from "@clango/auth";

import { cascadePreview } from "./cascade";
import { adminLogValues, buildUpdateDiff } from "./log";
import { adminKeyFor, buildMeta, labelFieldOf } from "./meta";
import { adminConfigFor, type AdminActionContext } from "./registry";

/** Base path of a model's admin API routes, for example `/admin/api/blog/post`. */
export function adminApiPathFor(model: AnyModel): string {
  return `/admin/api/${adminKeyFor(model)}`;
}

/** Maximum length of a `LIKE` prefix, safely inside D1's 50-byte pattern cap (D-008). */
const MAX_LIKE_BYTES = 40;

/** Rows an action may touch in one call. */
const MAX_ACTION_IDS = 500;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function asRecords(rows: unknown): Record<string, unknown>[] {
  return rows as Record<string, unknown>[];
}

/** Maximum ids accepted by a single label lookup. */
const MAX_OPTION_IDS = 100;

/** Builds the `{ id, label }` pairs used by relation pickers and list views. */
async function selectOptions(
  driver: D1Database,
  model: AnyModel,
  searchable: readonly string[],
  query: string,
  limit: number,
  ids: readonly string[] = [],
): Promise<readonly { id: string; label: string }[]> {
  const label = labelFieldOf(model);
  const labelColumn = quoteIdentifier(label === "id" ? "id" : columnFor(label));
  const idColumn = quoteIdentifier("id");
  const table = quoteIdentifier(model.tableName);

  const toOptions = (rows: readonly { id: string; label: string | null }[]) =>
    rows.map((row) => ({ id: row.id, label: row.label ?? row.id }));

  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(", ");
    const rows = await driver
      .prepare(
        `SELECT ${idColumn} AS id, ${labelColumn} AS label FROM ${table} ` +
          `WHERE ${idColumn} IN (${placeholders})`,
      )
      .bind(...ids)
      .all<{ id: string; label: string | null }>();
    return toOptions(rows.results);
  }

  if (query.length === 0) {
    const rows = await driver
      .prepare(
        `SELECT ${idColumn} AS id, ${labelColumn} AS label FROM ${table} ` +
          `ORDER BY ${labelColumn} LIMIT ?`,
      )
      .bind(limit)
      .all<{ id: string; label: string | null }>();
    return toOptions(rows.results);
  }

  if (searchable.length > 0) {
    const fts = quoteIdentifier(`${model.tableName}_fts`);
    const match = query
      .split(/\s+/)
      .filter((token) => token.length > 0)
      .map((token) => `"${token.replace(/"/g, '""')}"`)
      .join(" AND ");
    const rows = await driver
      .prepare(
        `SELECT p.${idColumn} AS id, p.${labelColumn} AS label FROM ${table} p ` +
          `WHERE p.${idColumn} IN (SELECT ${idColumn} FROM ${fts} WHERE ${fts} MATCH ?) LIMIT ?`,
      )
      .bind(match, limit)
      .all<{ id: string; label: string | null }>();
    return toOptions(rows.results);
  }

  if (byteLength(query) > MAX_LIKE_BYTES) {
    throw badRequest(`Search text must be at most ${MAX_LIKE_BYTES} bytes.`);
  }
  const rows = await driver
    .prepare(
      `SELECT ${idColumn} AS id, ${labelColumn} AS label FROM ${table} ` +
        `WHERE ${labelColumn} LIKE ? ESCAPE '\\' ORDER BY ${labelColumn} LIMIT ?`,
    )
    .bind(`${escapeLike(query)}%`, limit)
    .all<{ id: string; label: string | null }>();
  return toOptions(rows.results);
}

interface AdminContext<TBindings extends object> {
  readonly app: Hono<{ Bindings: TBindings; Variables: ClangoAuthVariables }>;
  readonly registry: Registry;
  readonly logTable: SQLiteTable;
  readonly databaseFor: (env: object, database: string) => DrizzleD1Database;
  readonly bindingFor: (env: object, database: string) => D1Database;
  readonly authEnabled: boolean;
}

function registerModelRoutes<TBindings extends object>(
  context: AdminContext<TBindings>,
  entry: RegisteredModel,
): void {
  const { app, registry, logTable, databaseFor, bindingFor, authEnabled } = context;
  const model = entry.model;

  /**
   * Enforces a model permission.
   *
   * Returns the resolved user so handlers can attribute the audit log entry. With auth disabled the
   * admin behaves as it did before M4: open, and logged with a null user.
   */
  function authorize(
    c: { get: (key: "clangoUser") => AuthorizedUser | null },
    action: PermissionAction,
  ): AuthorizedUser | null {
    const user = c.get("clangoUser");
    if (!authEnabled) return null;
    const codename = permissionCodename(model, action);
    if (!can(user, codename)) {
      throw new ApiError(403, "forbidden", `Missing permission "${codename}".`);
    }
    return user;
  }

  const userId = (user: AuthorizedUser | null): string | null => user?.id ?? null;
  const base = adminApiPathFor(model);
  const table = buildSchema(registry).table(model.name);
  const validation = buildValidation(model);
  const columns = getTableColumns(table) as unknown as Record<string, SQLiteColumn>;
  const idColumn = columns["id"] as SQLiteColumn;
  const db = (env: object) => databaseFor(env, entry.database);
  const binding = (env: object) => bindingFor(env, entry.database);

  /** Applies the admin's configured ordering when the client does not ask for one. */
  function listParams(request: Request): URLSearchParams {
    const params = new URL(request.url).searchParams;
    if (!params.has("order")) {
      const ordering = adminConfigFor(model).ordering ?? model.meta.ordering;
      if (ordering !== undefined && ordering.length > 0) params.set("order", ordering.join(","));
    }
    return params;
  }

  app.get(base, async (c) => {
    authorize(c, "view");
    const result = await listRows({
      model,
      table,
      db: db(c.env),
      params: listParams(c.req.raw),
    });
    return c.json(result);
  });

  app.get(`${base}/options`, async (c) => {
    authorize(c, "view");
    const params = new URL(c.req.url).searchParams;
    const rawLimit = params.get("limit");
    const limit = rawLimit === null ? 20 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw badRequest("limit must be an integer between 1 and 100.");
    }
    const searchable = Object.entries(model.fields)
      .filter(([, field]) => (field.options as { searchable?: boolean }).searchable === true)
      .map(([property]) => property);
    const rawIds = (params.get("ids") ?? "").trim();
    const ids =
      rawIds.length === 0
        ? []
        : [
            ...new Set(
              rawIds
                .split(",")
                .map((id) => id.trim())
                .filter((id) => id.length > 0),
            ),
          ];
    if (ids.length > MAX_OPTION_IDS) {
      throw badRequest(`At most ${MAX_OPTION_IDS} ids may be looked up at once.`);
    }

    const data = await selectOptions(
      binding(c.env),
      model,
      searchable,
      (params.get("q") ?? "").trim(),
      limit,
      ids,
    );
    return c.json({ data });
  });

  app.post(`${base}/actions/:action`, async (c) => {
    const user = authorize(c, "change");
    const name = c.req.param("action");
    const action = (adminConfigFor(model).actions ?? []).find(
      (candidate) => candidate.name === name,
    );
    if (action === undefined) throw notFound(`${model.name} action`, name);

    const body = (await readJsonBody(c.req.raw)) as { ids?: unknown };
    if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== "string")) {
      throw badRequest('Expected a body of the form { "ids": ["…"] }.');
    }
    const ids = [...new Set(body.ids as string[])].slice(0, MAX_ACTION_IDS);
    if (ids.length === 0) throw badRequest("Select at least one row.");

    const actionContext: AdminActionContext = { model, userId: userId(user), db: db(c.env) };
    await action.handler(ids, actionContext);
    return c.json({ data: { action: action.name, affected: ids.length } });
  });

  app.post(base, async (c) => {
    const user = authorize(c, "add");
    const parsed = validation.create.safeParse(await readJsonBody(c.req.raw));
    if (!parsed.success) throw validationFailed(parsed.error.issues);

    const provided = parsed.data as Record<string, unknown>;
    const now = new Date();
    const id = typeof provided["id"] === "string" ? provided["id"] : newUlid();
    const record: Record<string, unknown> = { ...provided, id, createdAt: now, updatedAt: now };
    const log = adminLogValues(
      {
        action: "create",
        modelName: model.name,
        objectId: id,
        userId: userId(user),
        diff: provided,
      },
      now,
    );

    const client = db(c.env);
    const results = (await client.batch([
      client.insert(table).values(record).returning(),
      client.insert(logTable).values(log),
    ])) as unknown[];
    return c.json({ data: asRecords(results[0])[0] }, 201, { location: `${base}/${id}` });
  });

  app.get(`${base}/:id/cascade`, async (c) => {
    authorize(c, "delete");
    const id = c.req.param("id");
    const found = await binding(c.env)
      .prepare(
        `SELECT ${quoteIdentifier("id")} AS id FROM ${quoteIdentifier(model.tableName)} ` +
          `WHERE ${quoteIdentifier("id")} = ?`,
      )
      .bind(id)
      .all<{ id: string }>();
    if (found.results.length === 0) throw notFound(model.name, id);

    const related = await cascadePreview({
      registry,
      db: binding(c.env),
      model,
      ids: [id],
    });
    return c.json({ data: { model: model.name, id, related } });
  });

  app.get(`${base}/:id`, async (c) => {
    const id = c.req.param("id");
    const rows = asRecords(
      await db(c.env).select().from(table).where(eq(idColumn, id)).limit(1).all(),
    );
    const row = rows[0];
    if (row === undefined) throw notFound(model.name, id);
    return c.json({ data: row });
  });

  app.patch(`${base}/:id`, async (c) => {
    const user = authorize(c, "change");
    const id = c.req.param("id");
    const parsed = validation.update.safeParse(await readJsonBody(c.req.raw));
    if (!parsed.success) throw validationFailed(parsed.error.issues);

    const provided = Object.fromEntries(
      Object.entries(parsed.data as Record<string, unknown>).filter(
        ([, value]) => value !== undefined,
      ),
    );
    if (Object.keys(provided).length === 0)
      throw badRequest("Provide at least one field to update.");

    const existing = asRecords(
      await db(c.env).select().from(table).where(eq(idColumn, id)).limit(1).all(),
    );
    const before = existing[0];
    if (before === undefined) throw notFound(model.name, id);

    const now = new Date();
    const values = { ...provided, updatedAt: now };
    const diff = buildUpdateDiff(before, values, Object.keys(provided));
    const log = adminLogValues(
      { action: "update", modelName: model.name, objectId: id, userId: userId(user), diff },
      now,
    );

    const client = db(c.env);
    const results = (await client.batch([
      client.update(table).set(values).where(eq(idColumn, id)).returning(),
      client.insert(logTable).values(log),
    ])) as unknown[];
    return c.json({ data: asRecords(results[0])[0] });
  });

  app.delete(`${base}/:id`, async (c) => {
    const user = authorize(c, "delete");
    const id = c.req.param("id");
    const existing = asRecords(
      await db(c.env).select().from(table).where(eq(idColumn, id)).limit(1).all(),
    );
    const before = existing[0];
    if (before === undefined) throw notFound(model.name, id);

    const now = new Date();
    const log = adminLogValues(
      { action: "delete", modelName: model.name, objectId: id, userId: userId(user), diff: before },
      now,
    );
    const client = db(c.env);
    const results = (await client.batch([
      client.delete(table).where(eq(idColumn, id)).returning({ id: idColumn }),
      client.insert(logTable).values(log),
    ])) as unknown[];
    if (asRecords(results[0]).length === 0) throw notFound(model.name, id);
    return c.body(null, 204);
  });
}

/**
 * Builds the admin API: metadata plus CRUD endpoints for every registered model.
 *
 * Every write is recorded in `clango_admin_log` inside the same `db.batch()` as the mutation, so the
 * audit trail cannot drift from the data (D-015). The admin is unauthenticated until M4, which is
 * why `admin.enabled` has to be set explicitly.
 */
export function createAdminApp<TBindings extends object = object>(
  config: ClangoConfig,
): Hono<{ Bindings: TBindings; Variables: ClangoAuthVariables }> {
  const app = new Hono<{ Bindings: TBindings; Variables: ClangoAuthVariables }>();
  const registry = collectRegistry(config);
  const schema: DatabaseSchema = buildSchema(registry);
  const routers = new WeakMap<object, DatabaseRouter>();
  const authEnabled = config.auth?.enabled === true;
  const authorization = new Authorization({ registry, schema });

  const logEntry = registry.byName.get(ADMIN_LOG_MODEL_NAME);
  if (logEntry === undefined) {
    throw new ClangoError("The admin requires `admin: { enabled: true }` in defineConfig.");
  }
  for (const entry of registry.models) {
    if (entry.model.name === ADMIN_LOG_MODEL_NAME) continue;
    if (entry.database !== logEntry.database) {
      throw new ClangoError(
        `The admin log lives in "${logEntry.database}" but "${entry.model.name}" lives in ` +
          `"${entry.database}". The audit log must share a database with the models it records.`,
      );
    }
  }

  /** Framework tables (audit log, authorization) all live in one database. */
  const systemDatabase = logEntry.database;

  function routerFor(env: object): DatabaseRouter {
    let router = routers.get(env);
    if (router === undefined) {
      router = createD1Router(config, env);
      routers.set(env, router);
    }
    return router;
  }

  const context: AdminContext<TBindings> = {
    app,
    registry,
    logTable: schema.table(ADMIN_LOG_MODEL_NAME),
    databaseFor: (env, database) => drizzle(routerFor(env).database(database).db),
    bindingFor: (env, database) => routerFor(env).database(database).db,
    authEnabled,
  };

  if (authEnabled) {
    // Middleware must be registered before the routes it guards: Hono runs handlers in registration
    // order, so middleware added afterwards never runs for them.
    app.use(
      "/admin/api/*",
      clangoAuth<TBindings>({
        config,
        authorization,
        databaseFor: (env: object) => drizzle(routerFor(env).database(systemDatabase).db),
      }),
    );
    // The SPA itself stays reachable so it can explain the 401; the API is what holds the data.
    app.use("/admin/api/*", requireStaff<TBindings>());
  }

  for (const entry of registry.models) {
    if (entry.model.name === ADMIN_LOG_MODEL_NAME) continue;
    registerModelRoutes(context, entry);
  }

  app.get("/admin/api/meta", (c) => {
    const user = c.get("clangoUser") ?? null;
    return c.json(
      buildMeta(config, {
        registry,
        user:
          user === null
            ? null
            : { id: user.id, isStaff: user.isStaff, isSuperuser: user.isSuperuser },
        ...(authEnabled ? { allows: (codename: string) => can(user, codename) } : {}),
      }),
    );
  });

  installFallbacks(app, ["/api/", "/admin/api/"]);
  return app;
}

/** Mounts the admin API onto an existing Hono app and returns it. */
export function mountAdmin<TEnv extends { Bindings: object; Variables: ClangoAuthVariables }>(
  app: Hono<TEnv>,
  config: ClangoConfig,
): Hono<TEnv> {
  app.route("/", createAdminApp<TEnv["Bindings"]>(config));
  installFallbacks(app, ["/api/", "/admin/api/"]);
  return app;
}
