import { mountAdmin, type ClangoAuthVariables } from "@clango/admin-api";
import { mountApi } from "@clango/api";
import { mountAuth } from "@clango/auth";
import { createCache } from "@clango/cache";
import { VERSION } from "@clango/core";
import { createD1Router, schemaFor } from "@clango/orm";
import { handleQueueBatch, handleScheduled } from "@clango/tasks";
import { Hono } from "hono";

import config from "../clango.config";
import "./admin";
import "./tasks";

const app = new Hono<{ Bindings: Env; Variables: ClangoAuthVariables }>();

app.get("/", (c) => c.json({ name: "clango-example-blog", clango: VERSION }));

app.get("/health", async (c) => {
  const router = createD1Router(config, c.env);
  const schema = schemaFor(config);
  const row = await router.database("DB_MAIN").db.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  return c.json({
    status: "ok",
    database: row?.ok === 1,
    models: [...schema.byModel.keys()],
  });
});

/**
 * Read-heavy and staleness-tolerant: a count that lags by up to a minute is fine, and the route is
 * the natural place to show what the cache is for. Sessions and permissions never go here.
 */
app.get("/stats", async (c) => {
  const cache = createCache(c.env.CACHE, config.cache ?? { binding: "CACHE" });
  const stats = await cache.wrap(
    "stats",
    async () => {
      const row = await createD1Router(config, c.env)
        .database("DB_MAIN")
        .db.prepare("SELECT COUNT(*) AS posts FROM blog_post")
        .first<{ posts: number }>();
      return { posts: row?.posts ?? 0, generatedAt: new Date().toISOString() };
    },
    { ttlSeconds: 120 },
  );
  return c.json(stats);
});

mountAuth(app, config);
mountApi(app, config);
mountAdmin(app, config);

export default {
  // Wrapped rather than passed by reference: a bare `app.fetch` would lose its `this`.
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  /** Runs `defineTask` handlers with per-message acknowledgement. */
  queue: (batch: MessageBatch, env: Env) => handleQueueBatch(batch, env),
  /** Routes a Cron Trigger to the matching `defineSchedule` handlers. */
  scheduled: async (event: ScheduledController, env: Env) => {
    await handleScheduled(event, env);
  },
} satisfies ExportedHandler<Env>;
