import { defineModel, fields } from "@clango/core";
import { describe, expect, it } from "vitest";

import { buildValidation } from "../src/validation";

const Post = defineModel("blog.Post", {
  fields: {
    title: fields.string({ max: 10 }),
    slug: fields.slug(),
    body: fields.text({ optional: true }),
    status: fields.choice(["draft", "published"], { default: "draft" }),
    rating: fields.decimal({ scale: 2, optional: true }),
    published: fields.boolean({ default: false }),
    publishedAt: fields.datetime({ optional: true }),
    author: fields.foreignKey(() => ({}) as never),
    tags: fields.manyToMany(() => ({}) as never),
  },
});

const schemas = buildValidation(Post);

describe("create schema", () => {
  it("accepts a minimal valid payload and applies nothing itself", () => {
    const result = schemas.create.safeParse({ title: "Hi", slug: "hi", author: "a1" });
    expect(result.success).toBe(true);
  });

  it("requires fields that are neither optional nor defaulted", () => {
    const result = schemas.create.safeParse({});
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path[0]).sort()).toEqual([
      "author",
      "slug",
      "title",
    ]);
  });

  it("rejects unknown keys", () => {
    const result = schemas.create.safeParse({ title: "Hi", slug: "hi", author: "a1", nope: 1 });
    expect(result.success).toBe(false);
  });

  it("enforces string length limits", () => {
    const result = schemas.create.safeParse({ title: "x".repeat(11), slug: "hi", author: "a1" });
    expect(result.success).toBe(false);
  });

  it("validates slugs", () => {
    expect(
      schemas.create.safeParse({ title: "Hi", slug: "Not A Slug", author: "a1" }).success,
    ).toBe(false);
    expect(schemas.create.safeParse({ title: "Hi", slug: "a-slug-2", author: "a1" }).success).toBe(
      true,
    );
  });

  it("constrains choice fields to their allowed values", () => {
    expect(
      schemas.create.safeParse({ title: "Hi", slug: "hi", author: "a1", status: "archived" })
        .success,
    ).toBe(false);
    expect(
      schemas.create.safeParse({ title: "Hi", slug: "hi", author: "a1", status: "published" })
        .success,
    ).toBe(true);
  });

  it("accepts ISO timestamps and epoch milliseconds, normalising both to Date", () => {
    const iso = schemas.create.safeParse({
      title: "Hi",
      slug: "hi",
      author: "a1",
      publishedAt: "2026-09-22T10:00:00.000Z",
    });
    expect(iso.success).toBe(true);
    if (iso.success) {
      expect((iso.data as { publishedAt: Date }).publishedAt).toBeInstanceOf(Date);
      expect((iso.data as { publishedAt: Date }).publishedAt.toISOString()).toBe(
        "2026-09-22T10:00:00.000Z",
      );
    }
    const epoch = schemas.create.safeParse({
      title: "Hi",
      slug: "hi",
      author: "a1",
      publishedAt: 1_700_000_000_000,
    });
    expect(epoch.success).toBe(true);
  });

  it("rejects unparseable timestamps", () => {
    expect(
      schemas.create.safeParse({ title: "Hi", slug: "hi", author: "a1", publishedAt: "soon" })
        .success,
    ).toBe(false);
  });

  it("allows optional fields to be null or omitted", () => {
    expect(
      schemas.create.safeParse({ title: "Hi", slug: "hi", author: "a1", body: null }).success,
    ).toBe(true);
    expect(schemas.create.safeParse({ title: "Hi", slug: "hi", author: "a1" }).success).toBe(true);
  });

  it("does not require defaulted fields", () => {
    const result = schemas.create.safeParse({ title: "Hi", slug: "hi", author: "a1" });
    expect(result.success).toBe(true);
    if (result.success) expect((result.data as Record<string, unknown>).status).toBeUndefined();
  });

  it("rejects many-to-many fields, which are managed through their join table", () => {
    const result = schemas.create.safeParse({
      title: "Hi",
      slug: "hi",
      author: "a1",
      tags: ["t1"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts an optional client-supplied id for imports", () => {
    expect(
      schemas.create.safeParse({ id: "01H", title: "Hi", slug: "hi", author: "a1" }).success,
    ).toBe(true);
    expect(
      schemas.create.safeParse({ id: "", title: "Hi", slug: "hi", author: "a1" }).success,
    ).toBe(false);
  });
});

describe("update schema", () => {
  it("accepts a single field", () => {
    expect(schemas.update.safeParse({ title: "New" }).success).toBe(true);
  });

  it("accepts an empty payload so the route can report nothing to update", () => {
    expect(schemas.update.safeParse({}).success).toBe(true);
  });

  it("rejects managed fields", () => {
    expect(schemas.update.safeParse({ id: "x" }).success).toBe(false);
    expect(schemas.update.safeParse({ createdAt: "2026-09-22T10:00:00.000Z" }).success).toBe(false);
    expect(schemas.update.safeParse({ updatedAt: "2026-09-22T10:00:00.000Z" }).success).toBe(false);
  });

  it("allows clearing an optional field with null but not a required one", () => {
    expect(schemas.update.safeParse({ body: null }).success).toBe(true);
    expect(schemas.update.safeParse({ title: null }).success).toBe(false);
  });
});
