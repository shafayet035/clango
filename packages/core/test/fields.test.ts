import { describe, expect, it } from "vitest";

import { ModelDefinitionError, fields, type Field } from "../src/index";

describe("field builders", () => {
  it("records the kind and options for scalar fields", () => {
    const title = fields.string({ max: 200, unique: true });
    expect(title.kind).toBe("string");
    expect(title.options).toEqual({ max: 200, unique: true });
  });

  it("supports every documented field kind", () => {
    const kinds = [
      fields.string().kind,
      fields.email().kind,
      fields.slug().kind,
      fields.url().kind,
      fields.text().kind,
      fields.integer().kind,
      fields.decimal().kind,
      fields.boolean().kind,
      fields.datetime().kind,
      fields.date().kind,
      fields.choice(["a"]).kind,
      fields.json().kind,
      fields.foreignKey(() => ({}) as never).kind,
      fields.manyToMany(() => ({}) as never).kind,
      fields.file().kind,
      fields.image().kind,
    ];
    expect(kinds).toEqual([
      "string",
      "email",
      "slug",
      "url",
      "text",
      "integer",
      "decimal",
      "boolean",
      "datetime",
      "date",
      "choice",
      "json",
      "foreignKey",
      "manyToMany",
      "file",
      "image",
    ]);
  });

  it("exposes choice values", () => {
    const status = fields.choice(["draft", "published"], { default: "draft" });
    expect(status.values).toEqual(["draft", "published"]);
  });

  it("exposes a lazy reference for relations", () => {
    const target = { kind: "model" as const };
    const relation = fields.foreignKey(() => target as never);
    expect(relation.ref?.()).toBe(target);
  });
});

describe("field validation", () => {
  it("rejects non-string defaults on text fields", () => {
    expect(() => fields.string({ default: 1 as unknown as string })).toThrow(ModelDefinitionError);
  });

  it("rejects min greater than max", () => {
    expect(() => fields.string({ min: 10, max: 5 })).toThrow(ModelDefinitionError);
  });

  it("rejects a zero or negative max", () => {
    expect(() => fields.string({ max: 0 })).toThrow(ModelDefinitionError);
  });

  it("rejects a non-integer integer default", () => {
    expect(() => fields.integer({ default: 1.5 })).toThrow(ModelDefinitionError);
  });

  it("rejects a negative decimal scale", () => {
    expect(() => fields.decimal({ scale: -1 })).toThrow(ModelDefinitionError);
  });

  it("rejects an out-of-range decimal scale", () => {
    expect(() => fields.decimal({ scale: 10 })).toThrow(ModelDefinitionError);
  });

  it("rejects an unknown datetime default", () => {
    expect(() => fields.datetime({ default: "tomorrow" as unknown as "now" })).toThrow(
      ModelDefinitionError,
    );
  });

  it("rejects a malformed date default", () => {
    expect(() => fields.date({ default: "01-02-2026" })).toThrow(ModelDefinitionError);
  });

  it("accepts a valid date default", () => {
    expect(fields.date({ default: "2026-09-22" }).kind).toBe("date");
  });

  it("rejects an empty choice list", () => {
    expect(() => fields.choice([] as unknown as [string])).toThrow(ModelDefinitionError);
  });

  it("rejects duplicate choice values", () => {
    expect(() => fields.choice(["a", "a"])).toThrow(ModelDefinitionError);
  });

  it("rejects a default that is not an allowed choice", () => {
    expect(() =>
      fields.choice(["draft", "published"], { default: "archived" as unknown as "draft" }),
    ).toThrow(ModelDefinitionError);
  });

  it("rejects an invalid referential action", () => {
    expect(() =>
      fields.foreignKey(() => ({}) as never, { onDelete: "explode" as unknown as "cascade" }),
    ).toThrow(ModelDefinitionError);
  });

  it("rejects a non-lazy foreign key target", () => {
    expect(() => fields.foreignKey({} as never)).toThrow(ModelDefinitionError);
  });

  it("rejects an invalid file size limit", () => {
    expect(() => fields.file({ maxSize: 0 })).toThrow(ModelDefinitionError);
  });

  it("accepts a valid file field", () => {
    const avatar: Field = fields.image({
      optional: true,
      maxSize: 1_000_000,
      accept: ["image/png"],
    });
    expect(avatar.kind).toBe("image");
  });
});
