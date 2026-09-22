import { describe, expect, it } from "vitest";

import { appFiles, projectFiles } from "../src/index";

function contents(files: readonly { path: string; contents: string }[], path: string): string {
  const file = files.find((entry) => entry.path === path);
  if (file === undefined) throw new Error(`missing ${path}`);
  return file.contents;
}

describe("projectFiles", () => {
  const files = projectFiles({ name: "my-shop" });

  it("produces a runnable project skeleton", () => {
    const paths = files.map((file) => file.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "package.json",
        "wrangler.jsonc",
        "clango.config.ts",
        "src/index.ts",
        "src/app.ts",
        "src/models.ts",
        "tsconfig.json",
        "vitest.config.ts",
        "README.md",
      ]),
    );
  });

  it("names the D1 binding and database after the project", () => {
    const worker = contents(files, "wrangler.jsonc");
    expect(worker).toContain('"database_name": "my-shop-db"');
    expect(worker).toContain('"migrations_dir": "migrations/DB_MAIN"');
    expect(worker).toContain('"binding": "DB_MAIN"');
  });

  it("wires the framework packages at the configured version", () => {
    const pkg = JSON.parse(contents(files, "package.json")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@clango/core"]).toBe("workspace:*");
    expect(pkg.devDependencies["@clango/cli"]).toBe("workspace:*");
  });

  it("pins a version range when one is given", () => {
    const versioned = projectFiles({ name: "shop", frameworkVersion: "^0.1.0" });
    expect(contents(versioned, "package.json")).toContain('"@clango/core": "^0.1.0"');
  });

  it("declares a model in the app's own namespace", () => {
    expect(contents(files, "src/models.ts")).toContain('defineModel("my-shop.Note"');
    expect(contents(files, "src/app.ts")).toContain('defineApp({ name: "my-shop"');
  });

  it("omits admin and API wiring when they are disabled", () => {
    const bare = projectFiles({ name: "shop", admin: false, api: false });
    expect(contents(bare, "src/index.ts")).not.toContain("mountApi");
    expect(contents(bare, "src/index.ts")).not.toContain("mountAdmin");
    expect(contents(bare, "clango.config.ts")).not.toContain("admin:");
    expect(contents(bare, "package.json")).not.toContain("@clango/admin-api");
  });

  it("marks shared files as skip-if-exists so reruns are safe", () => {
    const gitignore = files.find((file) => file.path === ".gitignore");
    expect(gitignore?.skipIfExists).toBe(true);
  });
});

describe("appFiles", () => {
  const files = appFiles("blog_extras");

  it("uses a PascalCase export for the starter model", () => {
    expect(contents(files, "src/apps/blog_extras/models.ts")).toContain(
      'export const BlogExtrasItem = defineModel("blog_extras.Item"',
    );
  });

  it("includes admin registration and a registration note", () => {
    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "src/apps/blog_extras/app.ts",
        "src/apps/blog_extras/models.ts",
        "src/apps/blog_extras/admin.ts",
        "src/apps/blog_extras/README.md",
      ]),
    );
    expect(contents(files, "src/apps/blog_extras/admin.ts")).toContain(
      "registerAdmin(BlogExtrasItem",
    );
  });
});
