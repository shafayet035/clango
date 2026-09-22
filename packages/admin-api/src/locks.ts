import { ClangoError } from "@clango/core";
import { DurableObject } from "cloudflare:workers";

/**
 * Row edit locks.
 *
 * Two people editing the same row is a correctness problem, not a UI annoyance: the second save
 * silently wins. A lock makes the conflict explicit without holding a database transaction open, and
 * Durable Objects are the right home for it — one single-threaded instance per shard means the
 * check-and-set is atomic.
 *
 * Locks are advisory and short-lived. They expire on their own so a closed tab cannot lock a row
 * forever, and the alarm releases them promptly rather than waiting for the next read.
 */

/** Default lock lifetime. Long enough to fill in a form, short enough to recover from a crash. */
export const DEFAULT_LOCK_TTL_SECONDS = 300;

/** Locks a caller currently holds. */
export interface LockGrant {
  readonly holder: string;
  /** Secret the holder presents to release the lock. */
  readonly token: string;
  /** Epoch milliseconds after which the lock is ignored. */
  readonly expiresAt: number;
}

/** Returned instead of a grant when someone else holds the lock. */
export interface LockRefusal {
  readonly heldBy: string;
  readonly expiresAt: number;
}

function isGrant(value: LockGrant | LockRefusal): value is LockGrant {
  return "token" in value;
}

/**
 * One shard of the lock pool.
 *
 * `alarm()` releases expired locks. Durable Objects allow a single alarm each, which is why the
 * alarm is set to the *earliest* expiry and rescheduled rather than one alarm per lock.
 */
export class RowLockDurableObject extends DurableObject {
  /** Takes the lock for `key`, or reports who holds it. */
  async acquire(key: string, holder: string, ttlSeconds: number): Promise<LockGrant | LockRefusal> {
    const now = Date.now();
    const existing = await this.read(key, now);
    if (existing !== null && existing.holder !== holder) {
      return { heldBy: existing.holder, expiresAt: existing.expiresAt };
    }

    // Re-acquiring refreshes the expiry and keeps the token, so a page refresh does not lose it.
    const grant: LockGrant = {
      holder,
      token: existing?.token ?? crypto.randomUUID(),
      expiresAt: now + ttlSeconds * 1000,
    };
    await this.ctx.storage.put(key, grant);
    await this.scheduleAlarm(grant.expiresAt);
    return grant;
  }

  /** Releases the lock when the token matches. */
  async release(key: string, token: string): Promise<boolean> {
    const existing = await this.read(key, Date.now());
    if (existing === null || existing.token !== token) return false;
    await this.ctx.storage.delete(key);
    return true;
  }

  /** Reports the current holder, or `null`. */
  async status(key: string): Promise<LockGrant | null> {
    return this.read(key, Date.now());
  }

  /** Reads a lock, treating an expired one as absent. */
  private async read(key: string, now: number): Promise<LockGrant | null> {
    const stored = await this.ctx.storage.get<LockGrant>(key);
    if (stored === undefined) return null;
    if (stored.expiresAt > now) return stored;
    await this.ctx.storage.delete(key);
    return null;
  }

  /** Points the single alarm at the earliest outstanding expiry. */
  private async scheduleAlarm(expiresAt: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || expiresAt < current) await this.ctx.storage.setAlarm(expiresAt);
  }

  /** Durable Object alarm handler: drops what has expired and reschedules for the rest. */
  override async alarm(): Promise<void> {
    const now = Date.now();
    const entries = await this.ctx.storage.list<LockGrant>();
    let next: number | null = null;

    for (const [key, grant] of entries) {
      if (grant.expiresAt <= now) {
        await this.ctx.storage.delete(key);
        continue;
      }
      if (next === null || grant.expiresAt < next) next = grant.expiresAt;
    }

    if (next !== null) await this.ctx.storage.setAlarm(next);
  }
}

/** The pool a lock service talks to. */
export interface LockService {
  acquire(key: string, holder: string, ttlSeconds?: number): Promise<LockGrant | LockRefusal>;
  release(key: string, token: string): Promise<boolean>;
  status(key: string): Promise<LockGrant | null>;
}

/** Options accepted by {@link createLockService}. */
export interface LockServiceOptions {
  readonly namespace: DurableObjectNamespace<RowLockDurableObject>;
  /**
   * Number of shards locks are spread across. Defaults to 16.
   *
   * A shard is a single-threaded object, so the pool size caps lock throughput rather than the number
   * of lockable rows; a hot row costs one shard, not the whole service.
   */
  readonly shards?: number;
}

/** Stable hash so the same row always lands on the same shard. */
function shardFor(key: string, shards: number): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % shards;
}

/**
 * Creates a lock service over a pool of {@link RowLockDurableObject} shards.
 *
 * The key is `<model>.<id>`, so two models with the same id do not collide.
 */
export function createLockService(options: LockServiceOptions): LockService {
  const shards = options.shards ?? 16;
  if (!Number.isInteger(shards) || shards < 1) {
    throw new ClangoError("Lock shard count must be a positive integer.");
  }

  function stubFor(key: string): DurableObjectStub<RowLockDurableObject> {
    return options.namespace.get(options.namespace.idFromName(`locks-${shardFor(key, shards)}`));
  }

  return {
    acquire: (key, holder, ttlSeconds = DEFAULT_LOCK_TTL_SECONDS) =>
      stubFor(key).acquire(key, holder, ttlSeconds),
    release: (key, token) => stubFor(key).release(key, token),
    status: (key) => stubFor(key).status(key),
  };
}

/** Builds the key a lock is stored under. */
export function lockKeyFor(modelName: string, id: string): string {
  return `${modelName}.${id}`;
}

export { isGrant };
