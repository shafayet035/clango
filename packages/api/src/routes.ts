import {
  apiOps,
  collectRegistry,
  newUlid,
  toSnakeCase,
  type AnyModel,
  type ApiOp,
  type ClangoConfig,
} from "@clango/core";
import { buildSchema, createD1Router, type DatabaseRouter, type DatabaseSchema } from "@clango/orm";
import { eq, getTableColumns } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { Hono, type Env } from "hono";

import { badRequest, notFound, toErrorResponse, validationFailed } from "./errors";
import { listRows } from "./query";
import { buildValidation } from "./validation";

/** Base path for a model's generated routes, for example `/api/blog/post`. */
export function apiPathFor(model: AnyModel): string {
  return `/api/${model.appLabel}/${toSnakeCase(model.modelName)}`;
}

/** Parses a request body as JSON, treating an empty body as `{}`. Throws a `400` on bad JSON. */
export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim().length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest("Request body must be valid JSON.");
  }
}

/**
 * Registers the enabled operations for one model.
 *
 * Only operations listed on the model are mounted, so a model exposed for reads cannot be written
 * to by accident: an unregistered method falls through to Hono's `404`.
 */
function registerModel<TBindings extends object, TVariables extends object>(
  app: Hono<{ Bindings: TBindings; Variables: TVariables }>,
  model: AnyModel,
  table: SQLiteTable,
  ops: readonly ApiOp[],
  databaseFor: (env: object) => DrizzleD1Database,
): void {
  const base = apiPathFor(model);
  const validation = buildValidation(model);
  const columns = getTableColumns(table) as unknown as Record<string, SQLiteColumn>;
  const idColumn = columns["id"] as SQLiteColumn;

  if (ops.includes("list")) {
    app.get(base, async (c) => {
      const params = new URL(c.req.url).searchParams;
      const result = await listRows({ model, table, db: databaseFor(c.env), params });
      return c.json(result);
    });
  }

  if (ops.includes("create")) {
    app.post(base, async (c) => {
      const parsed = validation.create.safeParse(await readJsonBody(c.req.raw));
      if (!parsed.success) throw validationFailed(parsed.error.issues);

      const provided = parsed.data as Record<string, unknown>;
      const now = new Date();
      const record: Record<string, unknown> = {
        ...provided,
        id: typeof provided["id"] === "string" ? provided["id"] : newUlid(),
        createdAt: now,
        updatedAt: now,
      };

      const rows: unknown[] = await databaseFor(c.env)
        .insert(table)
        .values(record)
        .returning()
        .all();
      const row = rows[0];
      return c.json({ data: row }, 201, {
        location: `${base}/${String((row as Record<string, unknown> | undefined)?.["id"] ?? "")}`,
      });
    });
  }

  if (ops.includes("retrieve")) {
    app.get(`${base}/:id`, async (c) => {
      const id = c.req.param("id");
      const rows: unknown[] = await databaseFor(c.env)
        .select()
        .from(table)
        .where(eq(idColumn, id))
        .limit(1)
        .all();
      const row = rows[0];
      if (row === undefined) throw notFound(model.name, id);
      return c.json({ data: row });
    });
  }

  if (ops.includes("update")) {
    app.patch(`${base}/:id`, async (c) => {
      const id = c.req.param("id");
      const parsed = validation.update.safeParse(await readJsonBody(c.req.raw));
      if (!parsed.success) throw validationFailed(parsed.error.issues);

      const provided = Object.fromEntries(
        Object.entries(parsed.data as Record<string, unknown>).filter(
          ([, value]) => value !== undefined,
        ),
      );
      if (Object.keys(provided).length === 0) {
        throw badRequest("Provide at least one field to update.");
      }

      const rows: unknown[] = await databaseFor(c.env)
        .update(table)
        .set({ ...provided, updatedAt: new Date() })
        .where(eq(idColumn, id))
        .returning()
        .all();
      const row = rows[0];
      if (row === undefined) throw notFound(model.name, id);
      return c.json({ data: row });
    });
  }

  if (ops.includes("delete")) {
    app.delete(`${base}/:id`, async (c) => {
      const id = c.req.param("id");
      const removed: unknown[] = await databaseFor(c.env)
        .delete(table)
        .where(eq(idColumn, id))
        .returning({ id: idColumn })
        .all();
      if (removed.length === 0) throw notFound(model.name, id);
      return c.body(null, 204);
    });
  }
}

/**
 * Builds the generated REST API for every model that opts in with `api: { enabled: true }`.
 *
 * The returned app registers absolute paths (`/api/<app>/<model>`), so mount it at the root of the
 * application Worker. Database bindings are resolved from the request environment, so the app can
 * be constructed once at module scope.
 */
export function createApiApp<
  TBindings extends object = object,
  TVariables extends object = Record<never, never>,
>(config: ClangoConfig): Hono<{ Bindings: TBindings; Variables: TVariables }> {
  const app = new Hono<{ Bindings: TBindings; Variables: TVariables }>();
  const registry = collectRegistry(config);
  const schema: DatabaseSchema = buildSchema(registry);
  const routers = new WeakMap<object, DatabaseRouter>();

  function routerFor(env: object): DatabaseRouter {
    let router = routers.get(env);
    if (router === undefined) {
      router = createD1Router(config, env);
      routers.set(env, router);
    }
    return router;
  }

  for (const entry of registry.models) {
    const ops = apiOps(entry.model);
    if (ops.length === 0) continue;
    const table = schema.table(entry.model.name);
    registerModel(app, entry.model, table, ops, (env) =>
      drizzle(routerFor(env).database(entry.database).db),
    );
  }

  installFallbacks(app);
  return app;
}

/**
 * Installs the JSON error and `404` handlers.
 *
 * Hono does not carry a sub-app's `notFound` handler across `route()`, so this is applied to the app
 * the API is mounted on as well. Paths outside the API prefixes keep Hono's plain-text `404` so the
 * host application's own behaviour is unchanged.
 */
export function installFallbacks<TEnv extends Env>(
  app: Hono<TEnv>,
  prefixes: readonly string[] = ["/api/"],
): void {
  app.onError((error) => toErrorResponse(error));
  app.notFound((c) => {
    const path = new URL(c.req.url).pathname;
    return prefixes.some((prefix) => path.startsWith(prefix))
      ? c.json({ error: { code: "not_found", message: "No such endpoint." } }, 404)
      : c.text("404 Not Found", 404);
  });
}

/**
 * Mounts the generated API onto an existing Hono app and returns it.
 *
 * The app is mutated in place, so the return value is provided for chaining only.
 */
export function mountApi<TBindings extends object, TVariables extends object>(
  app: Hono<{ Bindings: TBindings; Variables: TVariables }>,
  config: ClangoConfig,
): Hono<{ Bindings: TBindings; Variables: TVariables }> {
  app.route("/", createApiApp<TBindings, TVariables>(config));
  installFallbacks(app, ["/api/", "/admin/api/"]);
  return app;
}
