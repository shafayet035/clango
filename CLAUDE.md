# CLAUDE.md

Orientation for this repo. Read this first, then `docs/SPEC.md`.

## What this is

**Clango** — a Django-style framework for Cloudflare Workers. One model definition generates the D1
schema, migrations, a REST API and a generic admin panel. `docs/SPEC.md` is the authoritative spec;
`docs/DECISIONS.md` records every non-obvious choice (ADR style, append-only).

**Status:** M0–M4 complete (scaffold, models + migrations, REST API, admin, auth + permissions).
Next: M5 (files, tasks, cache).

## Non-negotiables

- Work **milestone by milestone**. Do not start the next milestone until the current one's
  acceptance criteria in `docs/SPEC.md` pass.
- Before touching a Cloudflare service, check the current docs. If they disagree with the spec,
  follow the docs and log the difference in `docs/DECISIONS.md`.
- Record every non-obvious design choice in `docs/DECISIONS.md`.
- TypeScript strict everywhere. No `any` in public APIs (ESLint enforces this).
- No Node-only APIs in runtime packages. Only `packages/cli` may use Node.
- Public APIs get TSDoc and at least one test.
- Prefer small, composable packages over one large one.
- Do not add code comments unless they explain a non-obvious decision.

## Layout

```
packages/
  core/     @clango/core   — defineModel, fields, defineApp, defineConfig, registry, ULID
  orm/      @clango/orm    — runtime Drizzle schema, DatabaseRouter, D1 driver
  migrate/  @clango/migrate— snapshots, diffing, SQL emitter, FTS5 (pure, no file I/O)
  cli/      @clango/cli    — makemigrations, migrate (Node-only, bundled with esbuild)
  api/      @clango/api    — generated REST routes (Hono + Zod), pagination, filters, FTS5 search
  admin-api/@clango/admin-api — admin metadata, CRUD, relation options, cascade preview, audit log
  admin-ui/ @clango/admin-ui  — React + HeroUI v3 SPA (Vite build, served as static assets)
  auth/     @clango/auth      — AuthAdapter contract, permission engine, staff gate, middleware
  auth-better-auth/ @clango/auth-better-auth — Better Auth reference adapter
  (planned: files, tasks, cache)
examples/
  blog/     the reference app used by every milestone
docs/       SPEC.md (authoritative spec), DECISIONS.md (ADR log)
```

## Commands

| Command                             | What it does                                                           |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `pnpm check`                        | lint + format:check + typecheck + test — run before finishing any task |
| `pnpm lint`                         | ESLint (flat config, typescript-eslint)                                |
| `pnpm format` / `pnpm format:check` | Prettier write / verify                                                |
| `pnpm typecheck`                    | `tsc --noEmit` in every package                                        |
| `pnpm test`                         | Vitest in every package (runs inside workerd)                          |
| `pnpm dev`                          | `wrangler dev` for `examples/blog`                                     |
| `pnpm --filter <pkg> types`         | Regenerate `worker-configuration.d.ts` after changing bindings         |
| `pnpm --filter @clango/cli build`   | Rebuild the CLI bundle (also runs on `pnpm install` via `prepare`)     |

Example app:

| Command                                                | What it does                     |
| ------------------------------------------------------ | -------------------------------- |
| `pnpm --filter @clango/example-blog db:makemigrations` | Diff models against the snapshot |
| `pnpm --filter @clango/example-blog db:migrate:local`  | Apply migrations to the local D1 |

## Testing

- Tests run inside the Workers runtime via **`@cloudflare/vitest-plugin`** (`cloudflareTest()` Vite
  plugin, configured per package in `vitest.config.ts`). Custom Vitest environments/runners are not
  supported.
- Test APIs: `import { env, exports } from "cloudflare:workers"`, then `exports.default.fetch(...)`
  for integration tests. `SELF` and `env` from `cloudflare:test` are deprecated; only
  `applyD1Migrations`/`runInDurableObject`-style helpers come from `cloudflare:test`.
- Each runtime package/example has its own `wrangler.jsonc`; the test pool loads it through
  `wrangler: { configPath: "./wrangler.jsonc" }`.
- Apply D1 migrations in a `beforeAll` inside the test file, **not** in `setupFiles` — setup files
  run in the pool's runner context, where the app's bindings are not visible (D-028).
- `Env` types are generated: run `pnpm --filter <pkg> types` after changing bindings. The generated
  `worker-configuration.d.ts` is committed.
- Type-level assertions (`expectTypeOf`, `@ts-expect-error`) are verified by `pnpm typecheck`.
  Prefer them over runtime-only assertions for the public type surface.

## Platform gotchas already learned

