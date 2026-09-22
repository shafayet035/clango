const BASE = "/admin/api";

/** An error returned by the admin API, carrying the server's error code and field details. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text.length === 0 ? null : JSON.parse(text);
  } catch {
    // Leave `parsed` null: the response was not JSON, which only matters for the error path below.
  }

  if (!response.ok) {
    const error = (parsed as ErrorBody | null)?.error;
    throw new ApiError(
      error?.message ?? response.statusText,
      response.status,
      error?.code ?? "error",
      error?.details,
    );
  }

  return parsed as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
