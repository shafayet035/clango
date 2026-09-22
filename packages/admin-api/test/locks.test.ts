import { describe, expect, it } from "vitest";

import { createLockService, DEFAULT_LOCK_TTL_SECONDS, lockKeyFor } from "../src/index";
import { env } from "cloudflare:workers";

const locks = createLockService({ namespace: env.ROW_LOCKS, shards: 4 });

describe("createLockService", () => {
  it("rejects a nonsensical shard count", () => {
    expect(() => createLockService({ namespace: env.ROW_LOCKS, shards: 0 })).toThrow();
  });
});

describe("lockKeyFor", () => {
  it("namespaces by model so equal ids do not collide", () => {
    expect(lockKeyFor("blog.Post", "01H")).toBe("blog.Post.01H");
    expect(lockKeyFor("blog.Author", "01H")).not.toBe(lockKeyFor("blog.Post", "01H"));
  });
});

describe("acquire", () => {
  it("grants the lock to the first caller", async () => {
    const grant = await locks.acquire("blog.Post.first", "user-a");
    expect(grant).toMatchObject({ holder: "user-a" });
    expect("token" in grant && grant.token.length).toBeGreaterThan(0);
    expect("token" in grant && grant.expiresAt).toBeGreaterThan(Date.now());
  });

  it("defaults to a five minute lease", async () => {
    const grant = await locks.acquire("blog.Post.default-ttl", "user-a");
    if (!("token" in grant)) throw new Error("expected a grant");
    expect(grant.expiresAt - Date.now()).toBeLessThanOrEqual(
      DEFAULT_LOCK_TTL_SECONDS * 1000 + 1000,
    );
  });

  it("refuses a second holder and names who has it", async () => {
    await locks.acquire("blog.Post.contended", "user-a");
    const refused = await locks.acquire("blog.Post.contended", "user-b");
    expect(refused).toEqual({ heldBy: "user-a", expiresAt: expect.any(Number) });
  });

  it("lets the same holder re-acquire and keeps the token", async () => {
    const first = await locks.acquire("blog.Post.reentrant", "user-a");
    const second = await locks.acquire("blog.Post.reentrant", "user-a");
    if (!("token" in first) || !("token" in second)) throw new Error("expected grants");
    expect(second.token).toBe(first.token);
    expect(second.expiresAt).toBeGreaterThanOrEqual(first.expiresAt);
  });

  it("stores an absolute expiry, so a short lease is observable", async () => {
    const grant = await locks.acquire("blog.Post.short-lease", "user-a", 30);
    if (!("token" in grant)) throw new Error("expected a grant");
    expect(grant.expiresAt - Date.now()).toBeLessThanOrEqual(30_000);
    expect(await locks.status("blog.Post.short-lease")).not.toBeNull();
  });
});

describe("release", () => {
  it("releases only with the right token", async () => {
    const grant = await locks.acquire("blog.Post.release", "user-a");
    if (!("token" in grant)) throw new Error("expected a grant");

    expect(await locks.release("blog.Post.release", "not-the-token")).toBe(false);
    expect(await locks.status("blog.Post.release")).not.toBeNull();

    expect(await locks.release("blog.Post.release", grant.token)).toBe(true);
    expect(await locks.status("blog.Post.release")).toBeNull();
  });

  it("reports a release for a lock nobody holds", async () => {
    expect(await locks.release("blog.Post.nobody", "token")).toBe(false);
  });
});

describe("sharding", () => {
  it("keeps different rows independent", async () => {
    await locks.acquire("blog.Post.a", "user-a");
    const other = await locks.acquire("blog.Post.b", "user-b");
    expect(other).toMatchObject({ holder: "user-b" });
  });
});
