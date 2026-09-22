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
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  clearAdminRegistry,
  createAdminApp,
  registerAdmin,
  type ClangoAuthVariables,
} from "../src/index";

const Author = defineModel("blog.Author", {
  fields: {
    name: fields.string({ max: 120 }),
    email: fields.email({ unique: true }),
    bio: fields.text({ optional: true }),
  },
  meta: { labelField: "name" },
});

const Post = defineModel("blog.Post", {
  fields: {
    title: fields.string({ max: 200 }),
    slug: fields.slug({ unique: true }),
    body: fields.text({ searchable: true, optional: true }),
    status: fields.choice(["draft", "published"], { default: "draft" }),
    author: fields.foreignKey(() => Author, { onDelete: "cascade" }),
  },
  meta: { ordering: ["-createdAt"], labelField: "title" },
});

const Secret = defineModel("blog.Secret", {
  fields: { value: fields.string() },
});

let actionIds: readonly string[] = [];

const app = defineApp({
  name: "blog",
  models: [Author, Post, Secret] as readonly AnyModel[],
  database: "DB_MAIN",
});

const config = defineConfig({
  apps: [app],
  databases: { DB_MAIN: { binding: "DB_MAIN" } },
  admin: { enabled: true },
});

clearAdminRegistry();
registerAdmin(Post, {
  listDisplay: ["title", "author", "status"],
  listFilter: ["status", "author"],
  searchFields: ["title", "body"],
  readonlyFields: ["slug"],
  fieldsets: [
    { title: "Content", fields: ["title", "slug", "body"] },
    { title: "Publishing", fields: ["status", "author"] },
  ],
  actions: [
    {
      name: "publish",
      label: "Publish selected",
      description: "Marks the selected posts as published.",
      handler: (ids) => {
        actionIds = [...ids];
      },
    },
  ],
});
registerAdmin(Secret, { hidden: true });

let admin: Hono<{ Bindings: object; Variables: ClangoAuthVariables }>;

async function request(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const response = await admin.request(path, init, env);
  const text = await response.text();
  const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
  return {
    status: response.status,
    body: text.length === 0 ? null : isJson ? JSON.parse(text) : text,
  };
}

function json(method: string, payload: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}

async function createAuthor(id: string, name = "Ada"): Promise<void> {
  const response = await request(
    "/admin/api/blog/author",
    json("POST", { id, name, email: `${id}@example.com` }),
  );
  expect(response.status).toBe(201);
}

async function createPost(id: string, author: string, title = "Hello"): Promise<void> {
  const response = await request(
    "/admin/api/blog/post",
    json("POST", { id, title, slug: `slug-${id}`, author }),
  );
  expect(response.status).toBe(201);
}

beforeAll(async () => {
  const plan = planMigration(emptySnapshot(), buildSnapshot(collectRegistry(config)));
  await env.DB_MAIN.batch(plan.statements.map((statement) => env.DB_MAIN.prepare(statement)));
  admin = createAdminApp(config);
});

beforeEach(() => {
  actionIds = [];
});

describe("meta", () => {
  it("lists registered models with their field metadata", async () => {
    const response = await request("/admin/api/meta");
    expect(response.status).toBe(200);
    const meta = response.body as { models: { name: string }[]; user: unknown };
    expect(meta.models.map((model) => model.name)).toEqual(["blog.Author", "blog.Post"]);
    expect(meta.user).toBeNull();
  });

  it("excludes hidden models and the admin log", async () => {
    const meta = (await request("/admin/api/meta")).body as { models: { name: string }[] };
    const names = meta.models.map((model) => model.name);
    expect(names).not.toContain("blog.Secret");
    expect(names).not.toContain("clango.AdminLog");
  });

  it("describes widgets, requiredness and read-only fields", async () => {
    const meta = (await request("/admin/api/meta")).body as {
      models: {
        name: string;
        fields: { name: string; widget: string; required: boolean; editable: boolean }[];
      }[];
    };
    const post = meta.models.find((model) => model.name === "blog.Post");
    const field = (name: string) => post?.fields.find((entry) => entry.name === name);
    expect(field("title")?.widget).toBe("text");
    expect(field("title")?.required).toBe(true);
    expect(field("body")?.widget).toBe("textarea");
    expect(field("body")?.required).toBe(false);
    expect(field("status")?.widget).toBe("select");
    expect(field("author")?.widget).toBe("relation");
    expect(field("slug")?.editable).toBe(false);
    expect(field("id")?.editable).toBe(false);
    expect(field("createdAt")?.editable).toBe(false);
  });

  it("carries list, filter, search and fieldset configuration", async () => {
    const meta = (await request("/admin/api/meta")).body as {
      models: {
        name: string;
        listDisplay: string[];
        listFilter: string[];
        searchFields: string[];
        ordering: string[];
        fieldsets: { title: string; fields: string[] }[];
        actions: { name: string; label: string }[];
        path: string;
      }[];
    };
    const post = meta.models.find((model) => model.name === "blog.Post");
    expect(post?.listDisplay).toEqual(["title", "author", "status"]);
    expect(post?.listFilter).toEqual(["status", "author"]);
    expect(post?.searchFields).toEqual(["title", "body"]);
    expect(post?.ordering).toEqual(["-createdAt"]);
    expect(post?.fieldsets.map((fieldset) => fieldset.title)).toEqual(["Content", "Publishing"]);
    expect(post?.actions).toEqual([
      {
        name: "publish",
        label: "Publish selected",
        description: "Marks the selected posts as published.",
      },
    ]);
    expect(post?.path).toBe("/admin/blog/post");
  });

  it("exposes the related model and its label field for relations", async () => {
    const meta = (await request("/admin/api/meta")).body as {
      models: {
        name: string;
        fields: { name: string; related?: { model: string; labelField?: string } }[];
      }[];
    };
    const field = meta.models
      .find((model) => model.name === "blog.Post")
      ?.fields.find((entry) => entry.name === "author");
    expect(field?.related).toEqual({ model: "blog.Author", labelField: "name" });
  });

  it("defaults list configuration for unregistered models", async () => {
    const meta = (await request("/admin/api/meta")).body as {
      models: { name: string; listDisplay: string[]; actions: unknown[] }[];
    };
    const author = meta.models.find((model) => model.name === "blog.Author");
    expect(author?.listDisplay).toEqual(["name", "email"]);
    expect(author?.actions).toEqual([]);
  });
});

