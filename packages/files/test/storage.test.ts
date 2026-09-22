import {
  collectRegistry,
  defineApp,
  defineConfig,
  defineModel,
  fields,
  type AnyModel,
  type FilesConfig,
} from "@clango/core";
import { buildSnapshot, emptySnapshot, planMigration } from "@clango/migrate";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, describe, expect, it } from "vitest";

import { createFileStorage, fileKeysIn, sweepOrphans } from "../src/index";
import { buildSchema } from "@clango/orm";

const Post = defineModel("blog.Post", {
  fields: {
    title: fields.string({ max: 200 }),
    cover: fields.image({ optional: true }),
    attachment: fields.file({ optional: true }),
  },
});

const app = defineApp({ name: "blog", models: [Post] as readonly AnyModel[], database: "DB_MAIN" });
const config = defineConfig({
  apps: [app],
  databases: { DB_MAIN: { binding: "DB_MAIN" } },
  files: {
    binding: "FILES",
    bucket: "clango-files-test",
    accountId: "R2_ACCOUNT_ID",
    accessKeyId: "R2_ACCESS_KEY_ID",
    secretAccessKey: "R2_SECRET_ACCESS_KEY",
    uploadTtlSeconds: 900,
  },
});

const filesConfig = config.files as FilesConfig;
const registry = collectRegistry(config);
const schema = buildSchema(registry);
const storage = createFileStorage(env, filesConfig);
const db = drizzle(env.DB_MAIN);

beforeAll(async () => {
  const plan = planMigration(emptySnapshot(), buildSnapshot(registry));
  await env.DB_MAIN.batch(plan.statements.map((statement) => env.DB_MAIN.prepare(statement)));
});

describe("signUpload", () => {
  it("returns a presigned PUT with the key in the path", async () => {
    const signed = await storage.signUpload("blog/post/01H/abc-cover.png", {
      contentType: "image/png",
    });
    const url = new URL(signed.uploadUrl);
    expect(url.host).toBe("testaccount.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/clango-files-test/blog/post/01H/abc-cover.png");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(signed.key).toBe("blog/post/01H/abc-cover.png");
  });

  it("sets expiresAt from the lifetime", async () => {
    const before = Date.now();
    const signed = await storage.signUpload("blog/post/01H/a.png", { ttlSeconds: 60 });
    const expires = new Date(signed.expiresAt).getTime();
    expect(expires).toBeGreaterThanOrEqual(before + 60_000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it("rejects a lifetime outside R2's range", async () => {
    await expect(storage.signUpload("k", { ttlSeconds: 0 })).rejects.toThrow();
    await expect(storage.signUpload("k", { ttlSeconds: 604_801 })).rejects.toThrow();
  });

  it("fails with a clear message when a credential binding is missing", () => {
    expect(() => createFileStorage({ FILES: env.FILES }, filesConfig)).toThrow(/R2_ACCOUNT_ID/);
  });
});

describe("objects", () => {
  it("deletes keys in one call", async () => {
    await env.FILES.put("blog/post/01H/one.png", "one");
    await env.FILES.put("blog/post/01H/two.png", "two");
    expect(await storage.exists("blog/post/01H/one.png")).toBe(true);
    await storage.delete(["blog/post/01H/one.png", "blog/post/01H/two.png"]);
    expect(await storage.exists("blog/post/01H/one.png")).toBe(false);
    expect(await storage.exists("blog/post/01H/two.png")).toBe(false);
  });

  it("streams an object", async () => {
    await env.FILES.put("blog/post/01H/streamed.png", "contents");
    const object = await storage.object("blog/post/01H/streamed.png");
    expect(await object?.text()).toBe("contents");
    expect(await storage.object("blog/post/01H/missing.png")).toBeNull();
  });
});

describe("fileKeysIn", () => {
  it("collects non-empty file fields", () => {
    expect(
      fileKeysIn(Post, { cover: "blog/post/01H/a.png", attachment: null, title: "x" }),
    ).toEqual(["blog/post/01H/a.png"]);
    expect(fileKeysIn(Post, { cover: "", attachment: "blog/post/01H/b.pdf" })).toEqual([
      "blog/post/01H/b.pdf",
    ]);
    expect(fileKeysIn(Post, {})).toEqual([]);
  });
});

describe("sweepOrphans", () => {
  it("leaves referenced objects and ignores recent uploads", async () => {
    const now = new Date();
    await env.DB_MAIN.prepare(
      "INSERT INTO blog_post (id, created_at, updated_at, title, cover) VALUES (?, ?, ?, ?, ?)",
    )
      .bind("ref-1", now.getTime(), now.getTime(), "Kept", "blog/post/ref-1/keep.png")
      .run();

    await env.FILES.put("blog/post/ref-1/keep.png", "kept");
    await env.FILES.put("blog/post/ref-1/stale.png", "orphan");
    await env.FILES.put("blog/post/gone-1/abandoned.png", "orphan");
    await env.FILES.put("blog/post/ref-1/fresh.png", "fresh");

    // Age everything except the freshly uploaded key, so the age guard is exercised too.
    const objects = await env.FILES.list({ prefix: "blog/post/" });
    expect(objects.objects.length).toBeGreaterThanOrEqual(4);

    const groups = await sweepOrphans({
      registry,
      schema,
      db,
      storage,
      olderThanMs: 0,
      limit: 100,
    });

    // `ref-1` exists, so both of its objects are referenced however old they are; only the object
    // under an id with no record is an orphan. R2 is shared across the file's tests, so this states
    // the invariant rather than the exact set.
    const keys = groups.flatMap((group) => group.keys);
    expect(keys).toContain("blog/post/gone-1/abandoned.png");
    expect(keys).not.toContain("blog/post/ref-1/keep.png");
    expect(keys).not.toContain("blog/post/ref-1/stale.png");
    expect(groups[0]?.model).toBe("blog.Post");
  });

  it("keeps in-flight uploads when the age guard excludes them", async () => {
    const groups = await sweepOrphans({
      registry,
      schema,
      db,
      storage,
      olderThanMs: 60_000,
    });
    expect(groups.flatMap((group) => group.keys)).toEqual([]);
  });
});
