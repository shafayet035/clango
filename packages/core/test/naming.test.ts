import { describe, expect, it } from "vitest";

import {
  ModelDefinitionError,
  parseModelName,
  tableNameFor,
  toCamelCase,
  toSnakeCase,
} from "../src/index";

describe("toSnakeCase", () => {
  it("converts camelCase and PascalCase", () => {
    expect(toSnakeCase("publishedAt")).toBe("published_at");
    expect(toSnakeCase("BlogPost")).toBe("blog_post");
    expect(toSnakeCase("title")).toBe("title");
  });

  it("handles acronyms", () => {
    expect(toSnakeCase("URLPath")).toBe("url_path");
    expect(toSnakeCase("authorID")).toBe("author_id");
  });
});

describe("toCamelCase", () => {
  it("converts snake_case", () => {
    expect(toCamelCase("published_at")).toBe("publishedAt");
    expect(toCamelCase("title")).toBe("title");
  });
});

describe("parseModelName", () => {
  it("splits a qualified model name", () => {
    expect(parseModelName("blog.Post")).toEqual({ appLabel: "blog", modelName: "Post" });
  });

  it("rejects unqualified names", () => {
    expect(() => parseModelName("Post")).toThrow(ModelDefinitionError);
  });

  it("rejects names with more than one dot", () => {
    expect(() => parseModelName("a.b.c")).toThrow(ModelDefinitionError);
  });

  it("rejects invalid identifiers", () => {
    expect(() => parseModelName("1blog.Post")).toThrow(ModelDefinitionError);
    expect(() => parseModelName("blog.Post-Thing")).toThrow(ModelDefinitionError);
  });
});

describe("tableNameFor", () => {
  it("joins the app label and model name in snake_case", () => {
    expect(tableNameFor("blog", "Post")).toBe("blog_post");
    expect(tableNameFor("blog", "BlogPost")).toBe("blog_blog_post");
  });
});
