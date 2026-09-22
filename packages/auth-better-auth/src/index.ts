import type { AuthAdapter, AuthIdentity } from "@clango/core";
import { betterAuth } from "better-auth";

/**
 * The subset of a Better Auth instance this adapter relies on.
 *
 * Declared structurally rather than by importing Better Auth's own types: the instance surface is
 * what matters here, and a structural contract keeps this package compiling across Better Auth
 * minor releases.
 */
export interface BetterAuthInstance {
  readonly api: {
    getSession(input: { headers: Headers }): Promise<BetterAuthSession | null>;
  };
  handler(request: Request): Promise<Response>;
}

/** The session shape Clango reads. Everything else Better Auth returns is ignored. */
export interface BetterAuthSession {
  readonly user: { readonly id: string; readonly email: string };
}

/** Options accepted by {@link betterAuthAdapter}. */
export interface BetterAuthAdapterOptions {
  readonly auth: BetterAuthInstance;
  /** Path the provider's own routes are mounted on. Defaults to `/api/auth`. */
  readonly basePath?: string;
}

/**
 * Adapts Better Auth to Clango's {@link AuthAdapter}.
 *
 * Identity only: Better Auth decides who the caller is, and Clango reads staff flags, groups and
 * permissions from its own tables (D-003). A provider therefore cannot grant authority, and swapping
 * it later leaves every grant intact.
 */
export function betterAuthAdapter(options: BetterAuthAdapterOptions): AuthAdapter {
  const basePath = options.basePath ?? "/api/auth";
  return {
    basePath,
    async getUser(request: Request): Promise<AuthIdentity | null> {
      const session = await options.auth.api.getSession({ headers: request.headers });
      if (session === null || session.user === undefined) return null;
      return { id: session.user.id, email: session.user.email };
    },
    handler: (request: Request) => options.auth.handler(request),
  };
}

/** Options accepted by {@link createBetterAuthAdapter}. */
export interface BetterAuthConfig {
  /**
   * Binding name of the database that holds Better Auth's own tables. Defaults to `DB_MAIN`.
   *
   * A binding name rather than the database itself: `clango.config.ts` is evaluated without an
   * environment (the CLI loads it too), so the binding can only be resolved per request.
   */
  readonly database?: string;
  /** Explicit signing secret. Prefer {@link secretBinding} in anything but local development. */
  readonly secret?: string;
  /** Environment variable or secret binding holding the signing secret. */
  readonly secretBinding?: string;
  /** Public origin the auth routes are served from, for example `https://example.com`. */
  readonly baseURL?: string;
  readonly basePath?: string;
  readonly emailAndPassword?: { enabled: boolean; minPasswordLength?: number };
  readonly trustedOrigins?: readonly string[];
}

function requireBinding<T>(env: object, name: string, what: string): T {
  const value = (env as Record<string, unknown>)[name];
  if (value === undefined) {
    throw new Error(
      `Missing ${what} binding "${name}". Declare it in wrangler.jsonc or as a secret.`,
    );
  }
  return value as T;
}

/**
 * Builds a Better Auth instance and adapts it in one step.
 *
 * The instance is constructed lazily, once per environment, because a Worker's bindings only exist
 * inside a request. Better Auth's own tables are not created here: generate them with its CLI and
 * apply the SQL as a migration so the schema is versioned alongside Clango's (see the README).
 */
export function createBetterAuthAdapter(config: BetterAuthConfig): AuthAdapter {
  const basePath = config.basePath ?? "/api/auth";
  const instances = new WeakMap<object, BetterAuthInstance>();
  const secretBinding = config.secretBinding ?? "BETTER_AUTH_SECRET";

  function instanceFor(env: object): BetterAuthInstance {
    const cached = instances.get(env);
    if (cached !== undefined) return cached;

    const database = requireBinding<D1Database>(env, config.database ?? "DB_MAIN", "database");
    const secret = config.secret ?? requireBinding<string>(env, secretBinding, "secret");
    const instance = betterAuth({
      database,
      secret,
      basePath,
      emailAndPassword: config.emailAndPassword ?? { enabled: true },
      ...(config.baseURL === undefined ? {} : { baseURL: config.baseURL }),
      ...(config.trustedOrigins === undefined
        ? {}
        : { trustedOrigins: [...config.trustedOrigins] }),
    }) as unknown as BetterAuthInstance;

    instances.set(env, instance);
    return instance;
  }

  return {
    basePath,
    async getUser(request: Request, env: object): Promise<AuthIdentity | null> {
      const session = await instanceFor(env).api.getSession({ headers: request.headers });
      if (session === null || session.user === undefined) return null;
      return { id: session.user.id, email: session.user.email };
    },
    handler: (request: Request, env: object) => instanceFor(env).handler(request),
  };
}
