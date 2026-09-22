# Clango

A Django-style framework for Cloudflare Workers. Define models in apps and Clango generates the
database schema, migrations, a REST API and a full admin panel.

> **Status:** M0–M5 complete: scaffold, models + migrations, generated REST API, admin,
> auth + permissions, and files/tasks/cache. See `docs/SPEC.md`.

## What works today

```ts
// apps/blog/models.ts
import { defineModel, fields } from "@clango/core";

export const Post = defineModel("blog.Post", {
  fields: {
    title: fields.string({ max: 200 }),
    body: fields.text({ searchable: true, optional: true }),
    status: fields.choice(["draft", "published"], { default: "draft" }),
    author: fields.foreignKey(() => Author, { onDelete: "cascade" }),
    publishedAt: fields.datetime({ optional: true, index: true }),
  },
  meta: { ordering: ["-publishedAt"] },
});
```

```sh
pnpm --filter @clango/example-blog db:makemigrations   # diff models, write SQL
pnpm --filter @clango/example-blog db:migrate:local    # apply with wrangler
```

`defineModel` types every row, insert and update; `makemigrations` emits cascade-safe table
rebuilds, indexes and FTS5 indexes with sync triggers; `@clango/orm` exposes the same schema to
Drizzle at runtime.

Opting a model into the API mounts validated CRUD routes:

```ts
export const Post = defineModel("blog.Post", {
  fields: {/* … */},
  api: { enabled: true }, // all operations
});

export const Tag = defineModel("blog.Tag", {
  fields: {/* … */},
  api: { enabled: true, ops: ["list", "retrieve"] }, // read-only
});
```

```sh
curl localhost:8787/api/blog/post?status=published&order=-publishedAt
curl localhost:8787/api/blog/post?search=quick                 # FTS5
curl localhost:8787/api/blog/post?rating.gte=4&limit=25        # cursor pagination
```

Enabling the admin adds a generic panel — sidebar, sortable/filterable list, fieldset-driven edit
form with relation search, and a delete screen with a cascade preview:

```ts
export default defineConfig({
  apps: [blog],
  databases: { DB_MAIN: { binding: "DB_MAIN" } },
  admin: { enabled: true },
});
```

```sh
pnpm --filter @clango/example-blog db:makemigrations   # creates clango_admin_log
pnpm --filter @clango/example-blog dev                 # then open http://localhost:8787/admin
```

The admin requires authentication and a staff account:

```ts
export default defineConfig({
  // …
  admin: { enabled: true },
  auth: {
    enabled: true,
    // Production: createBetterAuthAdapter({ database: "DB_MAIN" }) from @clango/auth-better-auth.
    adapter: devAuthAdapter,
  },
});
```

```sh
pnpm --filter @clango/example-blog exec clango createsuperuser --email you@example.com --local
pnpm --filter @clango/example-blog exec clango migrate --local
```

Every model contributes `view`, `add`, `change` and `delete` permissions. Users hold them directly
or through groups, and only staff accounts reach the admin — a provider such as Better Auth decides
_who_ you are, never _what_ you may do.

## Requirements

- Node.js >= 20
- pnpm >= 10

## Quickstart

```sh
pnpm install
pnpm check                 # lint + format + typecheck + tests
pnpm dev                   # runs examples/blog with wrangler dev
```

## Repository layout

```
packages/     @clango/* runtime packages
examples/     example apps (blog is the reference app)
docs/         SPEC.md — the spec; DECISIONS.md — the ADR log
```

## Development

| Command          | What it does                       |
| ---------------- | ---------------------------------- |
| `pnpm check`     | Everything CI runs                 |
| `pnpm lint`      | ESLint                             |
| `pnpm format`    | Prettier                           |
| `pnpm typecheck` | `tsc --noEmit` across packages     |
| `pnpm test`      | Vitest inside the Workers runtime  |
| `pnpm dev`       | `wrangler dev` for `examples/blog` |

Read `CLAUDE.md` for conventions and `docs/SPEC.md` for the authoritative spec.
