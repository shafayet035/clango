import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { SUPERUSER, appointSuperuser, call, json, type CallResult } from "./admin-helpers";

/** Every admin request acts as the appointed superuser. */
const asAdmin = (path: string, init?: RequestInit): Promise<CallResult> =>
  call(SUPERUSER, path, init);

beforeAll(async () => {
  await applyD1Migrations(env.DB_MAIN, env.TEST_MIGRATIONS);
  await appointSuperuser(SUPERUSER);
});

describe("admin metadata", () => {
  it("describes the registered models with their admin configuration", async () => {
    const response = await asAdmin("/admin/api/meta");
    expect(response.status).toBe(200);
    const meta = response.body as {
      models: {
        name: string;
        listDisplay: string[];
        fieldsets: { title: string }[];
        actions: unknown[];
      }[];
      user: unknown;
    };
    const post = meta.models.find((model) => model.name === "blog.Post");
    expect(post?.listDisplay).toEqual(["title", "author", "status", "publishedAt"]);
    expect(post?.fieldsets.map((fieldset) => fieldset.title)).toEqual(["Content", "Publishing"]);
    // M4: the caller is authenticated, and the metadata reports who they are.
    expect(meta.user).toEqual({ id: `dev:${SUPERUSER}`, isStaff: true, isSuperuser: true });
  });

  it("excludes the framework's own tables", async () => {
    const meta = (await asAdmin("/admin/api/meta")).body as { models: { name: string }[] };
    expect(meta.models.map((model) => model.name)).not.toContain("clango.AdminLog");
  });
});

describe("admin writes", () => {
  it("creates, updates and deletes, recording each action in the audit log", async () => {
    const author = await asAdmin(
      "/admin/api/blog/author",
      json("POST", { id: "admin-author", name: "Ada", email: "ada@example.com" }),
    );
    expect(author.status).toBe(201);

    const created = await asAdmin(
      "/admin/api/blog/post",
      json("POST", {
        id: "admin-post",
        title: "Draft",
        slug: "admin-post",
        author: "admin-author",
      }),
    );
    expect(created.status).toBe(201);

    const updated = await asAdmin(
      "/admin/api/blog/post/admin-post",
      json("PATCH", { status: "published" }),
    );
    expect(updated.status).toBe(200);
    expect((updated.body as { data: { status: string } }).data.status).toBe("published");

    expect((await asAdmin("/admin/api/blog/post/admin-post", { method: "DELETE" })).status).toBe(
      204,
    );

    const log = await env.DB_MAIN.prepare(
      "SELECT action, model_name AS modelName, diff FROM clango_admin_log WHERE object_id = ? ORDER BY created_at, id",
    )
      .bind("admin-post")
      .all<{ action: string; modelName: string; diff: string | null }>();
    expect(log.results.map((row) => row.action)).toEqual(["create", "update", "delete"]);
    expect(log.results.every((row) => row.modelName === "blog.Post")).toBe(true);
    expect(JSON.parse(log.results[1]?.diff ?? "null")).toEqual({
      status: { from: "draft", to: "published" },
    });
  });

  it("previews the cascade before deleting a parent", async () => {
    await asAdmin(
      "/admin/api/blog/author",
      json("POST", { id: "cascade-author", name: "Grace", email: "grace@example.com" }),
    );
    await asAdmin(
      "/admin/api/blog/post",
      json("POST", {
        id: "cascade-post",
        title: "Child",
        slug: "cascade-post",
        author: "cascade-author",
      }),
    );

    const preview = await asAdmin("/admin/api/blog/author/cascade-author/cascade");
    expect(preview.status).toBe(200);
    const related = (
      preview.body as { data: { related: { model: string; action: string; count: number }[] } }
    ).data.related;
    expect(related).toEqual([
      {
        model: "blog.Post",
        field: "author",
        action: "cascade",
        count: 1,
        capped: false,
        sample: ["cascade-post"],
      },
    ]);
  });

  it("rejects invalid admin payloads", async () => {
    const response = await asAdmin("/admin/api/blog/post", json("POST", { title: "No slug" }));
    expect(response.status).toBe(400);
    expect((response.body as { error: { code: string } }).error.code).toBe("validation_error");
  });
});

describe("routing boundaries", () => {
  it("returns JSON for unknown API endpoints", async () => {
    const api = await asAdmin("/api/blog/does-not-exist");
    expect(api.status).toBe(404);
    expect(api.contentType).toContain("application/json");
    expect((api.body as { error: { code: string } }).error.code).toBe("not_found");

    const admin = await asAdmin("/admin/api/blog/does-not-exist");
    expect(admin.status).toBe(404);
    expect(admin.contentType).toContain("application/json");
  });

  it("leaves /admin/* to the static asset layer", async () => {
    // `run_worker_first` excludes /admin/*, so the asset layer serves the SPA shell. The Worker must
    // therefore not claim those paths — a catch-all here would shadow the admin.
    const response = await call(null, "/admin/blog/post");
    expect(response.contentType).not.toContain("application/json");
    expect(response.status).toBe(404);
  });

  it("keeps the worker's own routes reachable", async () => {
    expect((await call(null, "/")).status).toBe(200);
    expect((await call(null, "/health")).status).toBe(200);
  });
});
