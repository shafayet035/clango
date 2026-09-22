import type { AuthAdapter, AuthIdentity } from "@clango/core";

/** Header a developer sets to act as a given account while running `wrangler dev`. */
export const DEV_USER_HEADER = "x-dev-user";

/**
 * Development-only identity provider.
 *
 * It trusts a request header, which is exactly what you must never do in production, so it refuses
 * to resolve anyone unless the environment explicitly opts in with `ALLOW_DEV_AUTH=true`. That makes
 * it inert in a deployed Worker even if the header is sent.
 *
 * Production uses `createBetterAuthAdapter` from `@clango/auth-better-auth`; swapping it is a
 * one-line change in `clango.config.ts`.
 */
export const devAuthAdapter: AuthAdapter = {
  basePath: "/api/auth",
  async getUser(_request, env): Promise<AuthIdentity | null> {
    if ((env as Record<string, unknown>)["ALLOW_DEV_AUTH"] !== "true") return null;
    const email = _request.headers.get(DEV_USER_HEADER);
    if (email === null) return null;
    return { id: `dev:${email}`, email };
  },
};
