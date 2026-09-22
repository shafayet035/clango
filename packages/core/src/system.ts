import { fields } from "./fields";
import { defineModel } from "./model";

/**
 * Framework-owned models. These are registered alongside the project's own models whenever the
 * feature that needs them is enabled, so the migration engine creates and evolves their tables like
 * any other.
 */

/** Table name backing the admin audit log. */
export const ADMIN_LOG_MODEL_NAME = "clango.AdminLog";

/** Actions recorded in the admin log. */
export const ADMIN_LOG_ACTIONS = ["create", "update", "delete"] as const;

/** One action recorded in the admin log. */
export type AdminLogAction = (typeof ADMIN_LOG_ACTIONS)[number];

/**
 * Audit record for every write made through the admin.
 *
 * `diff` holds an object keyed by field name: the new value for a create, `{ from, to }` pairs for
 * an update, and the removed row for a delete. Values are stored as JSON so the log is not tied to
 * the shape of the model it describes.
 */
export const AdminLog = defineModel(ADMIN_LOG_MODEL_NAME, {
  fields: {
    action: fields.choice([...ADMIN_LOG_ACTIONS]),
    modelName: fields.string({ max: 200, index: true }),
    objectId: fields.string({ max: 64, index: true }),
    userId: fields.string({ max: 64, optional: true }),
    diff: fields.json<Record<string, unknown>>({ optional: true }),
  },
  meta: {
    ordering: ["-createdAt"],
    verboseName: "admin log entry",
    verboseNamePlural: "admin log",
  },
});

/**
 * Authorization lives in Clango-owned tables, never in the identity provider's, so the provider can
 * be swapped without touching permissions (D-003). `authId` is filled in the first time an
 * authenticated request matches the row's email.
 */

/** Qualified names of the authorization tables, for lookups through the registry. */
export const CLANGO_USER_MODEL = "clango.User";
export const CLANGO_GROUP_MODEL = "clango.Group";
export const CLANGO_USER_GROUP_MODEL = "clango.UserGroup";
export const CLANGO_GROUP_PERMISSION_MODEL = "clango.GroupPermission";
export const CLANGO_USER_PERMISSION_MODEL = "clango.UserPermission";

/** A person known to Clango. Identity (credentials, sessions) belongs to the auth adapter. */
export const ClangoUser = defineModel(CLANGO_USER_MODEL, {
  fields: {
    email: fields.email({ unique: true }),
    authId: fields.string({ max: 128, optional: true, unique: true }),
    name: fields.string({ max: 200, optional: true }),
    isStaff: fields.boolean({ default: false }),
    isSuperuser: fields.boolean({ default: false }),
  },
  meta: { labelField: "email", verboseName: "user", verboseNamePlural: "users" },
});

/** A named bundle of permissions given to users. */
export const ClangoGroup = defineModel(CLANGO_GROUP_MODEL, {
  fields: {
    name: fields.string({ max: 150, unique: true }),
    description: fields.text({ optional: true }),
  },
  meta: { labelField: "name", verboseName: "group", verboseNamePlural: "groups" },
});

/** Membership of a user in a group. */
export const ClangoUserGroup = defineModel(CLANGO_USER_GROUP_MODEL, {
  fields: {
    user: fields.foreignKey(() => ClangoUser, { onDelete: "cascade" }),
    group: fields.foreignKey(() => ClangoGroup, { onDelete: "cascade" }),
  },
  meta: { verboseName: "group membership", verboseNamePlural: "group memberships" },
});

/** A permission granted to a group, identified by its codename (`blog.view_post`). */
export const ClangoGroupPermission = defineModel(CLANGO_GROUP_PERMISSION_MODEL, {
  fields: {
    group: fields.foreignKey(() => ClangoGroup, { onDelete: "cascade" }),
    codename: fields.string({ max: 200, index: true }),
  },
  meta: { verboseName: "group permission", verboseNamePlural: "group permissions" },
});

/** A permission granted directly to a user, bypassing groups. */
export const ClangoUserPermission = defineModel(CLANGO_USER_PERMISSION_MODEL, {
  fields: {
    user: fields.foreignKey(() => ClangoUser, { onDelete: "cascade" }),
    codename: fields.string({ max: 200, index: true }),
  },
  meta: { verboseName: "user permission", verboseNamePlural: "user permissions" },
});

/** Every authorization table, in dependency order. */
export const AUTH_MODELS = [
  ClangoUser,
  ClangoGroup,
  ClangoUserGroup,
  ClangoGroupPermission,
  ClangoUserPermission,
] as const;

/** Qualified name of the tenant registry table. */
export const CLANGO_TENANT_MODEL = "clango.Tenant";

/**
 * A tenant.
 *
 * The registry lives in the project's control database and holds only facts an operator decides:
 * which tenants exist and whether they are suspended. Where their data lives is *derived* — the
 * binding for a tenant and a logical database comes from `tenants.bindingTemplate` (or the default
 * `<DATABASE>_<SLUG>`), because Workers bindings are static and must already be declared in
 * `wrangler.jsonc` (D-012, D-055).
 */
export const ClangoTenant = defineModel(CLANGO_TENANT_MODEL, {
  fields: {
    slug: fields.string({ max: 100, unique: true }),
    name: fields.string({ max: 200, optional: true }),
    /** Suspended tenants are refused by the resolver without deleting anything. */
    suspended: fields.boolean({ default: false }),
  },
  meta: { labelField: "slug", verboseName: "tenant", verboseNamePlural: "tenants" },
});

/** Every framework model that belongs to the control plane rather than tenant data. */
export const CONTROL_MODELS = [ClangoTenant] as const;
