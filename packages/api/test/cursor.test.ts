import { describe, expect, it } from "vitest";

import { decodeCursor, encodeCursor } from "../src/cursor";
import { ApiError } from "../src/errors";
import { buildMatchExpression, orderSignature } from "../src/query";

describe("cursor", () => {
  it("round-trips", () => {
    const payload = { order: ["-publishedAt", "id"], values: ["2026-09-22T10:00:00.000Z", "01H"] };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it("is URL safe", () => {
    const encoded = encodeCursor({ order: ["id"], values: ["01H/+=="] });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects malformed input", () => {
    expect(() => decodeCursor("not-a-cursor")).toThrow(ApiError);
    expect(() => decodeCursor(encodeCursor({ order: [], values: [] }).slice(0, 5))).toThrow(
      ApiError,
    );
  });

  it("rejects a payload whose order and values disagree", () => {
    const encoded = encodeCursor({ order: ["id"], values: ["a", "b"] });
    expect(() => decodeCursor(encoded)).toThrow(ApiError);
  });
});

describe("orderSignature", () => {
  it("marks descending keys with a leading dash", () => {
    expect(
      orderSignature([
        { property: "publishedAt", direction: "desc", kind: "datetime" },
        { property: "id", direction: "asc", kind: "string" },
      ]),
    ).toEqual(["-publishedAt", "id"]);
  });
});

describe("buildMatchExpression", () => {
  it("quotes each token and prefix-matches the last one", () => {
    expect(buildMatchExpression("quick brown")).toBe('"quick" AND "brown"*');
  });

  it("escapes embedded quotes so FTS5 operators cannot be injected", () => {
    expect(buildMatchExpression('a" OR b')).toBe('"a""" AND "OR" AND "b"*');
  });

  it("strips redundant whitespace", () => {
    expect(buildMatchExpression("  spaced   out  ")).toBe('"spaced" AND "out"*');
  });

  it("rejects empty input", () => {
    expect(() => buildMatchExpression("   ")).toThrow(ApiError);
  });
});
