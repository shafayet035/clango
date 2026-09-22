import { describe, expect, it } from "vitest";

import {
  ModelDefinitionError,
  collectDatabases,
  collectModels,
  collectRegistry,
  defineApp,
  defineConfig,
  defineModel,
  fields,
  findModel,
  type ClangoConfig,
} from "../src/index";

const Author = defineModel("blog.Author", { fields: { name: fields.string() } });
const Post = defineModel("blog.Post", { fields: { title: fields.string() } });
const Audit = defineModel("blog.Audit", {
  fields: { action: fields.string() },
  database: "DB_AUDIT",
});
const User = defineModel("accounts.User", { fields: { email: fields.email() } });

const blog = defineApp({ name: "blog", models: [Author, Post] });
const accounts = defineApp({ name: "accounts", models: [User], database: "DB_ACCOUNTS" });

describe("defineApp", () => {
  it("collects models", () => {
    expect(blog.name).toBe("blog");
    expect(blog.models).toHaveLength(2);
  });

  it("rejects an invalid app name", () => {
    expect(() => defineApp({ name: "1blog", models: [Author] })).toThrow(ModelDefinitionError);
  });

  it("rejects an app with no models", () => {
    expect(() => defineApp({ name: "blog", models: [] as never })).toThrow(ModelDefinitionError);
  });

  it("rejects a value that is not a model", () => {
    expect(() => defineApp({ name: "blog", models: [{} as never] })).toThrow(ModelDefinitionError);
  });

  it("rejects a model whose app label does not match", () => {
    expect(() => defineApp({ name: "blog", models: [User] })).toThrow(ModelDefinitionError);
  });
});

describe("defineConfig", () => {
  it("accepts a valid configuration", () => {
    const config = defineConfig({
      apps: [blog, accounts],
      databases: { DB_MAIN: { binding: "DB_MAIN" } },
    });
    expect(config.apps).toHaveLength(2);
  });

  it("rejects a non-app entry", () => {
    expect(() => defineConfig({ apps: [{} as never] })).toThrow(ModelDefinitionError);
  });

  it("rejects duplicate app names", () => {
    expect(() => defineConfig({ apps: [blog, blog] })).toThrow(ModelDefinitionError);
  });

  it("rejects a database without a binding", () => {
    expect(() =>
      defineConfig({ apps: [blog], databases: { DB_MAIN: {} as unknown as { binding: string } } }),
    ).toThrow(ModelDefinitionError);
  });
});

describe("collectRegistry", () => {
  it("routes a model to the single declared database", () => {
    const config = defineConfig({ apps: [blog], databases: { DB_MAIN: { binding: "DB_MAIN" } } });
    const registry = collectRegistry(config);
    expect(registry.models.map((entry) => entry.database)).toEqual(["DB_MAIN", "DB_MAIN"]);
  });

  it("prefers an app's database over the single-database default", () => {
    const config = defineConfig({
      apps: [accounts],
      databases: { DB_MAIN: { binding: "DB_MAIN" }, DB_ACCOUNTS: { binding: "DB_ACCOUNTS" } },
    });
    const registry = collectRegistry(config);
    expect(registry.models.map((entry) => entry.database)).toEqual(["DB_ACCOUNTS"]);
  });

  it("prefers a model's database over its app's", () => {
    const audits = defineApp({ name: "blog", models: [Audit], database: "DB_MAIN" });
    const config = defineConfig({
      apps: [audits],
      databases: { DB_MAIN: { binding: "DB_MAIN" }, DB_AUDIT: { binding: "DB_AUDIT" } },
    });
    const registry = collectRegistry(config);
    expect(registry.models.map((entry) => entry.database)).toEqual(["DB_AUDIT"]);
  });

  it("rejects a model routed to an undeclared database", () => {
    const audits = defineApp({ name: "blog", models: [Audit] });
    const config = defineConfig({ apps: [audits], databases: { DB_MAIN: { binding: "DB_MAIN" } } });
    expect(() => collectRegistry(config)).toThrow(ModelDefinitionError);
  });

  it("rejects duplicate model names across apps", () => {
    const blogMain = defineApp({ name: "blog", models: [Author], database: "DB_MAIN" });
    const duplicateApp = defineApp({ name: "blog", models: [Author], database: "DB_MAIN" });
    const config: ClangoConfig = { apps: [blogMain, duplicateApp] };
    expect(() => collectRegistry(config)).toThrow(ModelDefinitionError);
  });

  it("indexes models by qualified name", () => {
    const blogMain = defineApp({ name: "blog", models: [Author, Post], database: "DB_MAIN" });
    const config = defineConfig({
      apps: [blogMain, accounts],
      databases: { DB_MAIN: { binding: "DB_MAIN" }, DB_ACCOUNTS: { binding: "DB_ACCOUNTS" } },
    });
    const registry = collectRegistry(config);
    expect([...registry.byName.keys()]).toEqual(["blog.Author", "blog.Post", "accounts.User"]);
  });

  it("requires a database when several are declared and none is set", () => {
    const orphan = defineApp({ name: "blog", models: [Post] });
    const config = defineConfig({
      apps: [orphan],
      databases: { DB_MAIN: { binding: "DB_MAIN" }, DB_OTHER: { binding: "DB_OTHER" } },
    });
    expect(() => collectRegistry(config)).toThrow(ModelDefinitionError);
  });
});

describe("registry helpers", () => {
  const blogMain = defineApp({ name: "blog", models: [Author, Post], database: "DB_MAIN" });
  const config = defineConfig({
    apps: [blogMain, accounts],
    databases: { DB_MAIN: { binding: "DB_MAIN" }, DB_ACCOUNTS: { binding: "DB_ACCOUNTS" } },
  });

  it("collectModels returns every model", () => {
    expect(collectModels(config).map((model) => model.name)).toEqual([
      "blog.Author",
      "blog.Post",
      "accounts.User",
    ]);
  });

  it("findModel looks up a model by qualified name", () => {
    expect(findModel(config, "blog.Post")?.model).toBe(Post);
    expect(findModel(config, "blog.Missing")).toBeUndefined();
  });

  it("collectDatabases returns the distinct databases in use", () => {
    expect(collectDatabases(config)).toEqual(["DB_ACCOUNTS", "DB_MAIN"]);
  });
});
