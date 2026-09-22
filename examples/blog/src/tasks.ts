import { createPdfExporter, defineSchedule, defineTask, type BrowserLauncher } from "@clango/tasks";
import puppeteer from "@cloudflare/puppeteer";
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

/**
 * Renders a post's admin page to PDF and stores it in R2.
 *
 * Behind a task because rendering is slow and may exceed the Worker CPU budget. The launcher is
 * bound to the Worker's browser binding here, which is why this cannot be exercised in the test pool:
 * Browser Rendering needs a deployed browser, not a local stub.
 */
export const exportPostPdf = defineTask(
  "blog.export_post_pdf",
  z.object({ id: z.string().min(1), origin: z.string().url() }),
  async (payload, context) => {
    const env = context.env as Record<string, unknown>;
    const browser = env["BROWSER"];
    const files = env["FILES"];
    if (browser === undefined || files === undefined) {
      throw new Error('The PDF export needs the "BROWSER" and "FILES" bindings.');
    }

    const launcher: BrowserLauncher = {
      launch: async () =>
        (await puppeteer.launch(browser as never)) as unknown as Awaited<
          ReturnType<BrowserLauncher["launch"]>
        >,
    };
    const bucket = files as R2Bucket;

    const exporter = createPdfExporter({
      launcher,
      store: {
        put: async (key, value) => {
          await bucket.put(key, value, { httpMetadata: { contentType: "application/pdf" } });
        },
      },
    });

    const result = await exporter.export(
      `${payload.origin}/admin/blog/post/${payload.id}`,
      `exports/blog/post-${payload.id}.pdf`,
    );
    console.log(`exported ${result.key} (${result.bytes} bytes)`);
  },
);
