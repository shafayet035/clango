import {
  collectRegistry,
  defineApp,
  defineConfig,
  defineModel,
  fields,
  type AnyModel,
  type AuthAdapter,
} from "@clango/core";
import { buildSnapshot, emptySnapshot, planMigration } from "@clango/migrate";
import { Authorization } from "@clango/auth";
import { buildSchema } from "@clango/orm";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import type { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";

import { createAdminApp, type ClangoAuthVariables } from "../src/index";

const Author = defineModel("blog.Author", {
  fields: { name: fields.string({ max: 120 }) },
  meta: { labelField: "name" },
});

const Post = defineModel("blog.Post", {
  fields: {
    title: fields.string({ max: 200 }),
    author: fields.foreignKey(() => Author, { onDelete: "cascade" }),
  },
  meta: { labelField: "title" },
});

/**
 * Test-only identity: the header names the caller. Real deployments plug in an auth library
 * through the same interface.
 */
const adapter: AuthAdapter = {
  getUser: async (request) => {
    const email = request.headers.get("x-test-user");
    if (email === null) return null;
    return { id: `auth:${email}`, email };
  },
};

const app = defineApp({
  name: "blog",
  models: [Author, Post] as readonly AnyModel[],
  database: "DB_MAIN",
});

const config = defineConfig({
  apps: [app],
  databases: { DB_MAIN: { binding: "DB_MAIN" } },
  admin: { enabled: true },
  auth: { enabled: true, adapter },
});

const registry = collectRegistry(config);
const schema = buildSchema(registry);
const authorization = new Authorization({ registry, schema });
const db = drizzle(env.DB_MAIN);

let admin: Hono<{ Bindings: object; Variables: ClangoAuthVariables }>;

async function as(
  email: string | null,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const headers = new Headers(init?.headers);
  if (email !== null) headers.set("x-test-user", email);
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  const response = await admin.request(path, { ...init, headers }, env);
  const text = await response.text();
  const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
  return {
    status: response.status,
    body: text.length === 0 ? null : isJson ? JSON.parse(text) : text,
  };
}

/** Provisions the user through one authenticated request, then returns their Clango id. */
async function userIdFor(email: string): Promise<string> {
  await as(email, "/admin/api/meta");
  const id = await authorization.findUserIdByEmail(db, email);
  if (id === undefined) throw new Error(`No Clango user for ${email}`);
  return id;
}

beforeAll(async () => {
  const plan = planMigration(emptySnapshot(), buildSnapshot(registry));
  await env.DB_MAIN.batch(plan.statements.map((statement) => env.DB_MAIN.prepare(statement)));
  admin = createAdminApp(config);

  // Staff authority is granted in Clango's tables, never claimed by the identity provider.
  await authorization.setFlags(db, "staff@example.com", { isStaff: true, isSuperuser: false });
  await authorization.setFlags(db, "super@example.com", { isStaff: true, isSuperuser: true });
  await authorization.setFlags(db, "su@example.com", { isStaff: true, isSuperuser: true });
  await authorization.setFlags(db, "su2@example.com", { isStaff: true, isSuperuser: true });
  await authorization.setFlags(db, "su3@example.com", { isStaff: true, isSuperuser: true });
});

describe("staff gate", () => {
  it("rejects anonymous callers with 401", async () => {
    const response = await as(null, "/admin/api/meta");
    expect(response.status).toBe(401);
    expect((response.body as { error: { code: string } }).error.code).toBe("unauthenticated");
  });

  it("provisions a non-staff account without any authority, then refuses it", async () => {
    await as("nosy@example.com", "/admin/api/meta");
    const response = await as("nosy@example.com", "/admin/api/meta");
    expect(response.status).toBe(403);
    const row = await env.DB_MAIN.prepare(
      "SELECT is_staff AS isStaff, is_superuser AS isSuperuser FROM clango_user WHERE email = ?",
    )
      .bind("nosy@example.com")
      .first<{ isStaff: number; isSuperuser: number }>();
    expect(row).toEqual({ isStaff: 0, isSuperuser: 0 });
  });

  it("allows staff accounts", async () => {
    expect((await as("staff@example.com", "/admin/api/meta")).status).toBe(200);
  });
});

describe("meta filtering", () => {
  it("hides models the user cannot view and reports their operations", async () => {
    const email = "viewer@example.com";
    await authorization.setFlags(db, email, { isStaff: true, isSuperuser: false });
    const userId = await userIdFor(email);
    await authorization.grantToUser(db, userId, "blog.view_post");

    const response = await as(email, "/admin/api/meta");
    const meta = response.body as {
      models: { name: string; permissions: Record<string, boolean> }[];
      user: { id: string; isStaff: boolean; isSuperuser: boolean };
    };
    expect(meta.models.map((model) => model.name)).toEqual(["blog.Post"]);
    expect(meta.models[0]?.permissions).toEqual({
      view: true,
      add: false,
      change: false,
      delete: false,
    });
    expect(meta.user).toEqual({ id: `auth:${email}`, isStaff: true, isSuperuser: false });
  });

  it("shows every model to a superuser", async () => {
    const response = await as("super@example.com", "/admin/api/meta");
    const meta = response.body as {
      models: { name: string; permissions: Record<string, boolean> }[];
    };
    expect(meta.models.map((model) => model.name)).toEqual(
      expect.arrayContaining(["blog.Author", "blog.Post"]),
    );
    expect(meta.models.every((model) => model.permissions["delete"] === true)).toBe(true);
  });
});

describe("per-operation enforcement", () => {
  it("allows a view-only user to list but not to write", async () => {
    const email = "readonly@example.com";
    await authorization.setFlags(db, email, { isStaff: true, isSuperuser: false });
    const userId = await userIdFor(email);
    await authorization.grantToUser(db, userId, "blog.view_post");

    expect((await as(email, "/admin/api/blog/post")).status).toBe(200);

    const created = await as(email, "/admin/api/blog/post", {
      method: "POST",
      body: JSON.stringify({ id: "p1", title: "Nope", author: "a1" }),
    });
    expect(created.status).toBe(403);

    const updated = await as(email, "/admin/api/blog/post/p1", {
      method: "PATCH",
      body: JSON.stringify({ title: "Nope" }),
    });
    expect(updated.status).toBe(403);

    expect((await as(email, "/admin/api/blog/post/p1", { method: "DELETE" })).status).toBe(403);
    expect((await as(email, "/admin/api/blog/author")).status).toBe(403);
  });

  it("allows a change-only user to update but not to delete", async () => {
    const email = "editor@example.com";
    await authorization.setFlags(db, email, { isStaff: true, isSuperuser: false });
    const userId = await userIdFor(email);
    await authorization.grantToUser(db, userId, "blog.view_post");
    await authorization.grantToUser(db, userId, "blog.change_post");

    const author = await as("su@example.com", "/admin/api/blog/author", {
      method: "POST",
      body: JSON.stringify({ id: "a1", name: "Ada" }),
    });
    expect(author.status).toBe(201);

    const created = await as(email, "/admin/api/blog/post", {
      method: "POST",
      body: JSON.stringify({ id: "p2", title: "Original", author: "a1" }),
    });
    // `add` was not granted, so creating is refused even though `change` allows writing later.
    expect(created.status).toBe(403);

    const seeded = await as("su@example.com", "/admin/api/blog/post", {
      method: "POST",
      body: JSON.stringify({ id: "p3", title: "Seeded", author: "a1" }),
    });
    expect(seeded.status).toBe(201);

    const updated = await as(email, "/admin/api/blog/post/p3", {
      method: "PATCH",
      body: JSON.stringify({ title: "Edited" }),
    });
    expect(updated.status).toBe(200);
    expect((updated.body as { data: { title: string } }).data.title).toBe("Edited");

    expect((await as(email, "/admin/api/blog/post/p3", { method: "DELETE" })).status).toBe(403);
  });

  it("enforces permissions on relation options and cascade previews", async () => {
    const email = "options@example.com";
    await authorization.setFlags(db, email, { isStaff: true, isSuperuser: false });
    const userId = await userIdFor(email);
    await authorization.grantToUser(db, userId, "blog.view_post");

    expect((await as(email, "/admin/api/blog/author/options")).status).toBe(403);
    expect((await as(email, "/admin/api/blog/post/p3/cascade")).status).toBe(403);
  });

  it("lets a superuser do anything", async () => {
    const created = await as("su2@example.com", "/admin/api/blog/post", {
      method: "POST",
      body: JSON.stringify({ id: "p4", title: "By superuser", author: "a1" }),
    });
    expect(created.status).toBe(201);
    expect(
      (await as("su2@example.com", "/admin/api/blog/post/p4", { method: "DELETE" })).status,
    ).toBe(204);
  });
});

describe("group permissions", () => {
  it("grants through a group", async () => {
    const email = "grouped@example.com";
    await authorization.setFlags(db, email, { isStaff: true, isSuperuser: false });
    const userId = await userIdFor(email);
    const groupId = await authorization.ensureGroup(db, "authors");
    await authorization.grantToGroup(db, groupId, "blog.view_author");
    await authorization.addUserToGroup(db, userId, groupId);

    const response = await as(email, "/admin/api/meta");
    const names = (response.body as { models: { name: string }[] }).models.map(
      (model) => model.name,
    );
    expect(names).toEqual(["blog.Author"]);
  });
});

describe("audit attribution", () => {
  it("records the acting user id", async () => {
    await as("su3@example.com", "/admin/api/blog/post", {
      method: "POST",
      body: JSON.stringify({ id: "p5", title: "Attributed", author: "a1" }),
    });
    const row = await env.DB_MAIN.prepare(
      "SELECT user_id AS userId FROM clango_admin_log WHERE object_id = ?",
    )
      .bind("p5")
      .first<{ userId: string | null }>();
    expect(row?.userId).toBe("auth:su3@example.com");
  });
});
