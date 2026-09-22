import type { AdminMeta, AdminModelMeta } from "@clango/core";
import { describe, expect, it } from "vitest";

import { editableFields, findModel, keyOfModel, modelKeyOf } from "@/features/models/_lib/model";

function model(overrides: Partial<AdminModelMeta> & Pick<AdminModelMeta, "name">): AdminModelMeta {
  return {
    appLabel: "blog",
    modelName: "Post",
    verboseName: "post",
    verboseNamePlural: "posts",
    path: "/admin/blog/post",
    fields: [],
    listDisplay: [],
    listFilter: [],
    searchFields: [],
    ordering: [],
    fieldsets: [],
    readonlyFields: [],
    actions: [],
    ...overrides,
  } as AdminModelMeta;
}

describe("modelKeyOf", () => {
  it("converts a qualified name into the admin API key", () => {
    expect(modelKeyOf("blog.Post")).toBe("blog/post");
    expect(modelKeyOf("blog.BlogPost")).toBe("blog/blog_post");
  });
});

describe("keyOfModel", () => {
  it("derives the key from the model's route", () => {
    expect(keyOfModel(model({ name: "blog.Post" }))).toBe("blog/post");
  });
});

describe("findModel", () => {
  const meta: AdminMeta = {
    models: [
      model({ name: "blog.Post" }),
      model({ name: "blog.Author", path: "/admin/blog/author" }),
    ],
    user: null,
  };

  it("finds a model by route segments", () => {
    expect(findModel(meta, "blog", "post")?.name).toBe("blog.Post");
  });

  it("returns undefined for unknown segments", () => {
    expect(findModel(meta, "blog", "tag")).toBeUndefined();
    expect(findModel(undefined, "blog", "post")).toBeUndefined();
    expect(findModel(meta, undefined, undefined)).toBeUndefined();
  });
});

describe("editableFields", () => {
  it("orders fields by their fieldset, then appends anything unlisted", () => {
    const post = model({
      name: "blog.Post",
      fields: [
        {
          name: "title",
          label: "Title",
          kind: "string",
          widget: "text",
          required: true,
          nullable: false,
          editable: true,
        },
        {
          name: "extra",
          label: "Extra",
          kind: "string",
          widget: "text",
          required: false,
          nullable: true,
          editable: true,
        },
        {
          name: "body",
          label: "Body",
          kind: "text",
          widget: "textarea",
          required: false,
          nullable: true,
          editable: true,
        },
        {
          name: "id",
          label: "Id",
          kind: "string",
          widget: "text",
          required: true,
          nullable: false,
          editable: false,
        },
      ],
      fieldsets: [{ title: "Content", fields: ["title", "body"] }],
    });
    expect(editableFields(post).map((field) => field.name)).toEqual(["title", "body", "extra"]);
  });
});
