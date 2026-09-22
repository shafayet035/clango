import { defineModel, fields } from "@clango/core";
import { describe, expect, it } from "vitest";

import {
  buildFileKey,
  fileFieldsOf,
  filePrefixFor,
  keyBelongsTo,
  parseFileKey,
  sanitizeFilename,
} from "../src/index";

const Post = defineModel("blog.Post", {
  fields: {
    title: fields.string({ max: 200 }),
    cover: fields.image({ optional: true }),
    attachment: fields.file({ optional: true }),
  },
});

describe("sanitizeFilename", () => {
  it("keeps ordinary names", () => {
    expect(sanitizeFilename("cover.png")).toBe("cover.png");
  });

  it("strips directory components", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\me\\photo.jpg")).toBe("photo.jpg");
  });

  it("replaces unsafe characters", () => {
    expect(sanitizeFilename("my photo (1).png")).toBe("my-photo-1-.png");
  });

  it("falls back when nothing usable remains", () => {
    expect(sanitizeFilename("...")).toBe("file");
    expect(sanitizeFilename("")).toBe("file");
  });

  it("caps the length", () => {
    expect(sanitizeFilename(`${"x".repeat(400)}.png`).length).toBeLessThanOrEqual(120);
  });
});

describe("buildFileKey", () => {
  it("namespaces by app, model and record", () => {
    const key = buildFileKey({
      model: Post,
      recordId: "01H",
      filename: "cover.png",
      uuid: "abc",
    });
    expect(key).toBe("blog/post/01H/abc-cover.png");
  });

  it("uses the snake_case model name, not the table name", () => {
    expect(filePrefixFor(Post, "01H")).toBe("blog/post/01H/");
  });

  it("generates a distinct uuid by default", () => {
    const first = buildFileKey({ model: Post, recordId: "01H", filename: "a.png" });
    const second = buildFileKey({ model: Post, recordId: "01H", filename: "a.png" });
    expect(first).not.toBe(second);
  });
});

describe("parseFileKey", () => {
  it("round-trips a built key", () => {
    const key = buildFileKey({ model: Post, recordId: "01H", filename: "cover.png", uuid: "abc" });
    expect(parseFileKey(key)).toEqual({
      appLabel: "blog",
      model: "post",
      recordId: "01H",
      filename: "abc-cover.png",
    });
  });

  it("rejects keys that do not match the shape", () => {
    expect(parseFileKey("blog/post/01H")).toBeNull();
    expect(parseFileKey("blog/post/01H/a/b.png")).toBeNull();
    expect(parseFileKey("blog//01H/a.png")).toBeNull();
    expect(parseFileKey("")).toBeNull();
  });

  it("rejects traversal segments", () => {
    expect(parseFileKey("blog/post/../a.png")).toBeNull();
    expect(parseFileKey("../post/01H/a.png")).toBeNull();
  });
});

describe("keyBelongsTo", () => {
  it("recognises the owning record", () => {
    const key = buildFileKey({ model: Post, recordId: "01H", filename: "a.png", uuid: "x" });
    expect(keyBelongsTo(key, Post, "01H")).toBe(true);
    expect(keyBelongsTo(key, Post, "02H")).toBe(false);
  });
});

describe("fileFieldsOf", () => {
  it("reports file and image fields only", () => {
    expect([...fileFieldsOf(Post)].sort()).toEqual(["attachment", "cover"]);
  });
});
