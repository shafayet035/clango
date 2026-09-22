import {
  CLANGO_GROUP_MODEL,
  CLANGO_USER_MODEL,
  collectRegistry,
  defineApp,
  defineConfig,
  defineModel,
  fields,
  type AnyModel,
  type AuthIdentity,
} from "@clango/core";
import { buildSnapshot, emptySnapshot, planMigration } from "@clango/migrate";
import { buildSchema } from "@clango/orm";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, describe, expect, it } from "vitest";

import { Authorization, can, canAny } from "../src/index";

const Post = defineModel("blog.Post", {
  fields: { title: fields.string({ max: 200 }) },
  meta: { labelField: "title" },
});

const app = defineApp({ name: "blog", models: [Post] as readonly AnyModel[], database: "DB_MAIN" });

const config = defineConfig({
  apps: [app],
  databases: { DB_MAIN: { binding: "DB_MAIN" } },
  auth: { enabled: true, adapter: { getUser: async () => null } },
});

const registry = collectRegistry(config);
const schema = buildSchema(registry);
const authorization = new Authorization({ registry, schema });
const db = drizzle(env.DB_MAIN);

function identity(overrides: Partial<AuthIdentity> = {}): AuthIdentity {
  return { id: "auth-1", email: "ada@example.com", ...overrides };
}

const signedIn = async (auth: Authorization, id: string, email: string) =>
  auth.resolveUser(db, { id, email });

beforeAll(async () => {
  const plan = planMigration(emptySnapshot(), buildSnapshot(registry));
  await env.DB_MAIN.batch(plan.statements.map((statement) => env.DB_MAIN.prepare(statement)));
});

describe("catalogue", () => {
  it("derives four permissions per model, including the framework tables", () => {
    const catalogue = authorization.catalogue();
    expect(catalogue).toEqual(
      expect.arrayContaining([
        "blog.view_post",
        "blog.add_post",
        "blog.change_post",
        "blog.delete_post",
        "clango.view_user",
        "clango.change_group",
      ]),
    );
    expect(catalogue).toHaveLength(registry.models.length * 4);
  });
});

describe("resolveUser", () => {
  it("provisions a Clango user on first sign-in", async () => {
    const user = await authorization.resolveUser(
      db,
      identity({ id: "auth-new", email: "new@example.com" }),
    );
    expect(user.id).toBe("auth-new");
    expect(user.email).toBe("new@example.com");
    expect(user.isStaff).toBe(false);
    expect(user.isSuperuser).toBe(false);
    expect(user.permissions.size).toBe(0);
  });

  it("reuses the same row on subsequent requests", async () => {
    await authorization.resolveUser(
      db,
      identity({ id: "auth-repeat", email: "repeat@example.com" }),
    );
    await authorization.resolveUser(
      db,
      identity({ id: "auth-repeat", email: "repeat@example.com" }),
    );
    const rows = await env.DB_MAIN.prepare("SELECT id FROM clango_user WHERE email = ?")
      .bind("repeat@example.com")
      .all();
    expect(rows.results).toHaveLength(1);
  });

  it("links a pre-created row by email, keeping its flags", async () => {
    await authorization.setFlags(db, "boss@example.com", { isStaff: true, isSuperuser: true });
    const user = await authorization.resolveUser(
      db,
      identity({ id: "auth-boss", email: "boss@example.com" }),
    );
    expect(user.isStaff).toBe(true);
    expect(user.isSuperuser).toBe(true);
    expect(user.id).toBe("auth-boss");

    const linked = await env.DB_MAIN.prepare(
      "SELECT auth_id AS authId FROM clango_user WHERE email = ?",
    )
      .bind("boss@example.com")
      .first<{ authId: string | null }>();
    expect(linked?.authId).toBe("auth-boss");
  });

  it("never trusts the provider for flags", async () => {
    const user = await authorization.resolveUser(
      db,
      identity({ id: "auth-su", email: "su@example.com" }),
    );
    expect(user.isStaff).toBe(false);
    expect(user.isSuperuser).toBe(false);
  });

  it("gives a superuser the whole catalogue", async () => {
    await authorization.setFlags(db, "root@example.com", { isStaff: true, isSuperuser: true });
    const user = await signedIn(authorization, "auth-root", "root@example.com");
    expect(user.permissions.size).toBe(authorization.catalogue().length);
    expect(can(user, "anything.at_all")).toBe(true);
  });
});