See `docs/DECISIONS.md` for the reasoning. Short version:

- **Never** emit `BEGIN`/`COMMIT` in a migration — D1 already wraps it in one transaction (D-022).
- **Never** `DROP TABLE` a referential parent without backing up its cascade children: `DROP TABLE`
  fires `ON DELETE CASCADE`/`SET NULL`. `planMigration` handles this; do not bypass it (D-023).
- `PRAGMA legacy_alter_table` does not work on D1 — do not try (D-024).
- Only `PRAGMA defer_foreign_keys = on` is emitted, once, ahead of rebuilds (D-007, D-022).
- Never `LIKE '%term%'` on user input — D1 caps `LIKE` patterns at 50 bytes (D-008).
- Never bare `COUNT(*)` in admin lists — use the bounded-count pattern (D-009).
- Never assume dynamic D1 bindings for tenants — the binding ceiling is ~5,000 per script (D-012).
- The R2 binding cannot presign; use `aws4fetch` with an S3 API token (D-010).
- Bulk queue payloads are query descriptors, not id lists (D-011).
- `wrangler d1 migrations apply` has no `--migrations-dir`; it reads `migrations_dir` from the
  binding, which must match `migrations/<database>` (D-027).
- The async form of `cloudflareTest()` replaces its options — always return `wrangler` too (D-028).
- `run_worker_first` is an **explicit positive list** of Worker routes. Negative patterns override
  positives, so a catch-all plus `!/admin/*` also excludes `/admin/api/*` and serves the SPA where
  JSON is expected (D-040).
- `env.ASSETS` is not available in the Workers test pool, so asset serving is verified with
  `wrangler dev` rather than in tests; the blog's routing test covers the Worker's side of the
  boundary (D-038).
- The admin must be enabled with `admin: { enabled: true }`; enabling it registers `clango.AdminLog`,
  so it needs a migration before the admin can write (D-035).
- Auth middleware must be registered **before** the routes it guards: Hono runs handlers in
  registration order, so `app.use()` added afterwards silently never runs (D-044).
- Adapters return identity only. Never read `isStaff`, `isSuperuser` or permissions from a provider —
  they live in `clango_*` tables so a provider cannot escalate (D-041).
- `clango.config.ts` has no environment (the CLI evaluates it too), so adapters must resolve their
  bindings from the `env` passed to `getUser`/`handler`, not at config time (D-046).
- The blog's dev identity adapter trusts `x-dev-user` **only** when `ALLOW_DEV_AUTH=true`; never set
  that on a deployed Worker (D-045).
- Raw `sql` fragments bypass Drizzle's column mapping: convert values with `toDriverValue` before
  binding a `Date` or `boolean`, or D1 rejects them with `D1_TYPE_ERROR` (D-030).
- Hono does not carry a sub-app's `notFound` across `route()`; `mountApi` installs the JSON handlers
  on the host app for that reason (D-033).
- Never interpolate user input into an FTS5 `MATCH` — tokenise and quote it (`buildMatchExpression`)
  and pass it as a bound parameter (D-032).

## Testing permissions

`examples/blog/test/admin-helpers.ts` provisions accounts and grants permissions through the real
services. `test/permissions.test.ts` is the end-to-end suite for the staff gate, per-operation
checks and group grants; `packages/admin-api/test/permissions.test.ts` covers the same ground at the
package level with a stub adapter. Add cases there rather than asserting permissions in passing.

## Adding a field type or changing the schema

A schema change touches five places, in this order:

1. `packages/core/src/fields.ts` — the builder, its options, validation and phantom types.
2. `packages/core/src/model.ts` — only if the field changes row/insert/update inference.
3. `packages/migrate/src/snapshot.ts` — the column's SQLite type and default.
4. `packages/orm/src/schema.ts` — the Drizzle column, so queries see the same shape.
5. `packages/api/src/query.ts` — filterability and operator support — and
   `packages/api/src/validation.ts` for the request schema.

Then add a case to `packages/migrate/test/plan.test.ts` and, if it affects stored values, to
`packages/migrate/test/d1.test.ts` and `packages/api/test/api.test.ts`. The blog's `sync` path is the end-to-end check:
`pnpm --filter @clango/example-blog db:makemigrations` must report "No changes detected" when the
snapshot is current.

## Definition of done for any feature

- [ ] Unit tests pass under the Workers test pool.
- [ ] The `examples/blog` app exercises the feature.
- [ ] `wrangler dev` runs the example with no errors.
- [ ] Docs page or README section updated.

For admin changes, also check `pnpm --filter @clango/admin-ui build` succeeds and probe the
`wrangler dev` routes listed in D-040 — the Workers test pool cannot exercise static assets.
