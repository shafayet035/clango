# Models and migrations

## Fields

| Field                            | Stored as    | Notes                                                |
| -------------------------------- | ------------ | ---------------------------------------------------- |
| `string`, `email`, `slug`, `url` | TEXT         | `max` is enforced in DDL and at the API edge         |
| `text`                           | TEXT         | `searchable: true` adds it to the model's FTS5 index |
| `integer`                        | INTEGER      |                                                      |
| `decimal`                        | INTEGER      | Minor units; `scale` (default 2) fixes the precision |
| `boolean`                        | INTEGER      | `0`/`1`                                              |
| `datetime`                       | INTEGER      | Epoch milliseconds, exposed as `Date`, always UTC    |
| `date`                           | TEXT         | `YYYY-MM-DD`                                         |
| `choice`                         | TEXT + CHECK | Validated at the API edge too                        |
| `json`                           | TEXT         | Serialised                                           |
| `foreignKey`                     | TEXT + FK    | The column holds the target's id                     |
| `manyToMany`                     | join table   | Not a column on the model                            |
| `file`, `image`                  | TEXT         | The R2 object key                                    |

Every model also gets `id` (a ULID), `createdAt` and `updatedAt`.

```ts
export const Post = defineModel("blog.Post", {
  fields: {
    title: fields.string({ max: 200 }),
    body: fields.text({ searchable: true, optional: true }),
    status: fields.choice(["draft", "published"], { default: "draft" }),
    author: fields.foreignKey(() => Author, { onDelete: "cascade" }),
  },
  meta: { ordering: ["-createdAt"], labelField: "title" },
  display: (post) => post.title,
});
```

`meta.labelField` is what relation pickers and the admin use as a human label; `display` is for code
that already has the row.

## Migrations

`clango makemigrations` diffs the registry against `migrations/<database>/_snapshot.json` and writes
numbered SQL. `clango migrate` hands that directory to `wrangler d1 migrations apply`, so wrangler
owns the ledger.

Three things worth knowing:

- **A table rebuild is not a drop and recreate.** SQLite cannot alter most columns in place, so the
  engine recreates the table. It first copies the rows of every table that `ON DELETE CASCADE` or
  `SET NULL` points at the one being rebuilt, then restores them afterwards — because `DROP TABLE`
  fires those actions and would otherwise delete child rows silently (D-023).
- **Destructive changes need `--allow-destructive`.** Dropping a column or a table is refused
  otherwise, and the flag prints exactly what will be lost.
- **Adding a required column needs a default.** A `NOT NULL` column with no default cannot be
  backfilled, so the planner refuses it and tells you to give the field a `default` or make it
  `optional`.

## Relations

Relations must stay inside one database. D1 cannot join or enforce a foreign key across databases, so
a `foreignKey` or `manyToMany` whose target lives elsewhere is rejected when the registry is built —
naming the field and both databases.

## After changing a field type

A new field type touches five places. In this repo the order is written down in `CLAUDE.md`; the short
version is core's builder, the model's inference, the snapshot, the Drizzle column, and the API's
filter/validation surface.
