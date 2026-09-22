/**
 * Clango's authorization layer: it turns an authenticated identity into permissions and exposes the
 * middleware that gates the admin and the API.
 *
 * Identity belongs to the configured {@link AuthAdapter}; staff flags, groups and permissions live in
 * Clango's own tables so the provider can be swapped without touching authorization (D-003).
 */

export { Authorization, can, canAny, type AuthorizedUser } from "./authorization";
export {
  clangoAuth,
  mountAuth,
  requirePermission,
  requireStaff,
  type AuthMiddlewareOptions,
  type ClangoAuthVariables,
} from "./middleware";
