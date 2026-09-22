import { api } from "@/lib/api-client";

import type { CascadePreview, ListResult, RelationOption } from "../_types";

/**
 * Query keys for list views and relation pickers.
 *
 * Everything hangs off `all` so a single `invalidateQueries({ queryKey: listKeys.all })` refreshes
 * lists, pickers and cascade previews after a write.
 */
export const listKeys = {
  all: ["rows"] as const,
  page: (key: string) => ["rows", "list", key] as const,
  row: (key: string, id: string) => ["rows", "detail", key, id] as const,
  cascade: (key: string, id: string) => ["rows", "cascade", key, id] as const,
  options: (key: string, query: string, ids: readonly string[]) =>
    ["rows", "options", key, query, ids.join(",")] as const,
};

/** Fetches a page of rows. */
export function fetchList(key: string, search: string): Promise<ListResult> {
  const query = search.length === 0 ? "" : `?${search}`;
  return api.get<ListResult>(`/${key}${query}`);
}

/** Fetches one row. */
export function fetchRow(key: string, id: string): Promise<{ data: Record<string, unknown> }> {
  return api.get<{ data: Record<string, unknown> }>(`/${key}/${encodeURIComponent(id)}`);
}

/** Fetches the cascade preview for a row. */
export function fetchCascade(key: string, id: string): Promise<{ data: CascadePreview }> {
  return api.get<{ data: CascadePreview }>(`/${key}/${encodeURIComponent(id)}/cascade`);
}

/** Looks up relation labels either by search text or by explicit ids. */
export function fetchOptions(
  key: string,
  query = "",
  ids: readonly string[] = [],
): Promise<{ data: readonly RelationOption[] }> {
  const params = new URLSearchParams({ q: query, limit: "20" });
  if (ids.length > 0) params.set("ids", ids.join(","));
  return api.get<{ data: readonly RelationOption[] }>(`/${key}/options?${params.toString()}`);
}

/** Creates a row. */
export function createRow(key: string, body: unknown): Promise<{ data: Record<string, unknown> }> {
  return api.post<{ data: Record<string, unknown> }>(`/${key}`, body);
}

/** Updates a row. */
export function updateRow(
  key: string,
  id: string,
  body: unknown,
): Promise<{ data: Record<string, unknown> }> {
  return api.patch<{ data: Record<string, unknown> }>(`/${key}/${encodeURIComponent(id)}`, body);
}

/** Deletes a row. */
export function deleteRow(key: string, id: string): Promise<void> {
  return api.delete<void>(`/${key}/${encodeURIComponent(id)}`);
}

/** Runs a bulk action over the selected ids. */
export function runAction(
  key: string,
  name: string,
  ids: readonly string[],
): Promise<{ data: { action: string; affected: number } }> {
  return api.post<{ data: { action: string; affected: number } }>(
    `/${key}/actions/${encodeURIComponent(name)}`,
    { ids },
  );
}
