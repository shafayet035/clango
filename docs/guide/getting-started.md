# Getting started

## Requirements

Node 20+, pnpm 10+, and a Cloudflare account for deployment (`wrangler dev` needs none).

## Scaffold a project

```sh
clango init my-app
cd my-app
pnpm install
```

That writes a Worker with a `DB_MAIN` D1 binding, a `clango.config.ts`, one starter model, and the
scripts you need. Then:

```sh
wrangler d1 create my-app-db      # paste the id into wrangler.jsonc
clango makemigrations
clango migrate --local
pnpm dev
```

`GET /health` reports whether the database answers, and `GET /api/my-app/note` is live because the
starter model opts in with `api: { enabled: true }`.

## The shape of an app

```ts
// src/models.ts
export const Note = defineModel("my-app.Note", {
  fields: {
    title: fields.string({ max: 200 }),
    body: fields.text({ searchable: true, optional: true }),
    pinned: fields.boolean({ default: false }),
  },
  meta: { ordering: ["-createdAt"], labelField: "title" },
  api: { enabled: true },
});
```

```ts
// src/app.ts
export default defineApp({ name: "my-app", models: [Note], database: "DB_MAIN" });
```

```ts
// clango.config.ts
export default defineConfig({
  apps: [app],
  databases: { DB_MAIN: { binding: "DB_MAIN" } },
  admin: { enabled: true },
});
```

The model is the single source of truth: the table, its indexes, its FTS5 index, the REST routes and
the admin screens all come from that one definition.

## Commands

| Command                                    | What it does                                   |
| ------------------------------------------ | ---------------------------------------------- |
| `clango init [dir]`                        | Scaffold a project                             |
| `clango startapp <name>`                   | Scaffold an app inside a project               |
| `clango makemigrations`                    | Diff models against the snapshot and write SQL |
| `clango migrate [--local\|--remote]`       | Apply migrations through wrangler              |
| `clango migrate --all-tenants`             | Apply migrations to every active tenant        |
| `clango createsuperuser --email <address>` | Appoint a superuser before they sign in        |

## Next

- [Models and migrations](./models.md) for the field types and how schema changes work.
- [Admin](./admin.md) if you enabled the admin — you will need `clango createsuperuser` first.
