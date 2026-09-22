# Files, tasks and cache

```ts
export default defineConfig({
  // …
  files: {
    binding: "FILES", // R2 binding
    bucket: "my-files",
    accountId: "R2_ACCOUNT_ID", // the R2 binding cannot sign, so an S3 API token is required
    accessKeyId: "R2_ACCESS_KEY_ID",
    secretAccessKey: "R2_SECRET_ACCESS_KEY",
  },
  tasks: { binding: "TASKS" }, // Queues producer for actions and file cleanup
  cache: { binding: "CACHE" }, // KV, staleness-tolerant reads only
});
```

## Files

`fields.file()` and `fields.image()` store an R2 object key. Uploading is a two-step flow, because
the bytes should not pass through the Worker:

```sh
curl -X POST -H 'content-type: application/json' \
  -d '{"filename":"cover.png","contentType":"image/png","recordId":"01H"}' \
  localhost:8787/admin/api/blog/post/uploads
# { "key": "blog/post/01H/<uuid>-cover.png", "uploadUrl": "https://…", "expiresAt": "…" }

curl -X PUT --data-binary @cover.png '<uploadUrl>'   # straight to R2
```

Store the returned key on the record. Private downloads go through `GET /files/<key>`, which checks
the caller's `view` permission on the owning model, so a key is not a capability.

Deleting a record — or re-pointing a file field — removes the objects it no longer references. With a
Queues producer that is deferred to the `clango.cleanup_files` task; without one it happens inline, so
a project with no queue does not leak. Uploads that were never attached to a record are collected by
`sweepOrphans`, which waits an hour by default so in-flight uploads survive.

## Tasks

```ts
export const publishPosts = defineTask(
  "blog.publish_posts",
  z.object({ ids: z.array(z.string().min(1)).max(500) }),
  async (payload, context) => {
    // context.env, context.attempt, context.task, context.queue
  },
);
```

```ts
export default {
  fetch: app.fetch,
  queue: (batch: MessageBatch, env: Env) => handleQueueBatch(batch, env),
} satisfies ExportedHandler<Env>;
```

The consumer acknowledges or retries each message individually: an uncaught error retries the whole
batch otherwise. Unknown tasks and payloads that fail validation are acknowledged, because retrying
them can never succeed.

Producers validate before sending, so a bad payload fails where there is a request context:

```ts
await context.enqueue(publishPosts, { ids: [...selected] });
```

For a bulk action prefer a **query descriptor** over an id list — the payload then does not grow with
the selection.

## Schedules

```ts
export const nightly = defineSchedule("blog.nightly", "0 3 * * *", async (context) => {
  context.env;
  context.scheduledTime;
});

export default {
  fetch: app.fetch,
  scheduled: (event: ScheduledController, env: Env) => handleScheduled(event, env),
} satisfies ExportedHandler<Env>;
```

The expression must appear in **both** `defineSchedule` and `wrangler.jsonc`'s `triggers.crons`:
Cloudflare decides when to wake the Worker, and the handler only routes the wake-up.

## CSV and PDF pipelines

`exportCsv` and `importCsv` page a table one chunk at a time and never hold it in memory, so a
Workflow can drive them across steps. `exportCsv` writes the header only on the first chunk and still
writes one for an empty table; `importCsv` collects failures rather than throwing, so one bad line
does not abandon a file.

`renderPdf` renders a URL with Browser Rendering, and takes a _launcher_ rather than a browser so the
logic is testable. It belongs behind a Workflow or a task: rendering is slow and can exceed the Worker
CPU budget.

## Cache

```ts
const cache = createCache(env.CACHE, config.cache);
const stats = await cache.wrap("stats", () => expensiveQuery(), { ttlSeconds: 120 });
await cache.invalidate("post:");
```

KV is eventually consistent — a write can take up to about a minute to be visible everywhere. That
makes it right for rendered fragments and denormalised counters, and wrong for anything a stale read
would make _incorrect_: sessions, permissions, row locks and uniqueness checks belong in D1. The TTL
guard exists because KV rejects anything under 60 seconds.
