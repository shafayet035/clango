import {
  MigrationError,
  collectRegistry,
  defineApp,
  defineConfig,
  defineModel,
  fields,
  type AnyModel,
} from "@clango/core";
import { describe, expect, it } from "vitest";

import {
  buildSnapshot,
  emptySnapshot,
  parseSnapshot,
  planMigration,
  serializeSnapshot,
  type SchemaSnapshot,
} from "../src/index";

function snapshot(models: readonly AnyModel[]): SchemaSnapshot {
  const config = defineConfig({
    apps: [defineApp({ name: "blog", models })],
    databases: { DB_MAIN: { binding: "DB_MAIN" } },
  });
  return buildSnapshot(collectRegistry(config));
}

const Author = defineModel("blog.Author", {
  fields: {
    name: fields.string({ max: 120 }),
    email: fields.email({ unique: true }),
  },
});

const AuthorRelaxed = defineModel("blog.Author", {
  fields: {
    name: fields.string({ max: 120, optional: true }),
    email: fields.email({ unique: true }),
  },
});

const baseFields = {
  title: fields.string({ max: 200 }),
  body: fields.text({ searchable: true, optional: true }),
  status: fields.choice(["draft", "published"], { default: "draft" }),
  author: fields.foreignKey(() => Author, { onDelete: "cascade" }),
};

const Post = defineModel("blog.Post", { fields: { ...baseFields } });

const PostWithExcerpt = defineModel("blog.Post", {
  fields: { ...baseFields, excerpt: fields.string({ optional: true }) },
});

const PostWithExtraStatus = defineModel("blog.Post", {
  fields: {
    ...baseFields,
    status: fields.choice(["draft", "published", "archived"], { default: "draft" }),
  },
});

const PostWithSummary = defineModel("blog.Post", {
  fields: { ...baseFields, summary: fields.text({ searchable: true, optional: true }) },
});

const PostWithoutBody = defineModel("blog.Post", {
  fields: {
    title: baseFields.title,
    status: baseFields.status,
    author: baseFields.author,
  },
});

const PostNoAuthor = defineModel("blog.Post", {
  fields: {
    title: baseFields.title,
    body: baseFields.body,
    status: baseFields.status,
  },
});

const PostOptionalAuthor = defineModel("blog.Post", {
  fields: {
    title: baseFields.title,
    body: baseFields.body,
    status: baseFields.status,
    author: fields.foreignKey(() => Author, { onDelete: "cascade", optional: true }),
  },
});

const PostRequiredExcerpt = defineModel("blog.Post", {
  fields: { ...baseFields, excerpt: fields.string() },
});

const initial = snapshot([Author, Post]);

describe("buildSnapshot", () => {
  it("creates one table per model with automatic columns first", () => {
    const table = initial.tables.find((entry) => entry.name === "blog_post");
    expect(table?.columns.map((column) => column.name)).toEqual([
      "id",
      "created_at",
      "updated_at",
      "title",
      "body",
      "status",
      "author",
    ]);
  });

  it("marks optional fields as nullable", () => {
    const table = initial.tables.find((entry) => entry.name === "blog_post");
    expect(table?.columns.find((column) => column.name === "body")?.notNull).toBe(false);
    expect(table?.columns.find((column) => column.name === "title")?.notNull).toBe(true);
  });

  it("records choice constraints", () => {
    const table = initial.tables.find((entry) => entry.name === "blog_post");
    expect(table?.checks).toEqual([
      {
        name: "blog_post_status_check",
        expression: `"status" IN ('draft', 'published')`,
      },
    ]);
  });

  it("records foreign keys with their referential action", () => {
    const table = initial.tables.find((entry) => entry.name === "blog_post");
    expect(table?.foreignKeys).toEqual([
      {
        columns: ["author"],
        refTable: "blog_author",
        refColumns: ["id"],
        onDelete: "cascade",
      },
    ]);
  });

  it("indexes unique, indexed and foreign key columns", () => {
    const names = initial.indexes.map((index) => index.name);
    expect(names).toContain("uniq_blog_author_email");
    expect(names).toContain("idx_blog_post_author");
  });

  it("creates an FTS mirror for searchable fields", () => {
    expect(initial.fts).toEqual([
      { table: "blog_post_fts", sourceTable: "blog_post", columns: ["body"] },
    ]);
  });

  it("creates a join table for many-to-many fields", () => {
    const Tag = defineModel("blog.Tag", { fields: { name: fields.string() } });
    const TaggedPost = defineModel("blog.TaggedPost", {
      fields: { title: fields.string(), tags: fields.manyToMany(() => Tag) },
    });
    const result = snapshot([Tag, TaggedPost]);
    const join = result.tables.find((table) => table.name === "blog_tagged_post_tags");
    expect(join?.columns.map((column) => column.name)).toEqual(["tagged_post_id", "tag_id"]);
    expect(join?.primaryKey).toEqual(["tagged_post_id", "tag_id"]);
    expect(join?.foreignKeys.map((key) => key.refTable)).toEqual(["blog_tagged_post", "blog_tag"]);
  });

  it("is sorted deterministically", () => {
    const names = initial.tables.map((table) => table.name);
    expect(names).toEqual([...names].sort());
  });
});

