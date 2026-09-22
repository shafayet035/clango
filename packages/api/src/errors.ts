/**
 * Error handling shared by every generated route. Errors are always JSON so clients can rely on the
 * response shape regardless of which layer failed.
 */

/** An error with an intentional HTTP status. Thrown by the API layer and mapped to a response. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The JSON body returned for every failed request. */
export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };
}

interface ErrorMapping {
  readonly pattern: RegExp;
  readonly status: number;
  readonly code: string;
}

const DATABASE_ERRORS: readonly ErrorMapping[] = [
  { pattern: /UNIQUE constraint failed: ([^\s]+)/i, status: 409, code: "conflict" },
  { pattern: /FOREIGN KEY constraint failed/i, status: 400, code: "invalid_reference" },
  { pattern: /NOT NULL constraint failed: ([^\s]+)/i, status: 400, code: "missing_field" },
  { pattern: /CHECK constraint failed: ([^\s]+)/i, status: 400, code: "invalid_value" },
];

/**
 * Walks the `cause` chain looking for a database error.
 *
 * Drizzle wraps driver failures in `DrizzleQueryError`, so the SQLite message lands on a nested
 * `cause` rather than the error the route sees.
 */
function databaseError(
  error: unknown,
): { status: number; code: string; message: string } | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    for (const mapping of DATABASE_ERRORS) {
      const match = mapping.pattern.exec(current.message);
      if (match === null) continue;
      const column = match[1];
      const code =
        mapping.code === "conflict" && column !== undefined
          ? `${mapping.code}:${column}`
          : mapping.code;
      return { status: mapping.status, code, message: current.message };
    }
    current = current.cause;
  }
  return undefined;
}

function body(code: string, message: string, details?: unknown): ApiErrorBody {
  return details === undefined
    ? { error: { code, message } }
    : { error: { code, message, details } };
}

/** Converts any thrown value into a JSON error response. */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json(body(error.code, error.message, error.details), { status: error.status });
  }

  if (error instanceof Error) {
    const mapped = databaseError(error);
    if (mapped !== undefined) {
      return Response.json(body(mapped.code, mapped.message), { status: mapped.status });
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  return Response.json(body("internal_error", message), { status: 500 });
}

/** `400` for a malformed request. */
export function badRequest(message: string, details?: unknown): ApiError {
  return new ApiError(400, "bad_request", message, details);
}

/** `400` for a body that failed validation. */
export function validationFailed(details: unknown): ApiError {
  return new ApiError(400, "validation_error", "The request body is invalid.", details);
}

/** `404` for a missing row. */
export function notFound(model: string, id: string): ApiError {
  return new ApiError(404, "not_found", `No ${model} with id "${id}".`);
}
