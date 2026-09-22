/**
 * Clango's generated REST API: one set of CRUD routes per model that opts in with
 * `api: { enabled: true }` in `defineModel`.
 *
 * Routes are mounted onto a Hono app by {@link mountApi}, or built standalone with
 * {@link createApiApp}. Input is validated with a Zod schema generated from the model definition,
 * lists use keyset pagination with bounded counts, and full-text search goes through the model's
 * FTS5 index.
 */

export { decodeCursor, encodeCursor, type CursorPayload } from "./cursor";
export {
  ApiError,
  badRequest,
  notFound,
  toErrorResponse,
  validationFailed,
  type ApiErrorBody,
} from "./errors";
export {
  buildMatchExpression,
  COUNT_CAP,
  DEFAULT_LIMIT,
  keysetCondition,
  listRows,
  MAX_LIMIT,
  orderSignature,
  toDriverValue,
  type FilterOp,
  type ListOptions,
  type ListPage,
  type ListResult,
  type OrderKey,
} from "./query";
export { apiPathFor, createApiApp, installFallbacks, mountApi, readJsonBody } from "./routes";
export { buildValidation, type ValidationSchemas } from "./validation";
