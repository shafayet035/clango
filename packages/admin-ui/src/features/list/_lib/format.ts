import type { AdminFieldMeta } from "@/features/meta/_types";

/** One entry of a list `order` query parameter. */
export interface OrderEntry {
  readonly property: string;
  readonly direction: "asc" | "desc";
}

/** Parses `-publishedAt,title` into entries. */
export function parseOrder(order: string): readonly OrderEntry[] {
  return order
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) =>
      entry.startsWith("-")
        ? { property: entry.slice(1), direction: "desc" as const }
        : { property: entry, direction: "asc" as const },
    );
}

/** Serialises entries back into an `order` parameter. */
export function formatOrder(entries: readonly OrderEntry[]): string {
  return entries
    .map((entry) => `${entry.direction === "desc" ? "-" : ""}${entry.property}`)
    .join(",");
}

/**
 * Makes a column the primary sort key, toggling its direction when it already is.
 *
 * The rule is deliberately simple to predict: a column that is not primary becomes ascending, a
 * primary ascending column becomes descending, and a primary descending column becomes ascending
 * again. Columns that are not clicked keep their relative order as tie breakers.
 */
export function toggleOrder(order: string, property: string): string {
  const entries = parseOrder(order);
  const primary = entries[0];
  const flip = primary?.property === property && primary.direction === "asc";
  const rest = entries.filter((entry) => entry.property !== property);
  return formatOrder([{ property, direction: flip ? "desc" : "asc" }, ...rest]);
}

/** The direction arrow shown in a sortable header. */
export function orderMarker(order: string, property: string): string {
  const entry = parseOrder(order).find((candidate) => candidate.property === property);
  if (entry === undefined) return "";
  return entry.direction === "desc" ? "↓" : "↑";
}

/** Renders a cell value for the list view. */
export function formatCell(
  field: AdminFieldMeta | undefined,
  value: unknown,
  labels: ReadonlyMap<string, string>,
): string {
  if (value === null || value === undefined) return "—";
  if (field?.widget === "relation") return labels.get(String(value)) ?? String(value);
  if (field?.widget === "checkbox") return value === true ? "yes" : "no";
  if (field?.widget === "datetime") {
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime())
      ? String(value)
      : date.toISOString().replace("T", " ").slice(0, 16);
  }
  if (field?.widget === "json") return JSON.stringify(value);
  return String(value);
}

/** Builds the list query string from the current URL parameters. */
export function listQueryString(
  params: URLSearchParams,
  limit: number,
  cursor: string | null,
): string {
  const next = new URLSearchParams(params);
  next.set("limit", String(limit));
  if (cursor === null) next.delete("cursor");
  else next.set("cursor", cursor);
  return next.toString();
}
