import { describe, expect, it } from "vitest";

import {
  formatCell,
  formatOrder,
  listQueryString,
  orderMarker,
  parseOrder,
  toggleOrder,
} from "../src/features/list/_lib/format";
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

describe("order handling", () => {
  it("parses a mix of directions", () => {
    expect(parseOrder("-publishedAt,title")).toEqual([
      { property: "publishedAt", direction: "desc" },
      { property: "title", direction: "asc" },
    ]);
  });

  it("ignores empty segments", () => {
    expect(parseOrder("title,, ")).toEqual([{ property: "title", direction: "asc" }]);
  });

  it("round-trips", () => {
    const entries = [
      { property: "publishedAt", direction: "desc" as const },
      { property: "id", direction: "asc" as const },
    ];
    expect(parseOrder(formatOrder(entries))).toEqual(entries);
  });

  it("makes a newly clicked column primary and ascending", () => {
    expect(toggleOrder("title", "status")).toBe("status,title");
    expect(toggleOrder("title,-status", "status")).toBe("status,title");
  });

  it("flips the primary column", () => {
    expect(toggleOrder("title", "title")).toBe("-title");
    expect(toggleOrder("-title", "title")).toBe("title");
  });

  it("keeps the remaining columns as tie breakers", () => {
    expect(toggleOrder("title,-publishedAt", "status")).toBe("status,title,-publishedAt");
  });

  it("marks the direction of the active column", () => {
    expect(orderMarker("-publishedAt,title", "publishedAt")).toBe("↓");
    expect(orderMarker("-publishedAt,title", "title")).toBe("↑");
    expect(orderMarker("-publishedAt", "status")).toBe("");
  });
});

describe("formatCell", () => {
  it("renders null as a dash", () => {
    expect(formatCell(undefined, null, new Map())).toBe("—");
    expect(formatCell(undefined, undefined, new Map())).toBe("—");
  });

  it("resolves relation ids to labels", () => {
    const relation = field({ name: "author", widget: "relation" });
    expect(formatCell(relation, "a1", new Map([["a1", "Ada"]]))).toBe("Ada");
    expect(formatCell(relation, "a2", new Map([["a1", "Ada"]]))).toBe("a2");
  });

  it("renders booleans as yes and no", () => {
    const checkbox = field({ name: "published", widget: "checkbox" });
    expect(formatCell(checkbox, true, new Map())).toBe("yes");
    expect(formatCell(checkbox, false, new Map())).toBe("no");
  });

  it("renders timestamps without the timezone suffix", () => {
    const datetime = field({ name: "publishedAt", widget: "datetime" });
    expect(formatCell(datetime, "2026-09-22T10:30:00.000Z", new Map())).toBe("2026-09-22 10:30");
  });

  it("renders JSON inline", () => {
    const json = field({ name: "meta", widget: "json" });
    expect(formatCell(json, { tags: ["a"] }, new Map())).toBe('{"tags":["a"]}');
  });
});

describe("listQueryString", () => {
  it("adds the limit and drops an absent cursor", () => {
    const params = new URLSearchParams({ search: "ada" });
    expect(listQueryString(params, 25, null)).toBe("search=ada&limit=25");
  });

  it("includes the cursor when present", () => {
    expect(listQueryString(new URLSearchParams(), 10, "abc")).toBe("limit=10&cursor=abc");
  });

  it("does not mutate the input", () => {
    const params = new URLSearchParams({ search: "ada" });
    listQueryString(params, 25, null);
    expect(params.get("limit")).toBeNull();
  });
});
