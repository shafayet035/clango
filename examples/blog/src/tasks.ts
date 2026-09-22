import { defineSchedule, defineTask } from "@clango/tasks";
import { z } from "zod";

import { Post } from "./models";

/**
 * Background work for the blog.
 *
 * Tasks are registered at import time, like models, and the Worker's `queue` handler dispatches to
 * them. Anything slow enough to risk the Worker CPU budget belongs here rather than in a request.
 */

/** Marks a set of posts as published. */
export const publishPosts = defineTask(
  "blog.publish_posts",
  z.object({ ids: z.array(z.string().min(1)).min(1).max(500) }),
  async (payload, context) => {
    const { createD1Router } = await import("@clango/orm");
    const { default: config } = await import("../clango.config");
    const router = createD1Router(config, context.env);
    const driver = router.database("DB_MAIN");

    const placeholders = payload.ids.map(() => "?").join(", ");
    await driver.db
      .prepare(
        `UPDATE "blog_post" SET "status" = 'published', "published_at" = ?, "updated_at" = ? ` +
          `WHERE "id" IN (${placeholders}) AND "status" = 'draft'`,
      )
      .bind(Date.now(), Date.now(), ...payload.ids)
      .run();

    console.log(`published ${payload.ids.length} post(s) on attempt ${context.attempt}`);
  },
);

/**
 * A daily sweep.
 *
 * The cron expression must also appear in `wrangler.jsonc` under `triggers.crons` — Cloudflare
 * decides when to wake the Worker, and `defineSchedule` only routes the wake-up to a handler.
 */
export const dailyMaintenance = defineSchedule(
  "blog.daily_maintenance",
  "0 3 * * *",
  async (context) => {
    console.log(`blog maintenance ran at ${context.scheduledTime.toISOString()}`);
  },
);

export { Post };
