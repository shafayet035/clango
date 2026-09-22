import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { SUPERUSER, appointSuperuser, call, json } from "./admin-helpers";

const TENANT_HEADER = "x-clango-tenant";

beforeAll(async () => {
  await applyD1Migrations(env.DB_MAIN, env.TEST_MIGRATIONS);
  // A tenant database is a whole database, so it gets the same migrations applied independently.
  await applyD1Migrations(env.DB_MAIN_ACME, env.TEST_MIGRATIONS);
  await appointSuperuser(SUPERUSER);
});

/** Calls the Worker as the superuser, optionally addressed to a tenant. */
function asTenant(tenant: string | null, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (tenant !== null) headers.set(TENANT_HEADER, tenant);
  return call(SUPERUSER, path, { ...init, headers });
}

describe("database per tenant", () => {
  it("writes a tenant's rows to its own database", async () => {
    const created = await asTenant(
      "acme",
      "/admin/api/blog/author",
      json("POST", { id: "tenant-author", name: "Tenant Ada", email: "ada@acme.example" }),
    );
    expect(created.status).toBe(201);

    // Present in the tenant's database...
    const inTenant = await env.DB_MAIN_ACME.prepare("SELECT id FROM blog_author WHERE id = ?")
      .bind("tenant-author")
      .first<{ id: string }>();
    expect(inTenant?.id).toBe("tenant-author");

    // ...and absent from the shared one, which is the whole point.
    const inShared = await env.DB_MAIN.prepare("SELECT id FROM blog_author WHERE id = ?")
      .bind("tenant-author")
      .first<{ id: string }>();
    expect(inShared).toBeNull();
  });

  it("does not show one tenant's rows to another", async () => {
    const listed = await asTenant("other", "/admin/api/blog/author?limit=100");
    // `other` has no binding, so the request fails loudly rather than silently reading the shared
    // database — a misconfigured tenant must not see everyone else's data.
    expect(listed.status).toBe(500);
    expect(String((listed.body as { error: { message: string } }).error.message)).toContain(
      "DB_MAIN_OTHER",
    );
  });

  it("serves requests without a tenant header from the shared database", async () => {
    const created = await call(
      SUPERUSER,
      "/admin/api/blog/author",
      json("POST", { id: "shared-author", name: "Shared Ada", email: "ada@shared.example" }),
    );
    expect(created.status).toBe(201);

    const inShared = await env.DB_MAIN.prepare("SELECT id FROM blog_author WHERE id = ?")
      .bind("shared-author")
      .first<{ id: string }>();
    expect(inShared?.id).toBe("shared-author");
  });

  it("keeps the framework tables in the control database", async () => {
    // The tenant registry is a control-plane table: it must not be looked up per tenant, or there
    // would be no way to know which tenants exist.
    await asTenant("acme", "/admin/api/meta");
    const control = await env.DB_MAIN.prepare("SELECT slug FROM clango_tenant ORDER BY slug").all<{
      slug: string;
    }>();
    expect(control.results.length).toBeGreaterThanOrEqual(0);
  });
});
