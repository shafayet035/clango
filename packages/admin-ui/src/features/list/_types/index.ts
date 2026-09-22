/** Shapes the admin SPA reads from `/admin/api`. */

/** Pagination metadata returned by the admin list endpoint. */
export interface PageInfo {
  readonly count: number;
  readonly countCapped: boolean;
  readonly limit: number;
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

/** A page of rows. */
export interface ListResult {
  readonly data: readonly Record<string, unknown>[];
  readonly page: PageInfo;
}

/** One group of related rows a delete would also affect. */
export interface CascadeEntry {
  readonly model: string;
  readonly field: string;
  readonly action: "cascade" | "set null";
  readonly count: number;
  readonly capped: boolean;
  readonly sample: readonly string[];
}

/** The cascade preview for a row. */
export interface CascadePreview {
  readonly model: string;
  readonly id: string;
  readonly related: readonly CascadeEntry[];
}

/** A relation picker option. */
export interface RelationOption {
  readonly id: string;
  readonly label: string;
}
