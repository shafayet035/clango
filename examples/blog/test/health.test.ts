import { env } from "cloudflare:workers";
import { applyD1Migrations, createExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import worker from "../src/index";

/** Calls the Worker's fetch handler with a test execution context. */
async function fetchWorker(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(
    new Request(`https://example.com${path}`, init),
    env,
    createExecutionContext(),
  );
}

beforeAll(async () => {
  await applyD1Migrations(env.DB_MAIN, env.TEST_MIGRATIONS);
});

describe("example blog worker", () => {
  it("answers the root route", async () => {
    const response = await fetchWorker("/");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ name: "clango-example-blog" });
  });

  it("answers /health with the registered models", async () => {
    const response = await fetchWorker("/health");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; database: boolean; models: string[] };
    expect(body.status).toBe("ok");
    expect(body.database).toBe(true);
    // Enabling the admin registers framework tables (clango.AdminLog) alongside the app's models.
    expect(body.models).toEqual(expect.arrayContaining(["blog.Author", "blog.Post", "blog.Tag"]));
  });

  it("exposes the D1 binding to tests directly", async () => {
    const row = await env.DB_MAIN.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    expect(row?.ok).toBe(1);
  });
});

describe("generated migrations", () => {
  it("creates every table the models declare", async () => {
    const tables = await env.DB_MAIN.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    const names = tables.results.map((row) => row.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "blog_author",
        "blog_post",
        "blog_tag",
        "blog_post_tags",
        "blog_post_fts",
      ]),
    );
  });

  it("keeps the FTS index in sync through the generated triggers", async () => {
    await env.DB_MAIN.prepare("INSERT INTO blog_author (id, name, email) VALUES (?, ?, ?)")
      .bind("author-1", "Ada", "ada@example.com")
      .run();
    await env.DB_MAIN.prepare(
      "INSERT INTO blog_post (id, title, slug, body, status, author) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind("post-1", "Hello", "hello", "the quick brown fox", "published", "author-1")
      .run();

    const matches = await env.DB_MAIN.prepare(
      "SELECT id FROM blog_post_fts WHERE blog_post_fts MATCH ?",
    )
      .bind("brown")
      .all<{ id: string }>();
    expect(matches.results).toEqual([{ id: "post-1" }]);
  });
});
