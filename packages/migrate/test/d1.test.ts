import {
  collectRegistry,
  defineApp,
  defineConfig,
  defineModel,
  fields,
  type AnyModel,
} from "@clango/core";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  buildSnapshot,
  emptySnapshot,
  planMigration,
  type MigrationPlan,
  type SchemaSnapshot,
} from "../src/index";

function snapshot(models: readonly AnyModel[]): SchemaSnapshot {
  const config = defineConfig({
    apps: [defineApp({ name: "blog", models })],
    databases: { DB_MAIN: { binding: "DB_MAIN" } },
  });
  return buildSnapshot(collectRegistry(config));
}

async function apply(plan: MigrationPlan): Promise<void> {
  if (plan.statements.length === 0) return;
  await env.DB.batch(plan.statements.map((statement) => env.DB.prepare(statement)));
}

async function all<T>(sql: string, ...bindings: unknown[]): Promise<T[]> {
  const result = await env.DB.prepare(sql)
    .bind(...bindings)
    .all<T>();
  return result.results;
}

const AuthorV1 = defineModel("blog.Author", {
  fields: {
    name: fields.string({ max: 120 }),
    email: fields.email({ unique: true }),
  },
});

const AuthorV2 = defineModel("blog.Author", {
  fields: {
    name: fields.string({ max: 120, optional: true }),
    email: fields.email({ unique: true }),
  },
});

const basePost = {
  title: fields.string({ max: 200 }),
  body: fields.text({ searchable: true, optional: true }),
  status: fields.choice(["draft", "published"], { default: "draft" }),
  author: fields.foreignKey(() => AuthorV1, { onDelete: "cascade" }),
};

const PostV1 = defineModel("blog.Post", { fields: { ...basePost } });

const PostV2 = defineModel("blog.Post", {
  fields: {
    ...basePost,
    status: fields.choice(["draft", "published", "archived"], { default: "draft" }),
  },
});

const PostV3 = defineModel("blog.Post", {
  fields: {
    title: basePost.title,
    status: basePost.status,
    author: basePost.author,
    tagline: fields.text({ searchable: true, optional: true }),
  },
});

describe("applying migrations to D1", () => {
  it("applies the initial migration", async () => {
    await apply(planMigration(emptySnapshot(), snapshot([AuthorV1, PostV1])));

    const tables = await all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name",
    );
    const names = tables.map((table) => table.name);
    expect(names).toContain("blog_author");
    expect(names).toContain("blog_post");
    expect(names).toContain("blog_post_fts");
  });

  it("seeds rows and keeps the FTS index in sync through triggers", async () => {
    await env.DB.prepare("INSERT INTO blog_author (id, name, email) VALUES (?, ?, ?)")
      .bind("author-1", "Ada", "ada@example.com")
      .run();
    await env.DB.prepare(
      "INSERT INTO blog_post (id, title, body, status, author) VALUES (?, ?, ?, ?, ?)",
    )
      .bind("post-1", "Hello World", "the quick brown fox", "published", "author-1")
      .run();

    const matches = await all<{ id: string }>(
      "SELECT id FROM blog_post_fts WHERE blog_post_fts MATCH ?",
      "brown",
    );
    expect(matches.map((row) => row.id)).toEqual(["post-1"]);
  });

  it("updates and deletes the FTS index through triggers", async () => {
    await env.DB.prepare("UPDATE blog_post SET body = ? WHERE id = ?")
      .bind("a lazy dog", "post-1")
      .run();
    expect(
      await all<{ id: string }>(
        "SELECT id FROM blog_post_fts WHERE blog_post_fts MATCH ?",
        "brown",
      ),
    ).toEqual([]);
    expect(
      await all<{ id: string }>("SELECT id FROM blog_post_fts WHERE blog_post_fts MATCH ?", "dog"),
    ).toEqual([{ id: "post-1" }]);
  });

  it("uses the SQL default for timestamps", async () => {
    const rows = await all<{ created_at: number; updated_at: number }>(
      "SELECT created_at, updated_at FROM blog_post WHERE id = ?",
      "post-1",
    );
    expect(rows[0]?.created_at).toBeGreaterThan(1_600_000_000_000);
    expect(rows[0]?.updated_at).toBeGreaterThan(1_600_000_000_000);
  });

  it("preserves child rows and foreign keys when rebuilding a parent table", async () => {
    const plan = planMigration(snapshot([AuthorV1, PostV1]), snapshot([AuthorV2, PostV1]));
    const rebuild = plan.changes.find((change) => change.kind === "rebuildTable");
    expect(rebuild?.kind).toBe("rebuildTable");
    expect(plan.statements[0]).toBe("PRAGMA defer_foreign_keys = on");

    await apply(plan);

    const violations = await all<{ table: string }>("PRAGMA foreign_key_check");
    expect(violations).toEqual([]);

    const posts = await all<{ id: string; author: string }>(
      "SELECT id, author FROM blog_post WHERE id = ?",
      "post-1",
    );
    expect(posts).toEqual([{ id: "post-1", author: "author-1" }]);

    const authors = await all<{ id: string; name: string }>(
      "SELECT id, name FROM blog_author WHERE id = ?",
      "author-1",
    );
    expect(authors).toEqual([{ id: "author-1", name: "Ada" }]);
  });

  it("keeps the FTS index working after a rebuild", async () => {
    expect(
      await all<{ id: string }>("SELECT id FROM blog_post_fts WHERE blog_post_fts MATCH ?", "dog"),
    ).toEqual([{ id: "post-1" }]);
  });

  it("cascades deletes after a rebuild", async () => {
    await env.DB.prepare("DELETE FROM blog_author WHERE id = ?").bind("author-1").run();
    const posts = await all<{ id: string }>("SELECT id FROM blog_post WHERE id = ?", "post-1");
    expect(posts).toEqual([]);
  });

  it("rebuilds when searchable columns are replaced and repopulates the index", async () => {
    await env.DB.prepare("INSERT INTO blog_author (id, email) VALUES (?, ?)")
      .bind("author-2", "grace@example.com")
      .run();
    await env.DB.prepare(
      "INSERT INTO blog_post (id, title, body, status, author) VALUES (?, ?, ?, ?, ?)",
    )
      .bind("post-2", "Second Post", "a quick note", "draft", "author-2")
      .run();

    const plan = planMigration(snapshot([AuthorV2, PostV2]), snapshot([AuthorV2, PostV3]));
    expect(plan.changes.some((change) => change.kind === "rebuildTable")).toBe(true);
    await apply(plan);

    const columns = await all<{ name: string }>('PRAGMA table_info("blog_post")');
    const names = columns.map((column) => column.name);
    expect(names).toContain("tagline");
    expect(names).not.toContain("body");

    await env.DB.prepare("UPDATE blog_post SET tagline = ? WHERE id = ?")
      .bind("a slow walk", "post-2")
      .run();
    expect(
      await all<{ id: string }>("SELECT id FROM blog_post_fts WHERE blog_post_fts MATCH ?", "walk"),
    ).toEqual([{ id: "post-2" }]);
    expect(
      await all<{ id: string }>(
        "SELECT id FROM blog_post_fts WHERE blog_post_fts MATCH ?",
        "quick",
      ),
    ).toEqual([]);
  });
});
