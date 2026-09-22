# Admin

```ts
export default defineConfig({
  apps: [app],
  databases: { DB_MAIN: { binding: "DB_MAIN" } },
  admin: { enabled: true }, // registers clango.AdminLog, so migrate afterwards
});
```

The admin is opt-in because it is the one surface that can write to everything. It is served at
`/admin` and its API at `/admin/api/*`.

## Customising a model

```ts
registerAdmin(Post, {
  listDisplay: ["title", "author", "status", "publishedAt"],
  listFilter: ["status", "author"],
  searchFields: ["title", "body"],
  readonlyFields: ["slug"],
  fieldsets: [
    { title: "Content", fields: ["title", "slug", "body"] },
    { title: "Publishing", fields: ["status", "author", "publishedAt"] },
  ],
  actions: [
    {
      name: "publish",
      label: "Publish selected",
      handler: async (ids, context) => {
        await context.enqueue(publishPosts, { ids });
      },
    },
  ],
});
```

Registration is optional: an unregistered model still appears, with sensible defaults. `hidden: true`
keeps a model out of the admin entirely, and `registerAdmin(Model, { widgets })` names a custom
widget per field (see below).

## How it is put together

- `GET /admin/api/meta` returns every model the caller can read: fields, widgets, requiredness,
  read-only flags, list configuration, fieldsets, actions and per-model permissions. The SPA is
  entirely generic — it renders what the metadata says.
- The SPA is React + HeroUI, built by Vite into static assets served alongside the Worker.
- Every write goes into `clango_admin_log` **in the same batch as the mutation**, so a failed write
  logs nothing and a successful one cannot go unlogged. Updates record a per-field `{ from, to }` diff,
  and an update that changes nothing records nothing.
- Deleting shows a cascade preview: which rows `ON DELETE CASCADE` and `SET NULL` will reach, followed
  transitively and bounded, with "at least N" when the bound is hit.

## Permissions

The admin requires a staff account, and each operation checks a permission: `view`, `add`, `change`,
`delete`. See [Auth](./auth.md).

## Row locks

Two people editing the same row is a conflict waiting to happen. With a Durable Object binding the
admin can hold an advisory lock per row:

```ts
export default defineConfig({
  // …
  locks: { binding: "ROW_LOCKS" }, // sharded pool, 16 shards by default
});
```

```ts
// src/index.ts — the app must export the class, because a Worker owns its Durable Objects
export { RowLockDurableObject } from "@clango/admin-api";
```

```jsonc
// wrangler.jsonc
"durable_objects": { "bindings": [{ "name": "ROW_LOCKS", "class_name": "RowLockDurableObject" }] },
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["RowLockDurableObject"] }]
```

```
GET    /admin/api/<app>/<model>/:id/lock     → the current holder, or null
POST   /admin/api/<app>/<model>/:id/lock     → { token, expiresAt }, or 409 with the holder
DELETE /admin/api/<app>/<model>/:id/lock     → { released } (body: { token })
```

Locks expire (five minutes by default) and an alarm releases them, so a closed tab cannot hold a row
forever.

## Custom widgets

The server passes a widget name through untouched; the SPA resolves it against a registry and falls
back to the built-in control when nothing is registered, so a stale name degrades rather than blanking
the field.

```ts
registerAdmin(Post, { widgets: { body: "markdown" } });
```

```tsx
// the app's own admin entry, built with `vite build`
import { mountAdminUi, registerWidget } from "@clango/admin-ui";

mountAdminUi(document.getElementById("root")!, {
  onRegisterWidgets: () => registerWidget("markdown", MarkdownWidget),
});
```

Because widgets are React components, an app using them builds its own admin bundle rather than
consuming the prebuilt one in `packages/admin-ui/dist`.

## Routing

The SPA and the API share the origin, so `wrangler.jsonc` has to say which paths the Worker owns:

```jsonc
"assets": {
  "directory": "../../packages/admin-ui/dist",
  "not_found_handling": "single-page-application",
  "run_worker_first": ["/", "/health", "/api/*", "/admin/api/*"]
}
```

`run_worker_first` is a **positive** list: an unlisted Worker route is answered by the asset layer
with the SPA shell — a `200` with the wrong content type and no error anywhere. Add every route.
