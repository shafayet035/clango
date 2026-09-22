import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { createCache, MIN_TTL_SECONDS, type Cache } from "../src/index";

let cache: Cache;

beforeEach(async () => {
  cache = createCache(env.CACHE, { prefix: `test:${crypto.randomUUID()}:` });
});

describe("get and set", () => {
  it("round-trips JSON values", async () => {
    await cache.set("post:1", { title: "Hello", tags: ["a"] });
    expect(await cache.get("post:1")).toEqual({ title: "Hello", tags: ["a"] });
  });

  it("returns null for a missing key", async () => {
    expect(await cache.get("nope")).toBeNull();
  });

  it("preserves falsy values other than null", async () => {
    await cache.set("zero", 0);
    await cache.set("empty", "");
    await cache.set("no", false);
    expect(await cache.get("zero")).toBe(0);
    expect(await cache.get("empty")).toBe("");
    expect(await cache.get("no")).toBe(false);
  });

  it("deletes an entry", async () => {
    await cache.set("gone", 1);
    await cache.delete("gone");
    expect(await cache.get("gone")).toBeNull();
  });

  it("rejects a TTL shorter than KV allows", async () => {
    await expect(cache.set("short", 1, { ttlSeconds: MIN_TTL_SECONDS - 1 })).rejects.toThrow(
      /at least 60/,
    );
    await expect(cache.set("short", 1, { ttlSeconds: 1.5 })).rejects.toThrow();
  });

  it("namespaces keys so one binding can host several caches", async () => {
    const other = createCache(env.CACHE, { prefix: "other:" });
    await cache.set("shared", "first");
    await other.set("shared", "second");
    expect(await cache.get("shared")).toBe("first");
    expect(await other.get("shared")).toBe("second");
  });
});

describe("wrap", () => {
  it("loads once and serves the cached value afterwards", async () => {
    let loads = 0;
    const loader = async () => {
      loads += 1;
      return { value: loads };
    };

    expect(await cache.wrap("wrapped", loader)).toEqual({ value: 1 });
    expect(await cache.wrap("wrapped", loader)).toEqual({ value: 1 });
    expect(loads).toBe(1);
  });

  it("does not cache a rejection", async () => {
    let attempts = 0;
    const failing = async () => {
      attempts += 1;
      throw new Error("upstream down");
    };

    await expect(cache.wrap("failing", failing)).rejects.toThrow();
    await expect(cache.wrap("failing", failing)).rejects.toThrow();
    expect(attempts).toBe(2);
  });

  it("reloads after the entry is deleted", async () => {
    let loads = 0;
    const loader = async () => {
      loads += 1;
      return loads;
    };
    await cache.wrap("reload", loader);
    await cache.delete("reload");
    expect(await cache.wrap("reload", loader)).toBe(2);
  });
});

describe("invalidate", () => {
  it("removes every entry under a prefix and leaves the rest", async () => {
    await cache.set("post:1", "a");
    await cache.set("post:2", "b");
    await cache.set("author:1", "c");

    expect(await cache.invalidate("post:")).toBe(2);
    expect(await cache.get("post:1")).toBeNull();
    expect(await cache.get("post:2")).toBeNull();
    expect(await cache.get("author:1")).toBe("c");
  });

  it("stops at the limit", async () => {
    for (let index = 0; index < 5; index++) await cache.set(`bulk:${index}`, index);
    expect(await cache.invalidate("bulk:", { limit: 3 })).toBe(3);
  });

  it("returns zero when nothing matches", async () => {
    expect(await cache.invalidate("nothing:")).toBe(0);
  });
});
