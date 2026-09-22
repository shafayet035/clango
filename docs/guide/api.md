# REST API

Exposure is opt-in per model and per operation, so nothing becomes public by accident:

```ts
export const Post = defineModel("blog.Post", {
  fields: {/* … */},
  api: { enabled: true }, // every operation
});

export const Tag = defineModel("blog.Tag", {
  fields: {/* … */},
  api: { enabled: true, ops: ["list", "retrieve"] }, // read-only
});
```

A model that does not opt in has no routes at all: an unregistered method returns `404`, not `403`.
The admin is separate — it can manage a model that the public API never exposes.

## Routes

| Method   | Path                     |
| -------- | ------------------------ |
| `GET`    | `/api/<app>/<model>`     |
| `POST`   | `/api/<app>/<model>`     |
| `GET`    | `/api/<app>/<model>/:id` |
| `PATCH`  | `/api/<app>/<model>/:id` |
| `DELETE` | `/api/<app>/<model>/:id` |

Bodies are validated with a Zod schema generated from the field definitions, and the schemas are
strict: an unknown key is a `400` rather than a silently dropped field.

## List parameters

| Parameter            | Meaning                                                        |
| -------------------- | -------------------------------------------------------------- |
| `limit`              | Page size, 1–100. Default 25                                   |
| `cursor`             | Opaque; taken from the previous page's `page.nextCursor`       |
| `order`              | `-field` for descending, comma separated, at most three keys   |
| `search`             | Full-text search over the model's `searchable` fields          |
| any filterable field | `?status=draft`, `?rating.gte=4`, `?status.in=draft,published` |

Filtering and ordering are limited to scalar columns; `text`, `json`, `file` and `image` are excluded,
and range operators are only accepted for ordered types. Ordering defaults to `meta.ordering` with
`id` appended as a tie breaker.

```sh
curl "localhost:8787/api/blog/post?status=published&order=-publishedAt&limit=25"
curl "localhost:8787/api/blog/post?search=quick"
curl "localhost:8787/api/blog/post?rating.gte=4"
```

## Responses

```json
{
  "data": [/* … */],
  "page": { "count": 42, "countCapped": false, "limit": 25, "hasMore": true, "nextCursor": "…" }
}
```

`count` is exact up to 10,000 and `countCapped` says when it is a lower bound — the count query is
bounded, so a list request cannot be made to scan a whole table.

Errors are always JSON:

```json
{ "error": { "code": "validation_error", "message": "…", "details": [/* issues */] } }
```

`validation_error` (400), `not_found` (404), `conflict` (409, a unique index) and `invalid_reference`
(400, a foreign key) come from the database where they can, so a constraint violation surfaces as a
useful status rather than a 500.

## Search

`?search=` runs through the model's FTS5 index. Every token is quoted before it reaches `MATCH`, and
the final token is prefix-matched, so typing is incremental and a stray quote cannot change the query.
A model with no `searchable` field rejects `search` with a `400` instead of ignoring it.
