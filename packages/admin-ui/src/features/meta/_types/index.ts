/**
 * The metadata contract is owned by `@clango/core`, which is dependency-free, so the SPA and the
 * server cannot disagree about the shape the admin renders.
 */
export type {
  AdminActionMeta,
  AdminFieldMeta,
  AdminFieldsetMeta,
  AdminMeta,
  AdminModelMeta,
  AdminModelPermissions,
  AdminRelationMeta,
  AdminUser,
  AdminWidget,
} from "@clango/core";