describe("grants", () => {
  it("grants a permission directly to a user", async () => {
    const user = await authorization.resolveUser(
      db,
      identity({ id: "auth-direct", email: "direct@example.com" }),
    );
    const userId = await authorization.findUserIdByEmail(db, "direct@example.com");
    expect(userId).toBeDefined();

    expect(await authorization.grantToUser(db, userId as string, "blog.view_post")).toBe(true);
    expect(await authorization.grantToUser(db, userId as string, "blog.view_post")).toBe(false);

    const reloaded = await authorization.resolveUser(
      db,
      identity({ id: "auth-direct", email: "direct@example.com" }),
    );
    expect(can(reloaded, "blog.view_post")).toBe(true);
    expect(can(reloaded, "blog.delete_post")).toBe(false);
    expect(user.permissions.size).toBe(0);
  });

  it("grants permissions through a group", async () => {
    const groupId = await authorization.ensureGroup(db, "editors");
    expect(await authorization.ensureGroup(db, "editors")).toBe(groupId);
    expect(await authorization.grantToGroup(db, groupId, "blog.change_post")).toBe(true);
    expect(await authorization.grantToGroup(db, groupId, "blog.change_post")).toBe(false);

    await authorization.resolveUser(db, identity({ id: "auth-group", email: "group@example.com" }));
    const userId = await authorization.findUserIdByEmail(db, "group@example.com");
    expect(await authorization.addUserToGroup(db, userId as string, groupId)).toBe(true);
    expect(await authorization.addUserToGroup(db, userId as string, groupId)).toBe(false);

    const user = await authorization.resolveUser(
      db,
      identity({ id: "auth-group", email: "group@example.com" }),
    );
    expect(can(user, "blog.change_post")).toBe(true);
    expect(can(user, "blog.view_post")).toBe(false);
  });

  it("combines direct and group grants", async () => {
    const groupId = await authorization.ensureGroup(db, "reviewers");
    await authorization.grantToGroup(db, groupId, "blog.view_post");
    await authorization.resolveUser(db, identity({ id: "auth-both", email: "both@example.com" }));
    const userId = await authorization.findUserIdByEmail(db, "both@example.com");
    await authorization.addUserToGroup(db, userId as string, groupId);
    await authorization.grantToUser(db, userId as string, "blog.add_post");

    const user = await authorization.resolveUser(
      db,
      identity({ id: "auth-both", email: "both@example.com" }),
    );
    expect([...user.permissions].sort()).toEqual(["blog.add_post", "blog.view_post"]);
  });
});

describe("can", () => {
  it("denies everything for an anonymous caller", () => {
    expect(can(null, "blog.view_post")).toBe(false);
    expect(canAny(null, ["blog.view_post"])).toBe(false);
  });

  it("treats a superuser as holding everything", () => {
    const superuser = {
      id: "x",
      email: "x@example.com",
      isStaff: true,
      isSuperuser: true,
      permissions: new Set<string>(),
    };
    expect(can(superuser, "anything.at_all")).toBe(true);
    expect(canAny(superuser, ["nope"])).toBe(true);
  });
});

describe("schema", () => {
  it("creates the authorization tables", async () => {
    const tables = await env.DB_MAIN.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    const names = tables.results.map((row) => row.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "clango_user",
        "clango_group",
        "clango_user_group",
        "clango_group_permission",
        "clango_user_permission",
      ]),
    );
  });

  it("registers the user model with the framework app label", () => {
    expect(schema.table(CLANGO_USER_MODEL)).toBeDefined();
    expect(schema.table(CLANGO_GROUP_MODEL)).toBeDefined();
  });
});
