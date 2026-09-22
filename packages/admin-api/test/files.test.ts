import {
  collectRegistry,
  defineApp,
  defineConfig,
  defineModel,
  fields,
  type AnyModel,
  type AuthAdapter,
} from "@clango/core";
import { Authorization } from "@clango/auth";
import { buildSnapshot, emptySnapshot, planMigration } from "@clango/migrate";
import { buildSchema } from "@clango/orm";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import type { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";

import { createAdminApp, type ClangoAuthVariables } from "../src/index";

const Post = defineModel("blog.Post", {
  fields: {
    title: fields.string({ max: 200 }),
    cover: fields.image({ optional: true }),
    attachment: fields.file({ optional: true }),
  },
  meta: { labelField: "title" },
});

const adapter: AuthAdapter = {
  getUser: async (request) => {
    const email = request.headers.get("x-test-user");
    return email === null ? null : { id: `auth:${email}`, email };
  },
};

const app = defineApp({ name: "blog", models: [Post] as readonly AnyModel[], database: "DB_MAIN" });
const config = defineConfig({
  apps: [app],
  databases: { DB_MAIN: { binding: "DB_MAIN" } },
  admin: { enabled: true },
  auth: { enabled: true, adapter },
  files: {
    binding: "FILES",
    bucket: "clango-admin-files",
    accountId: "R2_ACCOUNT_ID",
    accessKeyId: "R2_ACCESS_KEY_ID",
    secretAccessKey: "R2_SECRET_ACCESS_KEY",
  },
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
): Promise<{ status: number; body: unknown; contentType: string }> {
  const headers = new Headers(init?.headers);
  if (email !== null) headers.set("x-test-user", email);
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  const response = await admin.request(path, { ...init, headers }, env);
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  return {
    status: response.status,
    body:
      text.length === 0 ? null : contentType.includes("application/json") ? JSON.parse(text) : text,
    contentType,
  };
}

/** Issues a request and returns the raw response, for assertions about headers and bodies. */
async function raw(email: string | null, path: string): Promise<Response> {
  const headers = new Headers();
  if (email !== null) headers.set("x-test-user", email);
  return admin.request(path, { headers }, env);
}

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

  await authorization.setFlags(db, "owner@example.com", { isStaff: true, isSuperuser: true });
  await authorization.setFlags(db, "reader@example.com", { isStaff: true, isSuperuser: false });
  const reader = await userIdFor("reader@example.com");
  await authorization.grantToUser(db, reader, "blog.view_post");
});