describe("admin CRUD", () => {
  it("creates, reads, updates and deletes a row", async () => {
    await createAuthor("author-1");
    await createPost("post-1", "author-1");

    const read = await request("/admin/api/blog/post/post-1");
    expect(read.status).toBe(200);
    expect((read.body as { data: { title: string } }).data.title).toBe("Hello");

    const updated = await request(
      "/admin/api/blog/post/post-1",
      json("PATCH", { status: "published" }),
    );
    expect(updated.status).toBe(200);
    expect((updated.body as { data: { status: string } }).data.status).toBe("published");

    const deleted = await request("/admin/api/blog/post/post-1", { method: "DELETE" });
    expect(deleted.status).toBe(204);
    expect((await request("/admin/api/blog/post/post-1")).status).toBe(404);
  });

  it("validates payloads and rejects unknown fields", async () => {
    const invalid = await request("/admin/api/blog/post", json("POST", { title: "No slug" }));
    expect(invalid.status).toBe(400);
    expect((invalid.body as { error: { code: string } }).error.code).toBe("validation_error");

    const unknown = await request(
      "/admin/api/blog/post",
      json("POST", { title: "T", slug: "t", author: "author-1", nope: 1 }),
    );
    expect(unknown.status).toBe(400);
  });

  it("lists with filters, search and bounded counts", async () => {
    await createPost("post-search", "author-1", "Searchable post");
    await request(
      "/admin/api/blog/post/post-search",
      json("PATCH", { body: "a quick brown fox", status: "published" }),
    );

    const searched = await request("/admin/api/blog/post?search=brown");
    expect(searched.status).toBe(200);
    const rows = (searched.body as { data: { id: string }[] }).data;
    expect(rows.map((row) => row.id)).toContain("post-search");

    const filtered = await request("/admin/api/blog/post?status=published");
    const page = (filtered.body as { page: { count: number; countCapped: boolean } }).page;
    expect(page.countCapped).toBe(false);
    expect(page.count).toBeGreaterThan(0);
    expect(
      (filtered.body as { data: { status: string }[] }).data.every(
        (row) => row.status === "published",
      ),
    ).toBe(true);
  });

  it("returns a JSON 404 for an unknown endpoint", async () => {
    const response = await request("/admin/api/blog/unknown");
    expect(response.status).toBe(404);
    expect((response.body as { error: { code: string } }).error.code).toBe("not_found");
  });
});

