import { describe, expect, it } from "vitest";

import {
  ModelDefinitionError,
  collectRegistry,
  defineApp,
  defineConfig,
  defineModel,
  fields,
  tenantBindingFor,
} from "../src/index";

const Author = defineModel("blog.Author", { fields: { name: fields.string() } });

const Post = defineModel("blog.Post", {
  fields: {
    title: fields.string(),
    author: fields.foreignKey(() => Author, { onDelete: "cascade" }),
  },
});

const Analytics = defineModel("stats.PageView", { fields: { path: fields.string() } });

/** Points at a model in another database on purpose, to prove the registry rejects it. */
const CrossDb = defineModel("stats.CrossDb", {
  fields: { author: fields.foreignKey(() => Author, { onDelete: "cascade" }) },
});

const Tag = defineModel("stats.Tag", { fields: { name: fields.string() } });

const TaggedPost = defineModel("stats.TaggedPost", {
  fields: { title: fields.string(), tags: fields.manyToMany(() => Tag) },
});

describe("cross-database relations", () => {
  it("accepts relations inside one database", () => {
    const app = defineApp({ name: "blog", models: [Author, Post], database: "DB_MAIN" });
    const config = defineConfig({
      apps: [app],
      databases: { DB_MAIN: { binding: "DB_MAIN" }, DB_STATS: { binding: "DB_STATS" } },
    });
    expect(() => collectRegistry(config)).not.toThrow();
  });

  it("accepts a many-to-many whose join table and target share a database", () => {
    const app = defineApp({ name: "stats", models: [Tag, TaggedPost], database: "DB_STATS" });
    const config = defineConfig({
      apps: [app],
      databases: { DB_MAIN: { binding: "DB_MAIN" }, DB_STATS: { binding: "DB_STATS" } },
    });
    expect(() => collectRegistry(config)).not.toThrow();
  });

  it("rejects a foreign key that crosses databases and names both", () => {
    const blog = defineApp({ name: "blog", models: [Author], database: "DB_MAIN" });
    const stats = defineApp({ name: "stats", models: [Analytics, CrossDb], database: "DB_STATS" });
    const config = defineConfig({
      apps: [blog, stats],
      databases: { DB_MAIN: { binding: "DB_MAIN" }, DB_STATS: { binding: "DB_STATS" } },
    });

    expect(() => collectRegistry(config)).toThrow(ModelDefinitionError);
    try {
      collectRegistry(config);
    } catch (error) {
      expect((error as Error).message).toContain("stats.CrossDb");
      expect((error as Error).message).toContain("DB_STATS");
      expect((error as Error).message).toContain("DB_MAIN");
    }
  });
});

describe("tenantBindingFor", () => {
  const config = defineConfig({
    apps: [defineApp({ name: "blog", models: [Author], database: "DB_MAIN" })],
    databases: { DB_MAIN: { binding: "DB_MAIN" } },
    tenants: { enabled: true, database: "DB_MAIN" },
  });

  it("derives <DATABASE>_<SLUG> by default", () => {
    expect(tenantBindingFor(config, "DB_MAIN", "acme")).toBe("DB_MAIN_ACME");
    expect(tenantBindingFor(config, "DB_MAIN", "big-corp")).toBe("DB_MAIN_BIG_CORP");
  });

  it("uses a template when one is configured", () => {
    const templated = defineConfig({
      apps: [defineApp({ name: "blog", models: [Author], database: "DB_MAIN" })],
      databases: { DB_MAIN: { binding: "DB_MAIN" } },
      tenants: { enabled: true, bindingTemplate: "T_{tenant}_{database}" },
    });
    expect(tenantBindingFor(templated, "DB_MAIN", "acme")).toBe("T_ACME_DB_MAIN");
  });
});

describe("tenants config", () => {
  const app = defineApp({ name: "blog", models: [Author], database: "DB_MAIN" });

  it("rejects a template missing a placeholder", () => {
    expect(() =>
      defineConfig({
        apps: [app],
        databases: { DB_MAIN: { binding: "DB_MAIN" } },
        tenants: { enabled: true, bindingTemplate: "{tenant}" },
      }),
    ).toThrow(ModelDefinitionError);
  });

  it("registers the tenant registry table when enabled", () => {
    const config = defineConfig({
      apps: [app],
      databases: { DB_MAIN: { binding: "DB_MAIN" } },
      tenants: { enabled: true },
    });
    expect(collectRegistry(config).byName.has("clango.Tenant")).toBe(true);

    const disabled = defineConfig({ apps: [app], databases: { DB_MAIN: { binding: "DB_MAIN" } } });
    expect(collectRegistry(disabled).byName.has("clango.Tenant")).toBe(false);
  });
});
