import { describe, expect, it } from "vitest";

import {
  buildCreatePayload,
  buildUpdatePayload,
  fromFormValue,
  fromLocalInput,
  toFormValue,
  toLocalInput,
  validateRequired,
  valuesFromRow,
} from "../src/features/form/_lib/values";
import type { AdminFieldMeta } from "../src/features/meta/_types";

function field(
  overrides: Partial<AdminFieldMeta> & Pick<AdminFieldMeta, "name" | "widget">,
): AdminFieldMeta {
  return {
    label: overrides.name,
    kind: "string",
    required: false,
    nullable: false,
    editable: true,
    ...overrides,
  } as AdminFieldMeta;
}

const title = field({ name: "title", widget: "text", required: true });
const body = field({ name: "body", widget: "textarea", nullable: true, kind: "text" });
const status = field({
  name: "status",
  widget: "select",
  choices: ["draft", "published"],
  kind: "choice",
});
const rating = field({
  name: "rating",
  widget: "number",
  nullable: true,
  kind: "decimal",
  scale: 2,
});
const publishedAt = field({
  name: "publishedAt",
  widget: "datetime",
  nullable: true,
  kind: "datetime",
});
const meta = field({ name: "meta", widget: "json", nullable: true, kind: "json" });
const published = field({ name: "published", widget: "checkbox", kind: "boolean" });
const id = field({ name: "id", widget: "text", editable: false, required: true });

describe("local timestamps", () => {
  it("round-trips a Date", () => {
    const date = new Date("2026-09-22T10:30:00.000Z");
    const local = toLocalInput(date);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(fromLocalInput(local)).toBe(date.toISOString());
  });

  it("rejects unparseable input", () => {
    expect(() => fromLocalInput("not a date")).toThrow();
  });
});

describe("toFormValue", () => {
  it("renders null as empty", () => {
    expect(toFormValue(body, null)).toBe("");
  });

  it("renders booleans as checked state", () => {
    expect(toFormValue(published, true)).toBe(true);
    expect(toFormValue(published, null)).toBe(false);
  });

  it("pretty-prints JSON", () => {
    expect(toFormValue(meta, { tags: ["a"] })).toBe('{\n  "tags": [\n    "a"\n  ]\n}');
  });

  it("stringifies numbers and choices", () => {
    expect(toFormValue(rating, 12.34)).toBe("12.34");
    expect(toFormValue(status, "draft")).toBe("draft");
  });
});

describe("fromFormValue", () => {
  it("maps an empty nullable control to null", () => {
    expect(fromFormValue(body, "")).toBeNull();
    expect(fromFormValue(rating, "")).toBeNull();
  });

  it("keeps an empty required control empty for the server to judge", () => {
    expect(fromFormValue(title, "")).toBe("");
  });

  it("parses numbers and rejects junk", () => {
    expect(fromFormValue(rating, "12.34")).toBe(12.34);
    expect(() => fromFormValue(rating, "abc")).toThrow();
  });

  it("parses JSON and rejects junk", () => {
    expect(fromFormValue(meta, '{"a":1}')).toEqual({ a: 1 });
    expect(() => fromFormValue(meta, "{")).toThrow();
  });

  it("parses datetime-local into ISO", () => {
    const iso = fromFormValue(publishedAt, "2026-09-22T10:30");
    expect(Number.isNaN(new Date(iso as string).getTime())).toBe(false);
  });
});

describe("validateRequired", () => {
  it("reports empty required fields by label", () => {
    expect(validateRequired([title, body], { title: "", body: "" })).toEqual(["title"]);
  });

  it("ignores read-only fields", () => {
    expect(validateRequired([id], { id: "" })).toEqual([]);
  });
});

describe("payload builders", () => {
  it("omits empty optional fields on create so defaults still apply", () => {
    expect(
      buildCreatePayload([title, status, body], { title: "Hello", status: "", body: "" }),
    ).toEqual({
      title: "Hello",
    });
  });

  it("keeps empty required fields on create", () => {
    expect(buildCreatePayload([title], { title: "" })).toEqual({ title: "" });
  });

  it("writes every editable field on update so blanking clears a value", () => {
    expect(
      buildUpdatePayload([title, status, body], { title: "Hello", status: "", body: "" }),
    ).toEqual({
      title: "Hello",
      status: "",
      body: null,
    });
  });

  it("never sends read-only fields", () => {
    expect(buildCreatePayload([id, title], { id: "x", title: "Hello" })).toEqual({
      title: "Hello",
    });
    expect(buildUpdatePayload([id, title], { id: "x", title: "Hello" })).toEqual({
      title: "Hello",
    });
  });
});

describe("valuesFromRow", () => {
  it("maps a row into form state", () => {
    expect(
      valuesFromRow([title, published, rating], { title: "Hello", published: true, rating: 12.34 }),
    ).toEqual({
      title: "Hello",
      published: true,
      rating: "12.34",
    });
  });
});