describe("audit log", () => {
  async function logEntries(): Promise<
    { action: string; modelName: string; objectId: string; diff: Record<string, unknown> | null }[]
  > {
    const rows = await env.DB_MAIN.prepare(
      "SELECT action, model_name AS modelName, object_id AS objectId, diff FROM clango_admin_log " +
        "ORDER BY created_at, id",
    ).all<{ action: string; modelName: string; objectId: string; diff: string | null }>();
    return rows.results.map((row) => ({
      action: row.action,
      modelName: row.modelName,
      objectId: row.objectId,
      diff: row.diff === null ? null : (JSON.parse(row.diff) as Record<string, unknown>),
    }));
  }

  it("records create, update and delete", async () => {
    await createAuthor("author-log");
    await createPost("post-log", "author-log", "Logged");
    await request("/admin/api/blog/post/post-log", json("PATCH", { status: "published" }));
    await request("/admin/api/blog/post/post-log", { method: "DELETE" });

    const entries = (await logEntries()).filter((entry) => entry.objectId === "post-log");
    expect(entries.map((entry) => entry.action)).toEqual(["create", "update", "delete"]);
    expect(entries[0]?.modelName).toBe("blog.Post");
    expect(entries[1]?.diff).toEqual({ status: { from: "draft", to: "published" } });
    expect(entries[2]?.diff).toMatchObject({ id: "post-log", title: "Logged" });
  });

  it("writes the log in the same batch as the mutation, so a failed write logs nothing", async () => {
    await createAuthor("author-atomic");
    await createPost("post-atomic", "author-atomic", "Atomic");
    expect((await logEntries()).filter((entry) => entry.objectId === "post-atomic")).toHaveLength(
      1,
    );

    const before = (await logEntries()).length;
    const duplicate = await request(
      "/admin/api/blog/post",
      json("POST", {
        id: "post-atomic-2",
        title: "Duplicate",
        slug: "slug-post-atomic",
        author: "author-atomic",
      }),
    );
    expect(duplicate.status).toBe(409);

    const after = (await logEntries()).length;
    expect(after).toBe(before);
  });

  it("records no diff when an update changes nothing", async () => {
    await createAuthor("author-noop");
    await createPost("post-noop", "author-noop", "Same");
    await request("/admin/api/blog/post/post-noop", json("PATCH", { title: "Same" }));
    const entries = (await logEntries()).filter((entry) => entry.objectId === "post-noop");
    expect(entries.map((entry) => entry.action)).toEqual(["create", "update"]);
    expect(entries[1]?.diff).toBeNull();
  });
});

describe("cascade preview", () => {
  it("reports the rows a delete would remove", async () => {
    await createAuthor("author-cascade");
    await createPost("post-cascade-1", "author-cascade");
    await createPost("post-cascade-2", "author-cascade");

    const response = await request("/admin/api/blog/author/author-cascade/cascade");
    expect(response.status).toBe(200);
    const data = (
      response.body as {
        data: {
          related: {
            model: string;
            field: string;
            action: string;
            count: number;
            sample: string[];
          }[];
        };
      }
    ).data;
    expect(data.related).toHaveLength(1);
    expect(data.related[0]).toMatchObject({
      model: "blog.Post",
      field: "author",
      action: "cascade",
      count: 2,
      capped: false,
    });
    expect(data.related[0]?.sample.sort()).toEqual(["post-cascade-1", "post-cascade-2"]);
  });

  it("returns 404 for a missing row", async () => {
    expect((await request("/admin/api/blog/author/missing/cascade")).status).toBe(404);
  });
});

describe("relation options", () => {
  it("returns id and label pairs", async () => {
    await createAuthor("author-options", "Grace");
    const response = await request("/admin/api/blog/author/options?limit=10");
    expect(response.status).toBe(200);
    const data = (response.body as { data: { id: string; label: string }[] }).data;
    expect(data).toContainEqual({ id: "author-options", label: "Grace" });
  });

  it("filters by label prefix", async () => {
    const response = await request("/admin/api/blog/author/options?q=Gra");
    const data = (response.body as { data: { label: string }[] }).data;
    expect(data.map((option) => option.label)).toContain("Grace");
  });

  it("rejects an out-of-range limit", async () => {
    expect((await request("/admin/api/blog/author/options?limit=0")).status).toBe(400);
  });
});

describe("actions", () => {
  it("runs a registered action over the selected ids", async () => {
    const response = await request(
      "/admin/api/blog/post/actions/publish",
      json("POST", { ids: ["post-1", "post-1", "post-2"] }),
    );
    expect(response.status).toBe(200);
    expect((response.body as { data: { affected: number } }).data.affected).toBe(2);
    expect(actionIds).toEqual(["post-1", "post-2"]);
  });

  it("rejects an unknown action", async () => {
    expect(
      (await request("/admin/api/blog/post/actions/nope", json("POST", { ids: ["a"] }))).status,
    ).toBe(404);
  });

  it("rejects an empty selection", async () => {
    expect(
      (await request("/admin/api/blog/post/actions/publish", json("POST", { ids: [] }))).status,
    ).toBe(400);
  });
});

describe("label lookup", () => {
  it("resolves specific ids", async () => {
    await createAuthor("author-labels", "Hopper");
    const response = await request("/admin/api/blog/author/options?ids=author-labels,missing");
    const data = (response.body as { data: { id: string; label: string }[] }).data;
    expect(data).toEqual([{ id: "author-labels", label: "Hopper" }]);
  });

  it("rejects too many ids", async () => {
    const ids = Array.from({ length: 101 }, (_, index) => `id-${index}`).join(",");
    expect((await request(`/admin/api/blog/author/options?ids=${ids}`)).status).toBe(400);
  });
});
