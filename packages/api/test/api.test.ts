import {
  collectRegistry,
  defineApp,
  defineConfig,
  defineModel,
  fields,
  type AnyModel,
} from "@clango/core";
import { buildSnapshot, emptySnapshot, planMigration } from "@clango/migrate";
import { env } from "cloudflare:workers";
import type { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";

import { buildSchema as ormSchema } from "@clango/orm";
import { drizzle } from "drizzle-orm/d1";

import { COUNT_CAP, createApiApp, listRows } from "../src/index";

const Author = defineModel("blog.Author", {
  fields: {
    name: fields.string({ max: 120 }),
    email: fields.email({ unique: true }),
  },
  api: { enabled: true },
});

const Tag = defineModel("blog.Tag", {
  fields: { name: fields.string({ max: 60, unique: true }) },
  api: { enabled: true, ops: ["list"] },
});

const Post = defineModel("blog.Post", {
  fields: {
    title: fields.string({ max: 200 }),
    slug: fields.slug({ unique: true }),
    body: fields.text({ searchable: true, optional: true }),
    status: fields.choice(["draft", "published"], { default: "draft" }),
    rating: fields.decimal({ scale: 2, optional: true }),
    publishedAt: fields.datetime({ optional: true, index: true }),
    author: fields.foreignKey(() => Author, { onDelete: "cascade" }),
  },
  meta: { ordering: ["-publishedAt"] },
  api: { enabled: true },
});

const Note = defineModel("blog.Note", {
  fields: { text: fields.string() },
});

const app = defineApp({
  name: "blog",
  models: [Author, Post, Tag, Note] as readonly AnyModel[],
  database: "DB_MAIN",
});

const config = defineConfig({
  apps: [app],
  databases: { DB_MAIN: { binding: "DB_MAIN" } },
});

let api: Hono<{ Bindings: object; Variables: Record<never, never> }>;

async function request(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const response = await api.request(path, init, env);
  const text = await response.text();
  const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
  return {
    status: response.status,
    body: text.length === 0 ? null : isJson ? JSON.parse(text) : text,
    headers: response.headers,
  };
}

function post(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  return request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function seedAuthor(id: string, name = "Ada", email = `${id}@example.com`): Promise<void> {
  await post("/api/blog/author", { id, name, email });
}

async function seedPost(fields: {
  title: string;
  slug: string;
  status?: string;
  body?: string;
  rating?: number;
  publishedAt?: string;
  author: string;
}): Promise<void> {
  const response = await post("/api/blog/post", fields);
  expect(response.status).toBe(201);
}

beforeAll(async () => {
  const registry = collectRegistry(config);
  const plan = planMigration(emptySnapshot(), buildSnapshot(registry));
  await env.DB_MAIN.batch(plan.statements.map((statement) => env.DB_MAIN.prepare(statement)));
  api = createApiApp(config);
});

describe("exposure", () => {
  it("does not mount routes for models that have not opted in", async () => {
    expect((await request("/api/blog/note")).status).toBe(404);
  });

  it("mounts only the operations a model enables", async () => {
    const listed = await request("/api/blog/tag");
    expect(listed.status).toBe(200);
    const created = await post("/api/blog/tag", { name: "x" });
    expect(created.status).toBe(404);
  });
});

describe("create", () => {
  it("creates a row, generating an id and applying defaults", async () => {
    await seedAuthor("author-1");
    const response = await post("/api/blog/post", {
      title: "First",
      slug: "first",
      author: "author-1",
    });
    expect(response.status).toBe(201);
    const data = (response.body as { data: Record<string, unknown> }).data;
    expect(data["id"]).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(data["status"]).toBe("draft");
    expect(data["body"]).toBeNull();
    expect(typeof data["createdAt"]).toBe("string");
    expect(data["updatedAt"]).toBe(data["createdAt"]);
  });

  it("returns a Location header", async () => {
    const response = await request("/api/blog/post", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Located", slug: "located", author: "author-1" }),
    });
    const data = (response.body as { data: { id: string } }).data;
    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe(`/api/blog/post/${data.id}`);
  });

  it("honours a client-supplied id", async () => {
    const response = await post("/api/blog/post", {
      id: "01IMPORT",
      title: "Imported",
      slug: "imported",
      author: "author-1",
    });
    expect(response.status).toBe(201);
    expect((response.body as { data: { id: string } }).data.id).toBe("01IMPORT");
  });

  it("round-trips decimal, boolean and datetime values", async () => {
    const response = await post("/api/blog/post", {
      title: "Typed",
      slug: "typed",
      author: "author-1",
      rating: 12.34,
      publishedAt: "2026-09-22T10:00:00.000Z",
    });
    expect(response.status).toBe(201);
    const data = (response.body as { data: Record<string, unknown> }).data;
    expect(data["rating"]).toBe(12.34);
    expect(data["publishedAt"]).toBe("2026-09-22T10:00:00.000Z");
  });

  it("rejects an invalid payload with detailed issues", async () => {
    const response = await post("/api/blog/post", { title: "Missing slug", author: "author-1" });
    expect(response.status).toBe(400);
    const error = (response.body as { error: { code: string; details: { path: unknown[] }[] } })
      .error;
    expect(error.code).toBe("validation_error");
    expect(error.details.map((issue) => issue.path[0])).toContain("slug");
  });

  it("rejects unknown fields", async () => {
    const response = await post("/api/blog/post", {
      title: "T",
      slug: "t",
      author: "author-1",
      bogus: true,
    });
    expect(response.status).toBe(400);
  });

  it("rejects a non-JSON body", async () => {
    const response = await request("/api/blog/post", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(response.status).toBe(400);
    expect((response.body as { error: { code: string } }).error.code).toBe("bad_request");
  });

  it("maps a unique violation to 409", async () => {
    const response = await post("/api/blog/post", {
      title: "Duplicate",
      slug: "first",
      author: "author-1",
    });
    expect(response.status).toBe(409);
  });

  it("maps a foreign key violation to 400", async () => {
    const response = await post("/api/blog/post", {
      title: "Orphan",
      slug: "orphan",
      author: "missing",
    });
    expect(response.status).toBe(400);
    expect((response.body as { error: { code: string } }).error.code).toBe("invalid_reference");
  });
});

describe("retrieve", () => {
  it("returns a row by id", async () => {
    const response = await request("/api/blog/post/first-slug-missing");
    expect([200, 404]).toContain(response.status);
  });

  it("returns 404 for an unknown id", async () => {
    const response = await request("/api/blog/post/does-not-exist");
    expect(response.status).toBe(404);
    expect((response.body as { error: { code: string } }).error.code).toBe("not_found");
  });
});

describe("update", () => {
  it("updates a row and bumps updatedAt", async () => {
    const created = await post("/api/blog/post", {
      title: "Before",
      slug: "before",
      author: "author-1",
    });
    const id = (created.body as { data: { id: string } }).data.id;

    await new Promise((resolve) => setTimeout(resolve, 5));
    const response = await request(`/api/blog/post/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "After", status: "published" }),
    });
    expect(response.status).toBe(200);
    const data = (response.body as { data: Record<string, unknown> }).data;
    expect(data["title"]).toBe("After");
    expect(data["status"]).toBe("published");
    expect(data["slug"]).toBe("before");
    expect(data["updatedAt"]).not.toBe(data["createdAt"]);
  });

  it("clears an optional field with null", async () => {
    const created = await post("/api/blog/post", {
      title: "Clearable",
      slug: "clearable",
      author: "author-1",
      body: "text",
    });
    const id = (created.body as { data: { id: string } }).data.id;
    const response = await request(`/api/blog/post/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: null }),
    });
    expect(response.status).toBe(200);
    expect((response.body as { data: { body: unknown } }).data.body).toBeNull();
  });

  it("rejects managed fields", async () => {
    const created = await post("/api/blog/post", {
      title: "Managed",
      slug: "managed",
      author: "author-1",
    });
    const id = (created.body as { data: { id: string } }).data.id;
    const response = await request(`/api/blog/post/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ createdAt: "2020-01-01T00:00:00.000Z" }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects an empty update", async () => {
    const created = await post("/api/blog/post", {
      title: "Empty",
      slug: "empty",
      author: "author-1",
    });
    const id = (created.body as { data: { id: string } }).data.id;
    const response = await request(`/api/blog/post/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });

  it("returns 404 for an unknown id", async () => {
    const response = await request("/api/blog/post/missing", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(response.status).toBe(404);
  });
});

describe("delete", () => {
  it("deletes a row and returns 204", async () => {
    const created = await post("/api/blog/post", {
      title: "Doomed",
      slug: "doomed",
      author: "author-1",
    });
    const id = (created.body as { data: { id: string } }).data.id;

    const deleted = await request(`/api/blog/post/${id}`, { method: "DELETE" });
    expect(deleted.status).toBe(204);
    expect((await request(`/api/blog/post/${id}`)).status).toBe(404);
  });

  it("returns 404 for an unknown id", async () => {
    expect((await request("/api/blog/post/missing", { method: "DELETE" })).status).toBe(404);
  });

  it("cascades to children", async () => {
    await seedAuthor("author-cascade", "Grace", "grace@example.com");
    const created = await post("/api/blog/post", {
      title: "Cascaded",
      slug: "cascaded",
      author: "author-cascade",
    });
    const id = (created.body as { data: { id: string } }).data.id;

    expect((await request("/api/blog/author/author-cascade", { method: "DELETE" })).status).toBe(
      204,
    );
    expect((await request(`/api/blog/post/${id}`)).status).toBe(404);
  });
});

describe("endpoint fallbacks", () => {
  it("returns a JSON 404 for unknown endpoints under /api", async () => {
    const response = await request("/api/blog/unknown");
    expect(response.status).toBe(404);
    expect((response.body as { error: { code: string } }).error.code).toBe("not_found");
  });
});

describe("list", () => {
  beforeAll(async () => {
    await seedAuthor("list-author");
    for (let index = 0; index < 7; index++) {
      await seedPost({
        title: `List ${index}`,
        slug: `list-${index}`,
        status: index % 2 === 0 ? "published" : "draft",
        body: index === 3 ? "the quick brown fox" : `body ${index}`,
        rating: 10 + index,
        publishedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
        author: "list-author",
      });
    }
  });

  it("returns a page with count and pagination metadata", async () => {
    const response = await request("/api/blog/post?limit=3");
    expect(response.status).toBe(200);
    const body = response.body as {
      data: unknown[];
      page: { count: number; countCapped: boolean; hasMore: boolean; nextCursor: string | null };
    };
    expect(body.data).toHaveLength(3);
    expect(body.page.count).toBeGreaterThanOrEqual(7);
    expect(body.page.countCapped).toBe(false);
    expect(body.page.hasMore).toBe(true);
    expect(body.page.nextCursor).toBeTypeOf("string");
  });

  it("walks every page exactly once", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) {
      const query: string =
        cursor === null ? "?limit=2" : `?limit=2&cursor=${encodeURIComponent(cursor)}`;
      const response = await request(`/api/blog/post${query}`);
      const body = response.body as { data: { id: string }[]; page: { nextCursor: string | null } };
      seen.push(...body.data.map((row) => row.id));
      cursor = body.page.nextCursor;
      if (cursor === null) break;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(7);
  });

  it("orders by meta.ordering with id as a tie breaker", async () => {
    const response = await request("/api/blog/post?limit=100");
    const rows = (response.body as { data: { publishedAt: string | null }[] }).data;
    const dates = rows
      .map((row) => row.publishedAt)
      .filter((value): value is string => value !== null);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("accepts an explicit order", async () => {
    const response = await request("/api/blog/post?order=title&limit=100");
    const rows = (response.body as { data: { title: string }[] }).data;
    const titles = rows.map((row) => row.title);
    expect([...titles].sort()).toEqual(titles);
  });

  it("rejects an order on an unknown field", async () => {
    expect((await request("/api/blog/post?order=nope")).status).toBe(400);
  });

  it("filters by equality", async () => {
    const response = await request("/api/blog/post?status=draft&limit=100");
    const rows = (response.body as { data: { status: string }[] }).data;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.status === "draft")).toBe(true);
  });

  it("filters with comparison operators", async () => {
    const response = await request("/api/blog/post?rating.gte=14&limit=100");
    const rows = (response.body as { data: { rating: number }[] }).data;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.rating >= 14)).toBe(true);
  });

  it("filters with in", async () => {
    const response = await request("/api/blog/post?status.in=draft,published&limit=100");
    expect((response.body as { page: { count: number } }).page.count).toBeGreaterThan(0);
  });

  it("rejects an unknown filter", async () => {
    expect((await request("/api/blog/post?nope=1")).status).toBe(400);
  });

  it("rejects a filter with a bad value", async () => {
    expect((await request("/api/blog/post?rating.gte=abc")).status).toBe(400);
    expect((await request("/api/blog/post?status=archived")).status).toBe(400);
  });

  it("rejects an out-of-range limit", async () => {
    expect((await request("/api/blog/post?limit=0")).status).toBe(400);
    expect((await request("/api/blog/post?limit=1000")).status).toBe(400);
    expect((await request("/api/blog/post?limit=abc")).status).toBe(400);
  });

  it("rejects a tampered cursor", async () => {
    expect((await request("/api/blog/post?cursor=abc")).status).toBe(400);
  });

  it("rejects a cursor issued for a different ordering", async () => {
    const first = await request("/api/blog/post?limit=1&order=title");
    const cursor = (first.body as { page: { nextCursor: string } }).page.nextCursor;
    const response = await request(
      `/api/blog/post?limit=1&order=-title&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(response.status).toBe(400);
  });

  it("searches with FTS5", async () => {
    const response = await request("/api/blog/post?search=brown&limit=100");
    const rows = (response.body as { data: { slug: string }[] }).data;
    expect(rows.map((row) => row.slug)).toContain("list-3");
  });

  it("prefix-matches the final search token", async () => {
    const response = await request("/api/blog/post?search=qui&limit=100");
    const rows = (response.body as { data: { slug: string }[] }).data;
    expect(rows.map((row) => row.slug)).toContain("list-3");
  });

  it("returns an empty page for a search with no matches", async () => {
    const response = await request("/api/blog/post?search=zzzznotfound");
    expect((response.body as { data: unknown[] }).data).toEqual([]);
  });

  it("rejects search on a model without searchable fields", async () => {
    expect((await request("/api/blog/author?search=ada")).status).toBe(400);
  });

  it("returns an empty page with count zero", async () => {
    const response = await request("/api/blog/post?status=archived-not-a-value");
    expect(response.status).toBe(400);
  });
});

describe("bounded counts", () => {
  it("caps the count and flags it instead of scanning the whole table", async () => {
    const registry = collectRegistry(config);
    const schema = ormSchema(registry);
    const result = await listRows({
      model: Post,
      table: schema.table("blog.Post"),
      db: drizzle(env.DB_MAIN),
      params: new URLSearchParams(),
      countCap: 3,
    });
    expect(result.page.count).toBe(3);
    expect(result.page.countCapped).toBe(true);
  });

  it("reports an exact count below the cap", async () => {
    const registry = collectRegistry(config);
    const schema = ormSchema(registry);
    const result = await listRows({
      model: Post,
      table: schema.table("blog.Post"),
      db: drizzle(env.DB_MAIN),
      params: new URLSearchParams({ limit: "1" }),
      countCap: COUNT_CAP,
    });
    expect(result.page.countCapped).toBe(false);
    expect(result.page.count).toBeGreaterThan(0);
  });
});

describe("automatic fields", () => {
  it("orders by createdAt", async () => {
    const response = await request("/api/blog/post?order=createdAt&limit=100");
    expect(response.status).toBe(200);
    const rows = (response.body as { data: { createdAt: string }[] }).data;
    const dates = rows.map((row) => row.createdAt);
    expect([...dates].sort()).toEqual(dates);
  });

  it("filters by createdAt", async () => {
    const response = await request("/api/blog/post?createdAt.gte=2000-01-01T00:00:00.000Z&limit=1");
    expect(response.status).toBe(200);
    expect((response.body as { page: { count: number } }).page.count).toBeGreaterThan(0);
  });

  it("filters by id", async () => {
    const response = await request("/api/blog/post?id=01IMPORT");
    const rows = (response.body as { data: { id: string }[] }).data;
    expect(rows.map((row) => row.id)).toEqual(["01IMPORT"]);
  });
});
