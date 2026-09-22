import { defineApp, defineConfig, defineModel, fields, type AnyModel } from "@clango/core";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createRouter, tenantFromRequest, type DriverFactory } from "../src/index";

const Post = defineModel("blog.Post", { fields: { title: fields.string() } });
const PageView = defineModel("stats.PageView", { fields: { path: fields.string() } });

const blog = defineApp({
  name: "blog",
  models: [Post] as readonly AnyModel[],
  database: "DB_MAIN",
});
const stats = defineApp({
  name: "stats",
  models: [PageView] as readonly AnyModel[],
  database: "DB_STATS",
});

const config = defineConfig({
  apps: [blog, stats],
  databases: { DB_MAIN: { binding: "DB_MAIN" }, DB_STATS: { binding: "DB_STATS" } },
});

const tenantConfig = defineConfig({
  apps: [blog, stats],
  databases: { DB_MAIN: { binding: "DB_MAIN" }, DB_STATS: { binding: "DB_STATS" } },
  tenants: { enabled: true, database: "DB_MAIN" },
});

describe("createRouter", () => {
  it("resolves each model's own database", () => {
    const router = createRouter(config, env);
    expect(router.database("DB_MAIN").binding).toBe("DB_MAIN");
    expect(router.database("DB_STATS").binding).toBe("DB_STATS");
    expect(router.database("DB_MAIN").dialect).toBe("d1");
  });

  it("rejects a database no model uses", () => {
    expect(() => createRouter(config, env).database("DB_NOPE")).toThrow();
  });

  it("fails with the binding name when it is missing from the environment", () => {
    expect(() => createRouter(config, {}).database("DB_MAIN")).toThrow(/DB_MAIN/);
  });

  it("exposes the registry so callers do not rebuild it", () => {
    expect(createRouter(config, env).registry.models.map((entry) => entry.model.name)).toEqual([
      "blog.Post",
      "stats.PageView",
    ]);
  });
});

describe("sessions", () => {
  it("opens a fresh session per call, backed by the binding", () => {
    const driver = createRouter(config, env).database("DB_MAIN");
    const first = driver.session();
    const second = driver.session();
    expect(first).not.toBe(second);
    expect(typeof first.prepare).toBe("function");
    expect(driver.session().getBookmark()).toBeNull();
  });
});

describe("tenancy", () => {
  it("swaps every binding for the tenant's own", () => {
    const router = createRouter(tenantConfig, env, { tenant: "acme" });
    expect(router.database("DB_MAIN").binding).toBe("DB_MAIN_ACME");
  });

  it("fails at construction, naming the tenant binding that is missing", () => {
    // Every model's database is resolved when the router is built, so a deployment missing a tenant
    // binding fails on the first request rather than only when that model is touched.
    expect(() => createRouter(tenantConfig, env, { tenant: "unbound" })).toThrow(/DB_MAIN_UNBOUND/);
  });

  it("reads the tenant from the configured header", () => {
    expect(tenantFromRequest(tenantConfig, new Request("https://example.com/"))).toBeNull();
    expect(
      tenantFromRequest(
        tenantConfig,
        new Request("https://example.com/", { headers: { "x-clango-tenant": "  ACME " } }),
      ),
    ).toBe("acme");
  });
});

describe("driver factory", () => {
  it("lets a caller replace how drivers are built", () => {
    const seen: string[] = [];
    const factory: DriverFactory = ({ name, binding }) => {
      seen.push(`${name}:${binding}`);
      return {
        name,
        binding,
        dialect: "d1",
        db: env.DB_MAIN,
        session: () => env.DB_MAIN.withSession(),
      };
    };

    const router = createRouter(config, env, { driverFactory: factory });
    router.database("DB_STATS");
    expect(seen).toEqual(["DB_MAIN:DB_MAIN", "DB_STATS:DB_STATS"]);
  });
});
