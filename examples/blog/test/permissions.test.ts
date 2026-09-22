import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import {
  appointStaff,
  appointSuperuser,
  call,
  grantPermission,
  isKnown,
  joinGroup,
  json,
} from "./admin-helpers";

const SUPER = "root@example.com";
const EDITOR = "editor@example.com";
const VIEWER = "viewer@example.com";
const OUTSIDER = "outsider@example.com";

beforeAll(async () => {
  await applyD1Migrations(env.DB_MAIN, env.TEST_MIGRATIONS);
  await appointSuperuser(SUPER);

  // Provision the other accounts (a request creates their Clango user row), then grant authority.
  await call(EDITOR, "/admin/api/meta");
  await call(VIEWER, "/admin/api/meta");
  await call(OUTSIDER, "/admin/api/meta");

  await appointStaff(EDITOR);
  await grantPermission(EDITOR, "blog.view_post");
  await grantPermission(EDITOR, "blog.change_post");

  await appointStaff(VIEWER);
  await grantPermission(VIEWER, "blog.view_post");
});

describe("staff gate", () => {
  it("refuses anonymous callers", async () => {
    const response = await call(null, "/admin/api/meta");
    expect(response.status).toBe(401);
    expect((response.body as { error: { code: string } }).error.code).toBe("unauthenticated");
  });

  it("refuses authenticated accounts that are not staff", async () => {
    const response = await call(OUTSIDER, "/admin/api/meta");
    expect(response.status).toBe(403);
    expect((response.body as { error: { code: string } }).error.code).toBe("forbidden");
  });

  it("provisions the account without granting any authority", async () => {
    expect(await isKnown(OUTSIDER)).toBe(true);
    const row = await env.DB_MAIN.prepare(
      "SELECT is_staff AS isStaff, is_superuser AS isSuperuser FROM clango_user WHERE email = ?",
    )
      .bind(OUTSIDER)
      .first<{ isStaff: number; isSuperuser: number }>();
    expect(row).toEqual({ isStaff: 0, isSuperuser: 0 });
  });

  it("lets staff in", async () => {
    expect((await call(VIEWER, "/admin/api/meta")).status).toBe(200);
  });
});

describe("permissions", () => {
  it("shows only the models a user can read", async () => {
    const meta = (await call(VIEWER, "/admin/api/meta")).body as {
      models: { name: string; permissions: Record<string, boolean> }[];
    };
    expect(meta.models.map((model) => model.name)).toEqual(["blog.Post"]);
    expect(meta.models[0]?.permissions).toEqual({
      view: true,
      add: false,
      change: false,
      delete: false,
    });
  });

  it("enforces each operation separately", async () => {
    // Reading is granted.
    expect((await call(VIEWER, "/admin/api/blog/post")).status).toBe(200);
    expect((await call(VIEWER, "/admin/api/blog/post/some-id")).status).toBe(404);

    // Writing is not: the caller can see posts but not change them.
    const created = await call(
      VIEWER,
      "/admin/api/blog/post",
      json("POST", { title: "Nope", slug: "nope", author: "a" }),
    );
    expect(created.status).toBe(403);

    // The model the user cannot read is invisible in every direction.
    expect((await call(VIEWER, "/admin/api/blog/author")).status).toBe(403);
  });

  it("allows an operation the user holds and refuses the ones they do not", async () => {
    const author = await call(
      SUPER,
      "/admin/api/blog/author",
      json("POST", { id: "perm-author", name: "Ada", email: "ada@example.com" }),
    );
    expect(author.status).toBe(201);

    const created = await call(
      EDITOR,
      "/admin/api/blog/post",
      json("POST", { id: "perm-post", title: "Editable", slug: "editable", author: "perm-author" }),
    );
    // `add` was never granted, even though `change` was.
    expect(created.status).toBe(403);

    const seeded = await call(
      SUPER,
      "/admin/api/blog/post",
      json("POST", { id: "perm-post-2", title: "Seed", slug: "seed", author: "perm-author" }),
    );
    expect(seeded.status).toBe(201);

    const updated = await call(
      EDITOR,
      "/admin/api/blog/post/perm-post-2",
      json("PATCH", { title: "Edited" }),
    );
    expect(updated.status).toBe(200);

    expect(
      (await call(EDITOR, "/admin/api/blog/post/perm-post-2", { method: "DELETE" })).status,
    ).toBe(403);
  });

  it("lets a superuser do anything", async () => {
    const created = await call(
      SUPER,
      "/admin/api/blog/post",
      json("POST", { id: "perm-root", title: "Root", slug: "root", author: "perm-author" }),
    );
    expect(created.status).toBe(201);
    expect((await call(SUPER, "/admin/api/blog/post/perm-root", { method: "DELETE" })).status).toBe(
      204,
    );
  });
});

describe("groups", () => {
  it("grants permissions through group membership", async () => {
    const email = "grouped@example.com";
    await call(email, "/admin/api/meta");
    await appointStaff(email);
    await joinGroup(email, "content-editors", ["blog.view_post", "blog.view_author"]);

    const meta = (await call(email, "/admin/api/meta")).body as { models: { name: string }[] };
    expect(meta.models.map((model) => model.name).sort()).toEqual(["blog.Author", "blog.Post"]);
  });
});

describe("audit attribution", () => {
  it("records which account performed the write", async () => {
    await call(
      SUPER,
      "/admin/api/blog/post",
      json("POST", { id: "perm-audit", title: "Audited", slug: "audited", author: "perm-author" }),
    );
    const row = await env.DB_MAIN.prepare(
      "SELECT user_id AS userId FROM clango_admin_log WHERE object_id = ?",
    )
      .bind("perm-audit")
      .first<{ userId: string | null }>();
    expect(row?.userId).toBe(`dev:${SUPER}`);
  });
});
