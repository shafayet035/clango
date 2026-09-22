import { Authorization } from "@clango/auth";
import { collectRegistry } from "@clango/core";
import { buildSchema } from "@clango/orm";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";

import config from "../clango.config";

/** Email the admin tests act as. Appointed as a superuser before the suite runs. */
export const SUPERUSER = "admin@example.com";

const registry = collectRegistry(config);
const authorization = new Authorization({ registry, schema: buildSchema(registry) });
const db = drizzle(env.DB_MAIN);

/** Grants staff and superuser authority to an address, creating the Clango user row if needed. */
export async function appointSuperuser(email: string): Promise<void> {
  await authorization.setFlags(db, email, { isStaff: true, isSuperuser: true });
}

/**
 * Grants staff access without superuser authority, so the account only holds whatever permissions
 * are granted to it explicitly. This is the interesting case for permission tests.
 */
export async function appointStaff(email: string): Promise<void> {
  await authorization.setFlags(db, email, { isStaff: true, isSuperuser: false });
}

/** Grants one permission to an address, provisioning the Clango user row first. */
export async function grantPermission(email: string, codename: string): Promise<void> {
  const id = await authorization.findUserIdByEmail(db, email);
  if (id === undefined) {
    throw new Error(`No Clango user for ${email}; make one authenticated request first.`);
  }
  await authorization.grantToUser(db, id, codename);
}

/** Adds a user to a group with the given permissions. */
export async function joinGroup(
  email: string,
  group: string,
  codenames: readonly string[],
): Promise<void> {
  const groupId = await authorization.ensureGroup(db, group);
  for (const codename of codenames) await authorization.grantToGroup(db, groupId, codename);
  const id = await authorization.findUserIdByEmail(db, email);
  if (id === undefined) throw new Error(`No Clango user for ${email}`);
  await authorization.addUserToGroup(db, id, groupId);
}

/** True when the address resolves to a staff Clango user. */
export async function isKnown(email: string): Promise<boolean> {
  return (await authorization.findUserIdByEmail(db, email)) !== undefined;
}

export interface CallResult {
  readonly status: number;
  readonly body: unknown;
  readonly contentType: string;
}

/** Calls the Worker as `email`, or anonymously when `email` is null. */
export async function call(
  email: string | null,
  path: string,
  init?: RequestInit,
): Promise<CallResult> {
  const { exports } = await import("cloudflare:workers");
  const headers = new Headers(init?.headers);
  if (email !== null) headers.set("x-dev-user", email);
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  const response = await exports.default.fetch(`https://example.com${path}`, { ...init, headers });
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  return {
    status: response.status,
    body:
      text.length === 0 ? null : contentType.includes("application/json") ? JSON.parse(text) : text,
    contentType,
  };
}

/** Shorthand for a JSON body request. */
export function json(method: string, payload: unknown): RequestInit {
  return { method, body: JSON.stringify(payload) };
}
