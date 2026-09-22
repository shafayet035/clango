# Scaling

A D1 database is a single SQLite instance: single-threaded writes, a 10 GB ceiling that cannot be
raised, and reads that improve only with replication. Clango therefore treats _many small databases_
as the normal shape.

## Routing

```ts
export default defineConfig({
  apps: [blog, analytics],
  databases: {
    DB_MAIN: { binding: "DB_MAIN" }, // blog
    DB_STATS: { binding: "DB_STATS" }, // analytics
  },
});
```

Each app (or model, with `database:`) names the database it lives in, and the ORM resolves the right
binding per query. Relations must stay inside one database — D1 cannot join or enforce a foreign key
across them, so a crossing relation is rejected when the registry is built.

## Database per tenant

```ts
export default defineConfig({
  // …
  tenants: { enabled: true, database: "DB_MAIN" },
});
```

A request carrying `x-clango-tenant: acme` is served entirely from that tenant's databases. The
binding is derived from the logical database and the slug — `DB_MAIN_ACME` by default, or whatever
`tenants.bindingTemplate` says — so every tenant database must be declared in `wrangler.jsonc`. An
unbound tenant fails at router construction naming the binding, and never falls back to the shared
database.

`clango.Tenant` in the control database records which tenants exist and whether they are suspended;
the CLI applies migrations to all of them:

```sh
clango migrate --all-tenants --remote
```

**Why a binding pool rather than the D1 HTTP API or Workers for Platforms?** Because bindings are
static and a script can hold roughly 5,000 of them, the pool keeps every query on the fast path, keeps
sessions working, and needs no new infrastructure. The HTTP API has no such ceiling but adds a network
hop per query and bypasses sessions and replication; Workers for Platforms scales furthest and is the
right answer when a host runs customers' _code_, not just their data. Past the binding ceiling a
project must move to dispatch namespaces — the registry stores only facts an operator decides, so that
move does not invalidate anything.

## Read replication

```ts
// nothing to change: enable replication on the database and reads start using replicas
```

Every request uses one D1 session, so reads see that request's own writes and, once read replication
is enabled on a database, are served by the nearest replica while writes still go to the primary.
Sessions are safe on a database without replication: queries simply run on the primary.

## Query rules the framework enforces

- Cursor pagination everywhere; no large `OFFSET`.
- Counts in the admin are bounded, with `countCapped` rather than a full scan.
- Indexes are generated for every filter, ordering and foreign key field.
- Bulk actions over more than 100 rows run in Queues, not in the request.
- Writes are batched with `db.batch()`, and reads that share a request share a session.

D1's own limits shape the rest: 100 bound parameters per query, 100 KB per statement, 2 MB per row,
100 columns per table, 30 seconds per query, and a 50-byte cap on `LIKE` patterns — which is why
search goes through FTS5.

## The driver seam

The ORM resolves databases through a `DatabaseRouter` built by a `DriverFactory`, and a driver
declares its dialect. Only the D1 driver ships. A Postgres driver would additionally owe the
SQLite-shaped parts of the query layer — the keyset predicate, bounded counts, FTS5 search and
`batch` — while model definitions, migrations and admin metadata are already dialect-agnostic. That is
recorded plainly rather than implied by an interface that would not compile.
