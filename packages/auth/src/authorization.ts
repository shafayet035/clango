import {
  CLANGO_GROUP_MODEL,
  CLANGO_GROUP_PERMISSION_MODEL,
  CLANGO_USER_GROUP_MODEL,
  CLANGO_USER_MODEL,
  CLANGO_USER_PERMISSION_MODEL,
  modelPermissions,
  newUlid,
  type AuthIdentity,
  type ClangoUser,
  type PermissionCodename,
  type Registry,
} from "@clango/core";
import type { DatabaseSchema } from "@clango/orm";
import { eq, getTableColumns, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

/** A Clango user together with everything they are allowed to do. */
export interface AuthorizedUser extends ClangoUser {
  readonly permissions: ReadonlySet<PermissionCodename>;
}

/** `true` when the user holds a permission. Superusers hold every permission implicitly. */
export function can(user: AuthorizedUser | null, codename: PermissionCodename): boolean {
  if (user === null) return false;
  if (user.isSuperuser) return true;
  return user.permissions.has(codename);
}

/** `true` when the user holds at least one of the permissions. */
export function canAny(
  user: AuthorizedUser | null,
  codenames: readonly PermissionCodename[],
): boolean {
  return codenames.some((codename) => can(user, codename));
}

type Columns = Record<string, SQLiteColumn>;

function columnsOf(
  schema: DatabaseSchema,
  modelName: string,
): { table: SQLiteTable; columns: Columns } {
  const table = schema.table(modelName);
  return { table, columns: getTableColumns(table) as unknown as Columns };
}

/**
 * Resolves identities into permissions and manages grants.
 *
 * Authorization data is Clango-owned (D-003), so the same groups and grants work whatever identity
 * provider is plugged in. Every method takes the database it should run against, which keeps the
 * service free of request state and lets M6 route it per tenant.
 */
export class Authorization {
  private readonly registry: Registry;
  private readonly schema: DatabaseSchema;

  constructor(options: { registry: Registry; schema: DatabaseSchema }) {
    this.registry = options.registry;
    this.schema = options.schema;
  }

  /** Every permission the project defines, derived from the model registry. */
  catalogue(): readonly PermissionCodename[] {
    return this.registry.models.flatMap((entry) => modelPermissions(entry.model));
  }

  /**
   * Finds or creates the Clango user for an authenticated identity and loads its permissions.
   *
   * A row created ahead of time — by `clango createsuperuser`, say — is matched by email and linked
   * on first sign-in, so a superuser can be appointed before their account exists.
   */
  async resolveUser(db: DrizzleD1Database, identity: AuthIdentity): Promise<AuthorizedUser> {
    const row = await this.upsertUser(db, identity);
    const permissions = row.isSuperuser
      ? new Set(this.catalogue())
      : await this.grantsFor(db, row.id);
    return {
      id: identity.id,
      email: row.email,
      isStaff: row.isStaff,
      isSuperuser: row.isSuperuser,
      permissions,
    };
  }

  private async upsertUser(
    db: DrizzleD1Database,
    identity: AuthIdentity,
  ): Promise<{ id: string; email: string; isStaff: boolean; isSuperuser: boolean }> {
    const { table, columns } = this.userColumns();

    const byAuthId = await db
      .select()
      .from(table)
      .where(eq(columns["authId"] as SQLiteColumn, identity.id))
      .limit(1)
      .all();
    const linked = byAuthId[0] as Record<string, unknown> | undefined;
    if (linked !== undefined) return readUserRow(linked);

    const byEmail = await db
      .select()
      .from(table)
      .where(eq(columns["email"] as SQLiteColumn, identity.email))
      .limit(1)
      .all();
    const pending = byEmail[0] as Record<string, unknown> | undefined;
    if (pending !== undefined) {
      await db
        .update(table)
        .set({ authId: identity.id, updatedAt: new Date() })
        .where(eq(columns["id"] as SQLiteColumn, String(pending["id"])))
        .run();
      return readUserRow({ ...pending, authId: identity.id });
    }

    const now = new Date();
    const id = newUlid();
    await db
      .insert(table)
      .values({
        id,
        createdAt: now,
        updatedAt: now,
        email: identity.email,
        authId: identity.id,
        // New accounts are neither staff nor superusers: authority is granted, never claimed.
        isStaff: false,
        isSuperuser: false,
      })
      .run();
    return { id, email: identity.email, isStaff: false, isSuperuser: false };
  }

  /** Codenames granted directly to a user or through any group they belong to. */
  async grantsFor(db: DrizzleD1Database, userId: string): Promise<Set<PermissionCodename>> {
    const granted = new Set<PermissionCodename>();

    const direct = this.userPermissionColumns();
    const directRows = await db
      .select()
      .from(direct.table)
      .where(eq(direct.columns["user"] as SQLiteColumn, userId))
      .all();
    for (const row of directRows as Record<string, unknown>[]) {
      granted.add(String(row["codename"]));
    }

    const memberships = this.userGroupColumns();
    const groupIds = (
      await db
        .select()
        .from(memberships.table)
        .where(eq(memberships.columns["user"] as SQLiteColumn, userId))
        .all()
    ).map((row) => String((row as Record<string, unknown>)["group"]));
    if (groupIds.length === 0) return granted;

    const groupPermissions = this.groupPermissionColumns();
    const groupRows = await db
      .select()
      .from(groupPermissions.table)
      .where(inArray(groupPermissions.columns["group"] as SQLiteColumn, groupIds))
      .all();
    for (const row of groupRows as Record<string, unknown>[]) {
      granted.add(String(row["codename"]));
    }
    return granted;
  }

  /** Marks a user as staff and/or superuser, creating the row when the email is unknown. */
  async setFlags(
    db: DrizzleD1Database,
    email: string,
    flags: { isStaff: boolean; isSuperuser: boolean },
  ): Promise<{ id: string; created: boolean }> {
    const { table, columns } = this.userColumns();
    const existing = await db
      .select()
      .from(table)
      .where(eq(columns["email"] as SQLiteColumn, email))
      .limit(1)
      .all();
    const row = existing[0] as Record<string, unknown> | undefined;
    const now = new Date();

    if (row === undefined) {
      const id = newUlid();
      await db
        .insert(table)
        .values({ id, createdAt: now, updatedAt: now, email, ...flags })
        .run();
      return { id, created: true };
    }

    await db
      .update(table)
      .set({ ...flags, updatedAt: now })
      .where(eq(columns["id"] as SQLiteColumn, String(row["id"])))
      .run();
    return { id: String(row["id"]), created: false };
  }

  /** Creates a group if it does not exist and returns its id. */
  async ensureGroup(db: DrizzleD1Database, name: string): Promise<string> {
    const { table, columns } = this.groupColumns();
    const existing = await db
      .select()
      .from(table)
      .where(eq(columns["name"] as SQLiteColumn, name))
      .limit(1)
      .all();
    const row = existing[0] as Record<string, unknown> | undefined;
    if (row !== undefined) return String(row["id"]);

    const id = newUlid();
    const now = new Date();
    await db.insert(table).values({ id, createdAt: now, updatedAt: now, name }).run();
    return id;
  }

  /** Adds a user to a group. Idempotent: duplicate memberships are ignored. */
  async addUserToGroup(db: DrizzleD1Database, userId: string, groupId: string): Promise<boolean> {
    const { table, columns } = this.userGroupColumns();
    const existing = await db
      .select()
      .from(table)
      .where(eq(columns["user"] as SQLiteColumn, userId))
      .all();
    if ((existing as Record<string, unknown>[]).some((row) => row["group"] === groupId))
      return false;

    const now = new Date();
    await db
      .insert(table)
      .values({ id: newUlid(), createdAt: now, updatedAt: now, user: userId, group: groupId })
      .run();
    return true;
  }

  /** Grants a permission to a group. Idempotent. */
  async grantToGroup(db: DrizzleD1Database, groupId: string, codename: string): Promise<boolean> {
    const { table, columns } = this.groupPermissionColumns();
    const existing = await db
      .select()
      .from(table)
      .where(eq(columns["group"] as SQLiteColumn, groupId))
      .all();
    if ((existing as Record<string, unknown>[]).some((row) => row["codename"] === codename))
      return false;

    const now = new Date();
    await db
      .insert(table)
      .values({ id: newUlid(), createdAt: now, updatedAt: now, group: groupId, codename })
      .run();
    return true;
  }

  /** Grants a permission directly to a user. Idempotent. */
  async grantToUser(db: DrizzleD1Database, userId: string, codename: string): Promise<boolean> {
    const { table, columns } = this.userPermissionColumns();
    const existing = await db
      .select()
      .from(table)
      .where(eq(columns["user"] as SQLiteColumn, userId))
      .all();
    if ((existing as Record<string, unknown>[]).some((row) => row["codename"] === codename))
      return false;

    const now = new Date();
    await db
      .insert(table)
      .values({ id: newUlid(), createdAt: now, updatedAt: now, user: userId, codename })
      .run();
    return true;
  }

  /** Resolves the Clango user id for an email, if the row exists. */
  async findUserIdByEmail(db: DrizzleD1Database, email: string): Promise<string | undefined> {
    const { table, columns } = this.userColumns();
    const rows = await db
      .select()
      .from(table)
      .where(eq(columns["email"] as SQLiteColumn, email))
      .limit(1)
      .all();
    const row = rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? undefined : String(row["id"]);
  }

  private userColumns() {
    return columnsOf(this.schema, CLANGO_USER_MODEL);
  }

  private groupColumns() {
    return columnsOf(this.schema, CLANGO_GROUP_MODEL);
  }

  private userGroupColumns() {
    return columnsOf(this.schema, CLANGO_USER_GROUP_MODEL);
  }

  private groupPermissionColumns() {
    return columnsOf(this.schema, CLANGO_GROUP_PERMISSION_MODEL);
  }

  private userPermissionColumns() {
    return columnsOf(this.schema, CLANGO_USER_PERMISSION_MODEL);
  }
}

function readUserRow(row: Record<string, unknown>): {
  id: string;
  email: string;
  isStaff: boolean;
  isSuperuser: boolean;
} {
  return {
    id: String(row["id"]),
    email: String(row["email"]),
    isStaff: row["isStaff"] === true,
    isSuperuser: row["isSuperuser"] === true,
  };
}
