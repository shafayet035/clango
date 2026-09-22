import { badRequest } from "./errors";

/**
 * Cursors are opaque to clients: base64url-encoded JSON carrying the ordering that produced the
 * page plus the sort values of the last row. Encoding the ordering means a client that changes
 * `order` between pages gets a clear error instead of a silently wrong page.
 */
export interface CursorPayload {
  /** Ordering signature, for example `["-publishedAt", "id"]`. */
  readonly order: readonly string[];
  /** Sort values of the last row, in the same order. */
  readonly values: readonly unknown[];
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
  const normalised = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised.padEnd(Math.ceil(normalised.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Encodes a cursor for the `nextCursor` field of a list response. */
export function encodeCursor(payload: CursorPayload): string {
  return toBase64Url(JSON.stringify(payload));
}

/** Decodes a cursor. Throws a `400` {@link ApiError} for anything malformed. */
export function decodeCursor(cursor: string): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(cursor));
  } catch {
    throw badRequest("The cursor is not valid.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw badRequest("The cursor is not valid.");
  }
  const candidate = parsed as { order?: unknown; values?: unknown };
  if (
    !Array.isArray(candidate.order) ||
    !candidate.order.every((entry) => typeof entry === "string") ||
    !Array.isArray(candidate.values) ||
    candidate.values.length !== candidate.order.length
  ) {
    throw badRequest("The cursor is not valid.");
  }
  return { order: candidate.order as string[], values: candidate.values as unknown[] };
}