describe("upload URLs", () => {
  it("issues a presigned PUT under the record's prefix", async () => {
    const response = await as("owner@example.com", "/admin/api/blog/post/uploads", {
      method: "POST",
      body: JSON.stringify({ filename: "cover.png", contentType: "image/png", recordId: "rec-1" }),
    });
    expect(response.status).toBe(201);
    const data = (response.body as { data: { key: string; uploadUrl: string; expiresAt: string } })
      .data;
    expect(data.key).toBe("blog/post/rec-1/" + data.key.slice("blog/post/rec-1/".length));
    expect(data.key).toMatch(/^blog\/post\/rec-1\/[0-9a-f-]+-cover\.png$/);
    expect(new URL(data.uploadUrl).searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect(Number.isNaN(new Date(data.expiresAt).getTime())).toBe(false);
  });

  it("generates a record id when the client has none yet", async () => {
    const response = await as("owner@example.com", "/admin/api/blog/post/uploads", {
      method: "POST",
      body: JSON.stringify({ filename: "new.png" }),
    });
    expect(response.status).toBe(201);
    expect((response.body as { data: { key: string } }).data.key).toMatch(
      /^blog\/post\/[0-9A-Z]{26}\//,
    );
  });

  it("requires a filename", async () => {
    const response = await as("owner@example.com", "/admin/api/blog/post/uploads", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });

  it("refuses a caller without write permission", async () => {
    const response = await as("reader@example.com", "/admin/api/blog/post/uploads", {
      method: "POST",
      body: JSON.stringify({ filename: "nope.png" }),
    });
    expect(response.status).toBe(403);
  });
});

describe("downloads", () => {
  it("streams a file for a caller with view permission", async () => {
    await env.FILES.put("blog/post/rec-2/report.pdf", "pdf-bytes");
    const response = await raw("reader@example.com", "/files/blog/post/rec-2/report.pdf");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("pdf-bytes");
    expect(response.headers.get("cache-control")).toContain("private");
  });

  it("refuses a caller without permission on the owning model", async () => {
    await env.FILES.put("clango/user/rec-3/secret.txt", "secret");
    const response = await as("reader@example.com", "/files/clango/user/rec-3/secret.txt");
    expect(response.status).toBe(403);
  });

  it("rejects anonymous callers", async () => {
    expect((await as(null, "/files/blog/post/rec-2/report.pdf")).status).toBe(401);
  });

  it("reports a missing object as 404", async () => {
    expect((await as("owner@example.com", "/files/blog/post/rec-2/missing.pdf")).status).toBe(404);
  });

  it("rejects a key that does not match the expected shape", async () => {
    expect((await as("owner@example.com", "/files/blog/post/rec-2/../escape.png")).status).toBe(
      404,
    );
    expect((await as("owner@example.com", "/files/nonsense")).status).toBe(404);
  });
});

describe("cleanup on delete", () => {
  it("removes the objects a deleted record referenced", async () => {
    const created = await as("owner@example.com", "/admin/api/blog/post", {
      method: "POST",
      body: JSON.stringify({
        id: "rec-del",
        title: "Doomed",
        cover: "blog/post/rec-del/cover.png",
        attachment: "blog/post/rec-del/report.pdf",
      }),
    });
    expect(created.status).toBe(201);

    await env.FILES.put("blog/post/rec-del/cover.png", "cover");
    await env.FILES.put("blog/post/rec-del/report.pdf", "report");
    expect(await env.FILES.head("blog/post/rec-del/cover.png")).not.toBeNull();

    expect(
      (await as("owner@example.com", "/admin/api/blog/post/rec-del", { method: "DELETE" })).status,
    ).toBe(204);

    // Without a Queues producer the cleanup runs inline rather than leaking the objects.
    expect(await env.FILES.head("blog/post/rec-del/cover.png")).toBeNull();
    expect(await env.FILES.head("blog/post/rec-del/report.pdf")).toBeNull();
  });

  it("keeps files the record still references after an update", async () => {
    await as("owner@example.com", "/admin/api/blog/post", {
      method: "POST",
      body: JSON.stringify({
        id: "rec-keep",
        title: "Kept",
        cover: "blog/post/rec-keep/cover.png",
      }),
    });
    await env.FILES.put("blog/post/rec-keep/cover.png", "cover");

    const updated = await as("owner@example.com", "/admin/api/blog/post/rec-keep", {
      method: "PATCH",
      body: JSON.stringify({ title: "Renamed" }),
    });
    expect(updated.status).toBe(200);
    expect(await env.FILES.head("blog/post/rec-keep/cover.png")).not.toBeNull();
  });

  it("removes a file the record replaced", async () => {
    await as("owner@example.com", "/admin/api/blog/post", {
      method: "POST",
      body: JSON.stringify({ id: "rec-swap", title: "Swap", cover: "blog/post/rec-swap/old.png" }),
    });
    await env.FILES.put("blog/post/rec-swap/old.png", "old");

    await as("owner@example.com", "/admin/api/blog/post/rec-swap", {
      method: "PATCH",
      body: JSON.stringify({ cover: "blog/post/rec-swap/new.png" }),
    });
    expect(await env.FILES.head("blog/post/rec-swap/old.png")).toBeNull();
  });
});
