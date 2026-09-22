import type { ClangoConfig, PermissionCodename } from "@clango/core";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { MiddlewareHandler } from "hono";

import { can, type Authorization, type AuthorizedUser } from "./authorization";

/** Hono context variables the auth layer sets. */
export interface ClangoAuthVariables {
  clangoUser: AuthorizedUser | null;
}

type AuthEnv<TBindings extends object> = {
  Bindings: TBindings;
  Variables: ClangoAuthVariables;
};

function problem(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

/** Options accepted by {@link clangoAuth}. */
export interface AuthMiddlewareOptions<TBindings extends object> {
  readonly config: ClangoConfig;
  readonly authorization: Authorization;
  /** Resolves the database that holds the authorization tables for a request. */
  readonly databaseFor: (env: TBindings) => DrizzleD1Database;
}

/**
 * Resolves the caller once per request and stores the result on the context.
 *
 * Permission lookups are cached for the lifetime of the request and never in KV, because KV is
 * eventually consistent and a stale permission cache is a security bug (D-014's reasoning applies
 * to authorization too).
 */
export function clangoAuth<TBindings extends object>(
  options: AuthMiddlewareOptions<TBindings>,
): MiddlewareHandler<AuthEnv<TBindings>> {
  const adapter = options.config.auth?.enabled === true ? options.config.auth.adapter : undefined;

  return async (c, next) => {
    if (adapter === undefined) {
      c.set("clangoUser", null);
      await next();
      return;
    }

    const identity = await adapter.getUser(c.req.raw, c.env as object);
    if (identity === null) {
      c.set("clangoUser", null);
      await next();
      return;
    }

    const user = await options.authorization.resolveUser(options.databaseFor(c.env), identity);
    c.set("clangoUser", user);
    await next();
  };
}

/** Rejects anonymous and non-staff callers. */
export function requireStaff<TBindings extends object>(): MiddlewareHandler<AuthEnv<TBindings>> {
  return async (c, next) => {
    const user = c.get("clangoUser");
    if (user === null || user === undefined) {
      return problem(401, "unauthenticated", "Sign in to continue.");
    }
    if (!user.isStaff) {
      return problem(403, "forbidden", "This account is not a staff account.");
    }
    await next();
  };
}

/** Rejects callers without a specific permission. */
export function requirePermission<TBindings extends object>(
  codename: PermissionCodename,
): MiddlewareHandler<AuthEnv<TBindings>> {
  return async (c, next) => {
    const user = c.get("clangoUser");
    if (user === null || user === undefined) {
      return problem(401, "unauthenticated", "Sign in to continue.");
    }
    if (!can(user, codename)) {
      return problem(403, "forbidden", `Missing permission "${codename}".`);
    }
    await next();
  };
}

/**
 * Mounts the identity provider's own endpoints.
 *
 * The adapter returns `null` for paths it does not own, in which case the request continues to the
 * rest of the application.
 */
export function mountAuth<TBindings extends object>(
  app: { use: (path: string, handler: MiddlewareHandler<AuthEnv<TBindings>>) => unknown },
  config: ClangoConfig,
): void {
  const adapter = config.auth?.enabled === true ? config.auth.adapter : undefined;
  const handler = adapter?.handler;
  if (adapter === undefined || handler === undefined) return;

  const basePath = adapter.basePath ?? "/api/auth";
  app.use(`${basePath}/*`, async (c, next) => {
    const response = await handler(c.req.raw, c.env as object);
    if (response !== null) return response;
    await next();
  });
}
