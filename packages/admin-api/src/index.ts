/**
 * Clango's generated admin backend: model metadata for the admin SPA, CRUD endpoints for every
 * registered model, relation pickers, cascade previews and the audit log.
 *
 * Nothing here is authenticated yet — the staff gate arrives with the auth adapter in M4 — so the
 * admin is only built when a project opts in with `admin: { enabled: true }`.
 */

export {
  cascadeEdges,
  cascadePreview,
  type CascadeEntry,
  type CascadePreviewOptions,
} from "./cascade";
export { adminLogValues, buildUpdateDiff, type AdminLogInput } from "./log";
export { adminKeyFor, adminPathFor, buildMeta, columnsOf, humanize, labelFieldOf } from "./meta";
export {
  adminConfigFor,
  clearAdminRegistry,
  editableFields,
  isAutomatic,
  registerAdmin,
  registeredAdmins,
  type AdminAction,
  type AdminActionContext,
  type AdminFieldset,
  type ModelAdminConfig,
} from "./registry";
export {
  createLockService,
  DEFAULT_LOCK_TTL_SECONDS,
  lockKeyFor,
  RowLockDurableObject,
  type LockGrant,
  type LockRefusal,
  type LockService,
  type LockServiceOptions,
} from "./locks";
export { adminApiPathFor, createAdminApp, mountAdmin } from "./routes";
export type { ClangoAuthVariables } from "@clango/auth";
