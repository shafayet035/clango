# Auth

Identity comes from an adapter; authority comes from Clango.

```ts
interface AuthAdapter {
  getUser(request: Request, env: object): Promise<AuthIdentity | null>;
  handler?(request: Request, env: object): Promise<Response | null>;
  readonly basePath?: string;
}
```

An adapter returns **identity only** — `{ id, email }`. Staff flags, groups and permissions live in
`clango_*` tables, so a provider cannot grant itself authority and swapping providers leaves every
grant intact.

## Wiring Better Auth

```ts
import { createBetterAuthAdapter } from "@clango/auth-better-auth";

export default defineConfig({
  apps: [app],
  databases: { DB_MAIN: { binding: "DB_MAIN" } },
  // Bindings are resolved per request, not at config time: this file is also loaded by the CLI.
  auth: { enabled: true, adapter: createBetterAuthAdapter({ database: "DB_MAIN" }) },
});
```

```ts
mountAuth(app, config); // mounts the provider's own routes at /api/auth/*
```

The signing secret is read from `BETTER_AUTH_SECRET` (or `secretBinding`) so it never lives in the
config file. Better Auth's own tables are the project's responsibility: generate them with its CLI and
commit the SQL as a migration.

An adapter is a few lines, so a project can write its own: the blog example ships a development
adapter that trusts a header **only** when `ALLOW_DEV_AUTH=true`, which makes it inert in production.

## Permissions

Every model contributes four permissions, derived from the registry:

```
<app>.view_<model>   <app>.add_<model>   <app>.change_<model>   <app>.delete_<model>
```

The catalogue is derived rather than stored, so it cannot drift from the code; grants reference a
codename directly.

```ts
const authorization = new Authorization({ registry, schema });
const id = await authorization.findUserIdByEmail(db, "ada@example.com");

await authorization.setFlags(db, "ada@example.com", { isStaff: true, isSuperuser: false });
await authorization.grantToUser(db, id, "blog.change_post");

const group = await authorization.ensureGroup(db, "editors");
await authorization.grantToGroup(db, group, "blog.view_post");
await authorization.addUserToGroup(db, id, group);
```

A superuser holds the whole catalogue implicitly.

## Users

A `clango_user` row is created the first time an authenticated request arrives. Rows are matched by
the provider's id, then by email — which is what lets a superuser be appointed _before_ they can sign
in:

```sh
clango createsuperuser --email you@example.com --local
```

## Gating

`/admin` and `/admin/api/*` require a staff account; each operation then checks its permission. The
middleware must be registered **before** the routes it guards — Hono runs handlers in registration
order, so middleware added afterwards silently never runs.

Permission lookups are cached per request and never in KV: a stale permission cache is a security bug,
not a performance trade.

The REST API keeps opt-in exposure as its control rather than permissions. A project that needs
authenticated API access can compose `clangoAuth` and `requirePermission` onto those routes itself.
