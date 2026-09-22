import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";

import type { DatabaseDriver } from "./router";

/**
 * Drizzle clients.
 *
 * Drizzle's D1 driver is typed against `D1Database`, but it only ever calls `prepare` and `batch` —
 * both of which a `D1DatabaseSession` provides. Routing the client through a session is what gives
 * sequential consistency per request and, once read replication is enabled on the database, sends
 * reads to a nearby replica. The cast lives here so it is stated once.
 */
export function drizzleOverSession(session: D1DatabaseSession): DrizzleD1Database {
  return drizzle(session as unknown as D1Database);
}

export type { DrizzleD1Database };

/** Creates a session-backed client for a driver. */
export function clientForDriver(driver: DatabaseDriver): DrizzleD1Database {
  return drizzleOverSession(driver.session());
}
