/**
 * KV-backed caching for read-heavy, staleness-tolerant data.
 *
 * KV is eventually consistent: a write can take up to about sixty seconds to be visible everywhere,
 * and reads can be served from an edge copy that predates the write. That makes it excellent for
 * rendered fragments, third-party responses and denormalised counters, and unsafe for anything a
 * stale read would make *wrong* rather than merely old — sessions, permissions, row locks and
 * uniqueness checks belong in D1 (D-014).
 */

/**
 * Shortest TTL KV accepts, in seconds.
 *
 * KV rejects anything below this with a `400`, so it is checked here where the call site is still
 * visible in the stack rather than surfacing as a failed request.
 */
export const MIN_TTL_SECONDS = 60;

/** Options accepted by {@link Cache.set} and {@link Cache.wrap}. */
export interface CacheWriteOptions {
  /** Seconds until the entry expires. Omit for an entry that lives until evicted. */
  readonly ttlSeconds?: number;
}

/** Options accepted by {@link createCache}. */
export interface CacheOptions {
  /** Namespace applied to every key, so one binding can host several caches. Defaults to `clango:`. */
  readonly prefix?: string;
}

/** A JSON cache over a KV namespace. */
export class Cache {
  private readonly kv: KVNamespace;
  private readonly prefix: string;

  constructor(kv: KVNamespace, options: CacheOptions = {}) {
    this.kv = kv;
    this.prefix = options.prefix ?? "clango:";
  }

  private keyFor(key: string): string {
    return `${this.prefix}${key}`;
  }

  /** Reads an entry, returning `null` when it is missing or has expired. */
  async get<T>(key: string): Promise<T | null> {
    const stored = await this.kv.get<T>(this.keyFor(key), "json");
    return stored ?? null;
  }

  /** Writes an entry. */
  async set(key: string, value: unknown, options: CacheWriteOptions = {}): Promise<void> {
    const serialised = JSON.stringify(value ?? null);
    if (options.ttlSeconds === undefined) {
      await this.kv.put(this.keyFor(key), serialised);
      return;
    }
    if (!Number.isInteger(options.ttlSeconds) || options.ttlSeconds < MIN_TTL_SECONDS) {
      throw new Error(
        `Cache TTL must be an integer of at least ${MIN_TTL_SECONDS} seconds; KV rejects anything shorter.`,
      );
    }
    await this.kv.put(this.keyFor(key), serialised, { expirationTtl: options.ttlSeconds });
  }

  /** Removes an entry. */
  async delete(key: string): Promise<void> {
    await this.kv.delete(this.keyFor(key));
  }

  /**
   * Read-through caching: returns the cached value, or loads it, caches it and returns it.
   *
   * A concurrent miss may call the loader more than once; that is the deliberate trade for not
   * holding a lock on a system whose whole point is being cheap and available.
   */
  async wrap<T>(
    key: string,
    loader: () => Promise<T>,
    options: CacheWriteOptions = {},
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const value = await loader();
    await this.set(key, value, options);
    return value;
  }

  /**
   * Deletes every entry under a prefix and returns how many were removed.
   *
   * KV deletes are not atomic and the listing is a snapshot, so an entry written while this runs may
   * survive. That is acceptable for expiry, which only needs to make stale data unlikely.
   */
  async invalidate(prefix: string, options: { readonly limit?: number } = {}): Promise<number> {
    const limit = options.limit ?? 1000;
    let deleted = 0;
    let cursor: string | undefined;

    do {
      const listed: KVNamespaceListResult<unknown, string> = await this.kv.list({
        prefix: this.keyFor(prefix),
        limit: 1000,
        ...(cursor === undefined ? {} : { cursor }),
      });
      for (const key of listed.keys) {
        await this.kv.delete(key.name);
        deleted += 1;
        if (deleted >= limit) return deleted;
      }
      cursor = listed.list_complete ? undefined : listed.cursor;
    } while (cursor !== undefined);

    return deleted;
  }
}

/** Creates a cache over a KV binding. */
export function createCache(kv: KVNamespace, options: CacheOptions = {}): Cache {
  return new Cache(kv, options);
}
