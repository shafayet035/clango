import type { AnyModel } from "./model";
import { toSnakeCase } from "./naming";

/**
 * Authentication and authorization contracts.
 *
 * The identity provider answers "who is this?" through an {@link AuthAdapter}. Everything about
 * "what may they do?" — staff flags, groups and permissions — belongs to Clango and lives in D1, so
 * swapping providers never touches authorization (D-003).
 */

/**
 * An authenticated identity as reported by the provider.
 *
 * Deliberately minimal: only the provider can know who someone is, so it is the only thing it is
 * asked for. Staff flags, groups and permissions are read from Clango's own tables (D-003), which
 * means a provider can never grant itself authority.
 */
export interface AuthIdentity {
  /** Stable identifier from the identity provider. */
  readonly id: string;
  readonly email: string;
}

/** A resolved Clango user, with the authorization facts Clango owns. */
export interface ClangoUser {
  /** Stable identifier from the identity provider. */
  readonly id: string;
  readonly email: string;
  /** Reaches the admin at all. */
  readonly isStaff: boolean;
  /** Holds every permission implicitly. */
  readonly isSuperuser: boolean;
}

/** Resolves the caller's identity and, optionally, mounts the provider's own routes. */
export interface AuthAdapter {
  /** Returns the caller's identity, or `null` when the request is anonymous. */
  getUser(request: Request, env: object): Promise<AuthIdentity | null>;
  /** Path prefix for {@link AuthAdapter.handler}, for example `/api/auth`. */
  readonly basePath?: string;
  /**
   * Handles the provider's own endpoints (sign-in, callbacks, sign-out). Return `null` to let the
   * request continue to the rest of the application.
   */
  handler?(request: Request, env: object): Promise<Response | null>;
}

/** The four operations every model gets permissions for. */
export const PERMISSION_ACTIONS = ["view", "add", "change", "delete"] as const;

/** One of the four automatic permission actions. */
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/** A permission identifier, for example `blog.change_post`. */
export type PermissionCodename = string;

/** Slug used for a model inside permission codenames, for example `post` in `blog.view_post`. */
export function permissionSubject(model: AnyModel): string {
  return toSnakeCase(model.modelName);
}

/** Codename for one action on one model, for example `blog.change_post`. */
export function permissionCodename(model: AnyModel, action: PermissionAction): PermissionCodename {
  return `${model.appLabel}.${action}_${permissionSubject(model)}`;
}

/** Every codename a model contributes to the permission catalogue. */
export function modelPermissions(model: AnyModel): readonly PermissionCodename[] {
  return PERMISSION_ACTIONS.map((action) => permissionCodename(model, action));
}
