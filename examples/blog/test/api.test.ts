import { env, exports } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

const ORIGIN = "https://example.com";

beforeAll(async () => {
  await applyD1Migrations(env.DB_MAIN, env.TEST_MIGRATIONS);
});

async function call(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const response = await exports.default.fetch(`${ORIGIN}${path}`, init);
  const text = await response.text();
  const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
  return {
    status: response.status,
    body: text.length === 0 ? null : isJson ? JSON.parse(text) : text,
    headers: response.headers,
  };
}

function json(method: string, payload: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}

describe("generated REST API", () => {
  it("creates and reads back a post", async () => {
    const author = await call(
      "/api/blog/author",
      json("POST", { id: "author-api", name: "Ada", email: "ada@example.com" }),
    );
    expect(author.status).toBe(201);

    const created = await call(
      "/api/blog/post",
      json("POST", {
        title: "Hello from the API",
        slug: "hello-from-the-api",
        body: "the quick brown fox",
        author: "author-api",
      }),
    );
    expect(created.status).toBe(201);
    const post = (created.body as { data: { id: string; status: string } }).data;
    expect(post.status).toBe("draft");

    const fetched = await call(`/api/blog/post/${post.id}`);
    expect(fetched.status).toBe(200);
    expect((fetched.body as { data: { title: string } }).data.title).toBe("Hello from the API");
  });

  it("lists and searches posts", async () => {
    const searched = await call("/api/blog/post?search=brown");
    expect(searched.status).toBe(200);
    const rows = (searched.body as { data: { slug: string }[] }).data;
    expect(rows.map((row) => row.slug)).toContain("hello-from-the-api");

    const filtered = await call("/api/blog/post?status=draft");
    expect((filtered.body as { page: { count: number } }).page.count).toBeGreaterThan(0);
  });

  it("updates and deletes a post", async () => {
    const created = await call(
      "/api/blog/post",
      json("POST", { title: "Temp", slug: "temp", author: "author-api" }),
    );
    const id = (created.body as { data: { id: string } }).data.id;

    const updated = await call(`/api/blog/post/${id}`, json("PATCH", { status: "published" }));
    expect(updated.status).toBe(200);
    expect((updated.body as { data: { status: string } }).data.status).toBe("published");

    expect((await call(`/api/blog/post/${id}`, { method: "DELETE" })).status).toBe(204);
    expect((await call(`/api/blog/post/${id}`)).status).toBe(404);
  });

  it("rejects invalid payloads with details", async () => {
    const response = await call("/api/blog/post", json("POST", { title: "No slug" }));
    expect(response.status).toBe(400);
    const error = (response.body as { error: { code: string; details: unknown[] } }).error;
    expect(error.code).toBe("validation_error");
    expect(error.details.length).toBeGreaterThan(0);
  });

  it("mounts only the operations a model enables", async () => {
    expect((await call("/api/blog/tag")).status).toBe(200);
    expect((await call("/api/blog/tag", json("POST", { name: "x" }))).status).toBe(404);
  });

  it("returns a JSON 404 for unknown endpoints under /api", async () => {
    const response = await call("/api/blog/does-not-exist");
    expect(response.status).toBe(404);
    expect((response.body as { error: { code: string } }).error.code).toBe("not_found");
  });
});
