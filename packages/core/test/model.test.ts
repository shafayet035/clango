import { describe, expect, it, expectTypeOf } from "vitest";

import {
  ModelDefinitionError,
  defineModel,
  manyToManyFields,
  searchableFields,
  type AnyModel,
  type Field,
  type ModelInsert,
  type ModelRow,
  type ModelUpdate,
} from "../src/index";
import { fields } from "../src/index";

const Author = defineModel("blog.Author", {
  fields: {
    name: fields.string({ max: 120 }),
    email: fields.email({ unique: true }),
    avatar: fields.image({ optional: true }),
  },
  display: (author) => author.name,
});

const Tag = defineModel("blog.Tag", {
  fields: { name: fields.string({ max: 60 }) },
});

const Post = defineModel("blog.Post", {
  fields: {
    title: fields.string({ max: 200 }),
    slug: fields.slug({ from: "title", unique: true }),
    body: fields.text({ searchable: true, optional: true }),
    status: fields.choice(["draft", "published"], { default: "draft" }),
    author: fields.foreignKey(() => Author, { onDelete: "cascade" }),
    publishedAt: fields.datetime({ optional: true, index: true }),
    tags: fields.manyToMany(() => Tag),
  },
  meta: { ordering: ["-publishedAt", "title"] },
});

describe("defineModel", () => {
  it("derives the app label, model name and table name", () => {
    expect(Post.name).toBe("blog.Post");
    expect(Post.appLabel).toBe("blog");
    expect(Post.modelName).toBe("Post");
    expect(Post.tableName).toBe("blog_post");
  });

  it("keeps the declared field map", () => {
    expect(Object.keys(Post.fields)).toEqual([
      "title",
      "slug",
      "body",
      "status",
      "author",
      "publishedAt",
      "tags",
    ]);
  });

  it("keeps meta.ordering", () => {
    expect(Post.meta.ordering).toEqual(["-publishedAt", "title"]);
  });

  it("attaches a display function that receives a row", () => {
    const author = Author.display;
    expect(author).toBeTypeOf("function");
    expect(
      author?.({
        id: "01H",
        createdAt: new Date(0),
        updatedAt: new Date(0),
        name: "Ada",
        email: "ada@example.com",
        avatar: null,
      }),
    ).toBe("Ada");
  });

  it("reports searchable fields", () => {
    expect(searchableFields(Post)).toEqual(["body"]);
  });

  it("reports many-to-many fields", () => {
    expect(manyToManyFields(Post).map(([name]) => name)).toEqual(["tags"]);
  });

  it("is accepted as AnyModel", () => {
    const models: AnyModel[] = [Author, Tag, Post];
    expect(models.map((model) => model.name)).toEqual(["blog.Author", "blog.Tag", "blog.Post"]);
  });
});

describe("defineModel validation", () => {
  it("rejects a model with no fields", () => {
    expect(() => defineModel("blog.Empty", { fields: {} })).toThrow(ModelDefinitionError);
  });

  it("rejects reserved automatic field names", () => {
    for (const reserved of ["id", "createdAt", "updatedAt"]) {
      expect(() =>
        defineModel("blog.Reserved", { fields: { [reserved]: fields.string() } }),
      ).toThrow(ModelDefinitionError);
    }
  });

  it("rejects an ordering entry that is not a declared field", () => {
    expect(() =>
      defineModel("blog.InvalidOrdering", {
        fields: { title: fields.string() },
        // @ts-expect-error "nope" is not a declared field of blog.InvalidOrdering.
        meta: { ordering: ["nope"] },
      }),
    ).toThrow(ModelDefinitionError);
  });

  it("rejects a unique many-to-many field", () => {
    const badField = { kind: "manyToMany", options: { unique: true } } as unknown as Field;
    expect(() => defineModel("blog.BadRelation", { fields: { tags: badField } })).toThrow(
      ModelDefinitionError,
    );
  });

  it("rejects a non-function display", () => {
    expect(() =>
      defineModel("blog.BadDisplay", {
        fields: { title: fields.string() },
        display: "title" as unknown as () => string,
      }),
    ).toThrow(ModelDefinitionError);
  });

  it("rejects values that are not fields", () => {
    expect(() =>
      defineModel("blog.NotAField", { fields: { title: "title" } as unknown as never }),
    ).toThrow(ModelDefinitionError);
  });
});

describe("inferred types", () => {
  it("infers the row shape, excluding many-to-many fields", () => {
    expectTypeOf<ModelRow<typeof Post.fields>>().toEqualTypeOf<{
      id: string;
      createdAt: Date;
      updatedAt: Date;
      title: string;
      slug: string;
      body: string | null;
      status: "draft" | "published";
      author: string;
      publishedAt: Date | null;
    }>();
  });

  it("infers the insert shape, making optional and defaulted fields optional", () => {
    expectTypeOf<ModelInsert<typeof Post.fields>>().toEqualTypeOf<{
      id?: string;
      createdAt?: Date;
      updatedAt?: Date;
      title: string;
      slug: string;
      body?: string | null;
      status?: "draft" | "published";
      author: string;
      publishedAt?: Date | number | null;
    }>();
  });

  it("infers the update shape with every column optional", () => {
    expectTypeOf<ModelUpdate<typeof Post.fields>>().toEqualTypeOf<{
      title?: string;
      slug?: string;
      body?: string | null;
      status?: "draft" | "published";
      author?: string;
      publishedAt?: Date | number | null;
    }>();
  });

  it("types display with the model row", () => {
    expectTypeOf(Author.display).parameter(0).toHaveProperty("email");
  });
});