describe("snapshot serialization", () => {
  it("round-trips", () => {
    const parsed = parseSnapshot(serializeSnapshot(initial));
    expect(parsed).toEqual(initial);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseSnapshot("{")).toThrow(MigrationError);
  });

  it("rejects an unsupported version", () => {
    expect(() =>
      parseSnapshot(JSON.stringify({ version: 99, tables: [], indexes: [], fts: [] })),
    ).toThrow(MigrationError);
  });
});

describe("planMigration", () => {
  it("creates every table, index and FTS table from an empty snapshot", () => {
    const plan = planMigration(emptySnapshot(), initial);
    expect(plan.destructive).toEqual([]);
    expect(plan.statements[0]).toContain('CREATE TABLE "blog_author"');
    expect(
      plan.statements.some((sql) => sql.includes('CREATE UNIQUE INDEX "uniq_blog_author_email"')),
    ).toBe(true);
    expect(
      plan.statements.some((sql) => sql.includes('CREATE VIRTUAL TABLE "blog_post_fts"')),
    ).toBe(true);
    expect(plan.statements.some((sql) => sql.includes("CREATE TRIGGER"))).toBe(true);
    expect(plan.statements).not.toContain("PRAGMA defer_foreign_keys = on");
  });

  it("produces no changes for an identical snapshot", () => {
    const plan = planMigration(initial, snapshot([Author, Post]));
    expect(plan.statements).toEqual([]);
    expect(plan.summary).toEqual([]);
  });

  it("adds an optional column without rebuilding", () => {
    const plan = planMigration(initial, snapshot([Author, PostWithExcerpt]));
    expect(plan.statements).toEqual([`ALTER TABLE "blog_post" ADD COLUMN "excerpt" TEXT`]);
    expect(plan.destructive).toEqual([]);
    expect(plan.changes.some((change) => change.kind === "addColumn")).toBe(true);
  });

  it("refuses to add a required column without a default", () => {
    expect(() => planMigration(initial, snapshot([Author, PostRequiredExcerpt]))).toThrow(
      MigrationError,
    );
  });

  it("rebuilds the table when a check constraint changes", () => {
    const plan = planMigration(initial, snapshot([Author, PostWithExtraStatus]));
    const rebuild = plan.changes.find((change) => change.kind === "rebuildTable");
    expect(rebuild?.kind).toBe("rebuildTable");
    expect(plan.statements[0]).toBe("PRAGMA defer_foreign_keys = on");
    expect(
      plan.statements.some((sql) => sql.startsWith('CREATE TABLE "blog_post__clango_new" (')),
    ).toBe(true);
    expect(plan.statements).toContain('DROP TABLE "blog_post"');
    expect(plan.statements).toContain('ALTER TABLE "blog_post__clango_new" RENAME TO "blog_post"');
    expect(plan.destructive).toEqual([]);
  });

  it("rebuilds and reports a dropped column as destructive", () => {
    const plan = planMigration(initial, snapshot([Author, PostWithoutBody]));
    expect(plan.destructive).toEqual(['Drop column "blog_post"."body"']);
    expect(plan.statements).toContain('DROP TABLE "blog_post"');
    expect(plan.statements).toContain('DROP TABLE IF EXISTS "blog_post_fts"');
  });

  it("backs up and restores cascade children when rebuilding their parent", () => {
    const plan = planMigration(initial, snapshot([AuthorRelaxed, Post]));
    const backup = 'CREATE TABLE "blog_post__clango_bak" AS SELECT * FROM "blog_post"';
    const restore = 'INSERT INTO "blog_post" SELECT * FROM "blog_post__clango_bak"';
    expect(plan.statements).toContain(backup);
    expect(plan.statements).toContain('DELETE FROM "blog_post"');
    expect(plan.statements).toContain(restore);
    expect(plan.statements).toContain('DROP TABLE "blog_post__clango_bak"');

    const rebuildIndex = plan.statements.indexOf('DROP TABLE "blog_author"');
    expect(plan.statements.indexOf(backup)).toBeLessThan(rebuildIndex);
    expect(plan.statements.indexOf(restore)).toBeGreaterThan(rebuildIndex);
  });

  it("drops an FTS mirror when no searchable fields remain", () => {
    const plan = planMigration(initial, snapshot([Author, PostWithoutBody]));
    expect(plan.changes.some((change) => change.kind === "rebuildTable")).toBe(true);
    expect(
      plan.statements.some((sql) => sql.includes('DROP TRIGGER IF EXISTS "blog_post_fts_ai"')),
    ).toBe(true);
  });

  it("recreates the FTS mirror when searchable fields change without rebuilding", () => {
    const plan = planMigration(initial, snapshot([Author, PostWithSummary]));
    expect(plan.changes.some((change) => change.kind === "recreateFts")).toBe(true);
    expect(
      plan.statements.some((sql) => sql.includes('DROP TABLE IF EXISTS "blog_post_fts"')),
    ).toBe(true);
    expect(
      plan.statements.some((sql) => sql.includes('CREATE VIRTUAL TABLE "blog_post_fts"')),
    ).toBe(true);
    expect(plan.statements.some((sql) => sql.includes('INSERT INTO "blog_post_fts"'))).toBe(true);
    expect(plan.destructive).toEqual([]);
  });

  it("drops a removed model and reports it as destructive", () => {
    const plan = planMigration(initial, snapshot([Author]));
    expect(plan.destructive).toEqual(['Drop table "blog_post"']);
    expect(plan.statements.some((sql) => sql.includes('DROP TABLE "blog_post"'))).toBe(true);
  });

  it("refuses to drop a table that a remaining table references", () => {
    expect(() => planMigration(initial, snapshot([Post]))).toThrow(MigrationError);
  });

  it("rebuilds when a foreign key is added, because SQLite cannot alter constraints", () => {
    const plan = planMigration(
      snapshot([Author, PostNoAuthor]),
      snapshot([Author, PostOptionalAuthor]),
    );
    expect(plan.changes.some((change) => change.kind === "rebuildTable")).toBe(true);
    expect(plan.statements.some((sql) => sql.includes('FOREIGN KEY ("author")'))).toBe(true);
    expect(plan.statements.some((sql) => sql.includes('CREATE INDEX "idx_blog_post_author"'))).toBe(
      true,
    );
  });

  it("refuses to add a required foreign key without a default", () => {
    expect(() => planMigration(snapshot([Author, PostNoAuthor]), snapshot([Author, Post]))).toThrow(
      MigrationError,
    );
  });

  it("adds a column before recreating the FTS mirror that indexes it", () => {
    const plan = planMigration(initial, snapshot([Author, PostWithSummary]));
    const addIndex = plan.statements.findIndex((sql) => sql.includes('ADD COLUMN "summary"'));
    const populateIndex = plan.statements.findIndex((sql) =>
      sql.includes('INSERT INTO "blog_post_fts"'),
    );
    expect(addIndex).toBeGreaterThanOrEqual(0);
    expect(populateIndex).toBeGreaterThan(addIndex);
  });

  it("is deterministic", () => {
    const first = planMigration(emptySnapshot(), initial);
    const second = planMigration(emptySnapshot(), initial);
    expect(first.statements).toEqual(second.statements);
  });
});
