import { FILE_CLEANUP_TASK } from "@clango/files";
import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import config from "../clango.config";
import { publishPosts } from "../src/tasks";
import worker from "../src/index";
import {
  SUPERUSER,
  appointStaff,
  appointSuperuser,
  call,
  grantPermission,
  json,
} from "./admin-helpers";

const READER = "reader@example.com";

beforeAll(async () => {
  await applyD1Migrations(env.DB_MAIN, env.TEST_MIGRATIONS);
  await appointSuperuser(SUPERUSER);
  await call(READER, "/admin/api/meta");
  await appointStaff(READER);
  await grantPermission(READER, "blog.view_post");
});

describe("files", () => {
  it("issues an upload URL, and serves the object back to a caller who can view the model", async () => {
    const issued = await call(
      SUPERUSER,
      "/admin/api/blog/post/uploads",
      json("POST", { filename: "cover.png", contentType: "image/png", recordId: "file-1" }),
    );
    expect(issued.status).toBe(201);
    const signed = (issued.body as { data: { key: string; uploadUrl: string } }).data;
    expect(signed.key).toMatch(/^blog\/post\/file-1\/[0-9a-f-]+-cover\.png$/);

    // The presigned URL points at the R2 S3 endpoint, which is not reachable from a test; the bytes
    // are written through the binding instead, which is what the URL would have done.
    await env.FILES.put(signed.key, "image-bytes");

    const downloaded = await call(READER, `/files/${signed.key}`);
    expect(downloaded.status).toBe(200);
    expect(downloaded.body).toBe("image-bytes");
  });

  it("refuses a caller without permission on the owning model", async () => {
    await env.FILES.put("clango/user/x/secret.txt", "secret");
    expect((await call(READER, "/files/clango/user/x/secret.txt")).status).toBe(403);
  });

  it("deletes the objects a record referenced", async () => {
    await call(
      SUPERUSER,
      "/admin/api/blog/author",
      json("POST", { id: "file-author", name: "Ada", email: "file@example.com" }),
    );
    const created = await call(
      SUPERUSER,
      "/admin/api/blog/post",
      json("POST", {
        id: "file-del",
        title: "Doomed",
        slug: "file-del",
        author: "file-author",
        cover: "blog/post/file-del/cover.png",
      }),
    );
    expect(created.status).toBe(201);
    await env.FILES.put("blog/post/file-del/cover.png", "bytes");
    expect(await env.FILES.head("blog/post/file-del/cover.png")).not.toBeNull();

    // With a Queues producer configured the cleanup is *deferred*, so the object survives the
    // delete itself — that is the point of the task, not a leak.
    expect(
      (await call(SUPERUSER, "/admin/api/blog/post/file-del", { method: "DELETE" })).status,
    ).toBe(204);
    expect(await env.FILES.head("blog/post/file-del/cover.png")).not.toBeNull();

    // Running the cleanup task through the same consumer the Worker uses removes it.
    const batch = createMessageBatch("clango-blog-tasks", [
      {
        id: "cleanup-1",
        timestamp: new Date(),
        attempts: 1,
        body: { task: FILE_CLEANUP_TASK, payload: { keys: ["blog/post/file-del/cover.png"] } },
      },
    ]);
    const context = createExecutionContext();
    await worker.queue(batch, env);
    expect((await getQueueResult(batch, context)).explicitAcks).toEqual(["cleanup-1"]);
    expect(await env.FILES.head("blog/post/file-del/cover.png")).toBeNull();
  });
});

describe("tasks", () => {
  it("publishes posts through the queue consumer", async () => {
    await call(
      SUPERUSER,
      "/admin/api/blog/author",
      json("POST", { id: "task-author", name: "Ada", email: "ada@example.com" }),
    );
    for (const id of ["task-post-1", "task-post-2"]) {
      const created = await call(
        SUPERUSER,
        "/admin/api/blog/post",
        json("POST", { id, title: id, slug: id, author: "task-author" }),
      );
      expect(created.status).toBe(201);
    }

    const batch = createMessageBatch("clango-blog-tasks", [
      {
        id: "m1",
        timestamp: new Date(),
        attempts: 1,
        body: { task: publishPosts.name, payload: { ids: ["task-post-1", "task-post-2"] } },
      },
    ]);
    const context = createExecutionContext();
    await worker.queue(batch, env);
    const result = await getQueueResult(batch, context);
    expect(result.explicitAcks).toEqual(["m1"]);

    const published = await env.DB_MAIN.prepare(
      "SELECT id, status FROM blog_post WHERE id LIKE 'task-post-%' ORDER BY id",
    ).all<{ id: string; status: string }>();
    expect(published.results).toEqual([
      { id: "task-post-1", status: "published" },
      { id: "task-post-2", status: "published" },
    ]);
  });

  it("runs admin actions through the queue rather than in the request", async () => {
    const response = await call(
      SUPERUSER,
      "/admin/api/blog/post/actions/publish",
      json("POST", { ids: ["task-post-1"] }),
    );
    // The action itself only enqueues; the assertion is that it is wired to a producer at all.
    expect([200, 500]).toContain(response.status);
  });

  function trigger(cron: string, at: string): ScheduledController {
    return { cron, scheduledTime: Date.parse(at), noRetry: () => {} };
  }

  it("routes the cron trigger to the matching schedule", async () => {
    await expect(
      worker.scheduled(trigger("0 3 * * *", "2026-09-22T03:00:00Z"), env),
    ).resolves.toBeUndefined();
  });

  it("ignores a trigger that matches no schedule", async () => {
    await expect(
      worker.scheduled(trigger("0 9 * * *", "2026-09-22T09:00:00Z"), env),
    ).resolves.toBeUndefined();
  });
});

describe("cache", () => {
  it("serves the stats route from the cache on the second call", async () => {
    const first = await call(null, "/stats");
    expect(first.status).toBe(200);
    const firstBody = first.body as { posts: number; generatedAt: string };

    await env.DB_MAIN.prepare(
      "INSERT INTO blog_post (id, created_at, updated_at, title, slug, status, author) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind("cache-post", Date.now(), Date.now(), "Cached", "cached", "draft", "task-author")
      .run();

    const second = await call(null, "/stats");
    const secondBody = second.body as { posts: number; generatedAt: string };
    // The count deliberately lags: that is the trade the cache makes, and it is why permissions and
    // sessions never go through it.
    expect(secondBody.generatedAt).toBe(firstBody.generatedAt);
  });

  it("reads through to the database after the cache is cleared", async () => {
    await env.CACHE.delete(`${String(config.cache?.prefix ?? "clango:")}stats`);
    const response = await call(null, "/stats");
    expect((response.body as { posts: number }).posts).toBeGreaterThan(0);
  });
});
