import { collectRegistry, defineApp, defineConfig, defineModel, fields } from "@clango/core";
import { buildSnapshot, emptySnapshot, planMigration } from "@clango/migrate";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { buildSchema, buildTable, createD1Router, createDrizzle, schemaFor } from "../src/index";

const Author = defineModel("blog.Author", {
  fields: {
    name: fields.string({ max: 120 }),
    email: fields.email({ unique: true }),
  },
});

const Post = defineModel("blog.Post", {
  fields: {
    title: fields.string({ max: 200 }),
    body: fields.text({ searchable: true, optional: true }),
    status: fields.choice(["draft", "published"], { default: "draft" }),
    published: fields.boolean({ default: false }),
    rating: fields.decimal({ scale: 2, optional: true }),
    meta: fields.json<{ tags: string[] }>({ optional: true }),
    publishedAt: fields.datetime({ optional: true }),
    author: fields.foreignKey(() => Author, { onDelete: "cascade" }),
  },
});

const app = defineApp({ name: "blog", models: [Author, Post], database: "DB_MAIN" });
const config = defineConfig({
  apps: [app],
  databases: { DB_MAIN: { binding: "DB_MAIN" } },
});

async function migrateToCurrentSchema(): Promise<void> {
  const plan = planMigration(emptySnapshot(), buildSnapshot(collectRegistry(config)));
  await env.DB_MAIN.batch(plan.statements.map((statement) => env.DB_MAIN.prepare(statement)));
}

describe("buildTable", () => {
  it("produces one Drizzle table per model", () => {
    const table = buildTable(Post);
    expect(Object.keys(table)).not.toContain("tags");
    expect(Object.keys(table)).toEqual(
      expect.arrayContaining(["id", "createdAt", "updatedAt", "title", "body", "status", "author"]),
    );
  });
});

describe("buildSchema", () => {
  it("indexes tables by model name and table name", () => {
    const schema = buildSchema(collectRegistry(config));
    expect(schema.table("blog.Post")).toBe(schema.tableByName("blog_post"));
    expect(schema.byModel.size).toBe(2);
  });

  it("throws for an unknown model", () => {
    const schema = schemaFor(config);
    expect(() => schema.table("blog.Missing")).toThrow();
  });
});

describe("Drizzle over the generated schema", () => {
  it("round-trips rows written through Drizzle", async () => {
    await migrateToCurrentSchema();

    const db = createDrizzle(createD1Router(config, env).database("DB_MAIN"));
    const authorTable = buildTable(Author);
    const postTable = buildTable(Post);

    await db
      .insert(authorTable)
      .values({ id: "author-1", name: "Ada", email: "ada@example.com" })
      .run();
    await db
      .insert(postTable)
      .values({
        id: "post-1",
        title: "Hello",
        body: "the quick brown fox",
        status: "published",
        published: true,
        rating: 12.34,
        meta: { tags: ["sqlite", "d1"] },
        publishedAt: new Date(1_700_000_000_000),
        author: "author-1",
      })
      .run();

    const rows = (await db.select().from(postTable).all()) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    const row = rows.find((entry) => entry.id === "post-1") as Record<string, unknown>;
    expect(row.title).toBe("Hello");
    expect(row.status).toBe("published");
    expect(row.published).toBe(true);
    expect(row.rating).toBe(12.34);
    expect(row.meta).toEqual({ tags: ["sqlite", "d1"] });
    expect(row.publishedAt).toBeInstanceOf(Date);
    expect((row.publishedAt as Date).getTime()).toBe(1_700_000_000_000);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.author).toBe("author-1");
  });

  it("defaults choice, boolean and automatic columns", async () => {
    const db = createDrizzle(createD1Router(config, env).database("DB_MAIN"));
    const postTable = buildTable(Post);

    await db
      .insert(postTable)
      .values({ id: "post-2", title: "Defaults", author: "author-1" })
      .run();

    const rows = (await db.select().from(postTable).all()) as Array<Record<string, unknown>>;
    const row = rows.find((entry) => entry.id === "post-2") as Record<string, unknown>;
    expect(row.status).toBe("draft");
    expect(row.published).toBe(false);
    expect(row.body).toBeNull();
  });

  it("enforces the foreign key declared by the migration", async () => {
    const db = createDrizzle(createD1Router(config, env).database("DB_MAIN"));
    const postTable = buildTable(Post);

    await expect(
      db.insert(postTable).values({ id: "post-3", title: "Orphan", author: "missing" }).run(),
    ).rejects.toThrow();
  });
});

describe("createD1Router", () => {
  it("resolves a declared database", () => {
    const router = createD1Router(config, env);
    expect(router.database("DB_MAIN").binding).toBe("DB_MAIN");
  });

  it("rejects an unknown database", () => {
    const router = createD1Router(config, env);
    expect(() => router.database("DB_OTHER")).toThrow();
  });

  it("rejects a missing binding", () => {
    expect(() => createD1Router(config, {})).toThrow();
  });

  it("rejects a binding that is not a D1 database", () => {
    expect(() => createD1Router(config, { DB_MAIN: "not-a-database" })).toThrow();
  });
});
