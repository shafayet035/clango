import { describe, expect, it } from "vitest";

import { isUlid, newUlid } from "../src/index";

describe("newUlid", () => {
  it("produces a 26-character Crockford base32 identifier", () => {
    const id = newUlid();
    expect(id).toHaveLength(26);
    expect(isUlid(id)).toBe(true);
  });

  it("sorts lexicographically by timestamp", () => {
    const earlier = newUlid(1_700_000_000_000);
    const later = newUlid(1_700_000_001_000);
    expect(earlier < later).toBe(true);
  });

  it("stays monotonic when the clock stalls", () => {
    const first = newUlid(1_700_000_000_000);
    const second = newUlid(1_700_000_000_000);
    const third = newUlid(1_700_000_000_000);
    expect(first < second).toBe(true);
    expect(second < third).toBe(true);
  });

  it("stays monotonic when the clock moves backwards", () => {
    const first = newUlid(1_700_000_000_000);
    const second = newUlid(1_699_999_999_000);
    expect(first < second).toBe(true);
  });

  it("generates unique identifiers", () => {
    const ids = new Set(Array.from({ length: 1_000 }, () => newUlid()));
    expect(ids.size).toBe(1_000);
  });
});

describe("isUlid", () => {
  it("rejects strings that are not ULIDs", () => {
    expect(isUlid("")).toBe(false);
    expect(isUlid("not-a-ulid")).toBe(false);
    expect(isUlid("I".repeat(26))).toBe(false);
  });
});
