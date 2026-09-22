import { defineApp, defineConfig, defineModel, fields, type AnyModel } from "@clango/core";
import { describe, expect, it } from "vitest";

import {
  activeTenants,
  buildTenantListSql,
  parseTenantRows,
  planTenantMigrations,
} from "../src/index";

const Post = defineModel("blog.Post", { fields: { title: fields.string() } });
const PageView = defineModel("stats.PageView", { fields: { path: fields.string() } });

const config = defineConfig({
  apps: [
    defineApp({ name: "blog", models: [Post] as readonly AnyModel[], database: "DB_MAIN" }),
    defineApp({ name: "stats", models: [PageView] as readonly AnyModel[], database: "DB_STATS" }),
  ],
  databases: { DB_MAIN: { binding: "DB_MAIN" }, DB_STATS: { binding: "DB_STATS" } },
  tenants: { enabled: true, database: "DB_MAIN" },
});

describe("buildTenantListSql", () => {
  it("selects the registry columns from the framework table", () => {
    const sql = buildTenantListSql();
    expect(sql).toContain('FROM "clango_tenant"');
    expect(sql).toContain("slug");
    expect(sql).toContain("suspended");
  });
});

describe("parseTenantRows", () => {
  it("reads wrangler's array-wrapped results", () => {
    const output = JSON.stringify([
      {
        results: [
          { slug: "acme", suspended: 0 },
          { slug: "beta", suspended: 0 },
        ],
        success: true,
      },
    ]);
    expect(parseTenantRows(output)).toEqual([
      { slug: "acme", suspended: false },
      { slug: "beta", suspended: false },
    ]);
  });

  it("accepts an unwrapped result object", () => {
    expect(parseTenantRows(JSON.stringify({ results: [{ slug: "acme", suspended: 1 }] }))).toEqual([
      { slug: "acme", suspended: true },
    ]);
  });

  it("returns nothing for output it cannot read rather than throwing", () => {
    expect(parseTenantRows("not json")).toEqual([]);
    expect(parseTenantRows(JSON.stringify({ error: "boom" }))).toEqual([]);
    expect(parseTenantRows(JSON.stringify([{ results: [{ nope: 1 }] }]))).toEqual([]);
  });
});

describe("activeTenants", () => {
  it("drops suspended tenants and sorts the rest", () => {
    expect(
      activeTenants([
        { slug: "beta", suspended: false },
        { slug: "gone", suspended: true },
        { slug: "acme", suspended: false },
      ]).map((tenant) => tenant.slug),
    ).toEqual(["acme", "beta"]);
  });
});

describe("planTenantMigrations", () => {
  it("expands tenants across every database, in a stable order", () => {
    const steps = planTenantMigrations(config, [
      { slug: "beta", suspended: false },
      { slug: "acme", suspended: false },
    ]);
    expect(steps).toEqual([
      { tenant: "acme", database: "DB_MAIN", binding: "DB_MAIN_ACME" },
      { tenant: "acme", database: "DB_STATS", binding: "DB_STATS_ACME" },
      { tenant: "beta", database: "DB_MAIN", binding: "DB_MAIN_BETA" },
      { tenant: "beta", database: "DB_STATS", binding: "DB_STATS_BETA" },
    ]);
  });

  it("honours a database filter", () => {
    const steps = planTenantMigrations(config, [{ slug: "acme", suspended: false }], {
      databases: ["DB_STATS"],
    });
    expect(steps).toEqual([{ tenant: "acme", database: "DB_STATS", binding: "DB_STATS_ACME" }]);
  });

  it("skips suspended tenants", () => {
    expect(planTenantMigrations(config, [{ slug: "gone", suspended: true }])).toEqual([]);
  });
});
