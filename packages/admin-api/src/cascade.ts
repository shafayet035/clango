import { columnFor, type AnyModel, type Registry } from "@clango/core";
import { quoteIdentifier } from "@clango/orm";
import type { ReferentialAction } from "@clango/core";

/** One group of related rows a delete would also affect. */
export interface CascadeEntry {
  /** Qualified name of the affected model, for example `blog.Post`. */
  readonly model: string;
  /** Field on the affected model that points at the deleted row. */
  readonly field: string;
  readonly action: "cascade" | "set null";
  readonly count: number;
  /** `true` when counting stopped at the search budget, so `count` is a lower bound. */
  readonly capped: boolean;
  /** A few example ids, for the confirmation dialog. */
  readonly sample: readonly string[];
}

interface Edge {
  readonly model: string;
  readonly table: string;
  readonly field: string;
  readonly column: string;
  readonly action: "cascade" | "set null";
}

const MAX_BOUND_PARAMS = 90;

function actionOf(action: ReferentialAction | undefined): "cascade" | "set null" | undefined {
  if (action === "cascade") return "cascade";
  if (action === "set null") return "set null";
  return undefined;
}

/**
 * Builds the referential edges that delete a parent row would trigger.
 *
 * `RESTRICT` and `NO ACTION` are excluded: the first blocks the delete outright and the second is
 * deferred, so neither removes or rewrites child rows.
 */
export function cascadeEdges(registry: Registry): ReadonlyMap<string, readonly Edge[]> {
  const edges = new Map<string, Edge[]>();
  for (const { model } of registry.models) {
    for (const [property, field] of Object.entries(model.fields)) {
      if (field.kind !== "foreignKey") continue;
      const target: AnyModel | undefined = field.ref?.();
      if (target === undefined) continue;
      const action = actionOf((field.options as { onDelete?: ReferentialAction }).onDelete);
      if (action === undefined) continue;
      const edge: Edge = {
        model: model.name,
        table: model.tableName,
        field: property,
        column: columnFor(property),
        action,
      };
      const existing = edges.get(target.name);
      if (existing === undefined) edges.set(target.name, [edge]);
      else existing.push(edge);
    }
  }
  return edges;
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function selectRelatedIds(
  db: D1Database,
  edge: Edge,
  sourceIds: readonly string[],
  budget: number,
): Promise<{ ids: string[]; capped: boolean }> {
  const found = new Set<string>();
  let capped = false;
  for (const group of chunk(sourceIds, MAX_BOUND_PARAMS)) {
    const placeholders = group.map(() => "?").join(", ");
    const remaining = budget - found.size;
    if (remaining <= 0) {
      capped = true;
      break;
    }
    const rows = await db
      .prepare(
        `SELECT ${quoteIdentifier("id")} AS id FROM ${quoteIdentifier(edge.table)} ` +
          `WHERE ${quoteIdentifier(edge.column)} IN (${placeholders}) LIMIT ?`,
      )
      .bind(...group, remaining)
      .all<{ id: string }>();
    for (const row of rows.results) found.add(row.id);
    if (found.size >= budget) {
      capped = true;
      break;
    }
  }
  return { ids: [...found], capped };
}

/** Options accepted by {@link cascadePreview}. */
export interface CascadePreviewOptions {
  readonly registry: Registry;
  readonly db: D1Database;
  readonly model: AnyModel;
  readonly ids: readonly string[];
  /** Maximum related rows collected per model before the result is marked capped. */
  readonly budget?: number;
  /** Maximum number of related ids returned as examples. */
  readonly sampleSize?: number;
}

/**
 * Walks the referential graph to find every row a delete would cascade into or null out.
 *
 * SQLite applies `ON DELETE` actions transitively, so the walk follows each affected row's own
 * dependents. Collection is bounded per model; when the bound is reached the entry is marked
 * `capped`, which the confirmation dialog surfaces as "at least N".
 */
export async function cascadePreview(
  options: CascadePreviewOptions,
): Promise<readonly CascadeEntry[]> {
  const budget = options.budget ?? 200;
  const sampleSize = options.sampleSize ?? 3;
  const edges = cascadeEdges(options.registry);
  const results = new Map<string, { edge: Edge; ids: Set<string>; capped: boolean }>();
  const processed = new Set<string>();

  let queue: { model: string; ids: readonly string[] }[] = [
    { model: options.model.name, ids: options.ids },
  ];

  while (queue.length > 0) {
    const next: { model: string; ids: readonly string[] }[] = [];
    for (const source of queue) {
      for (const edge of edges.get(source.model) ?? []) {
        const fresh = source.ids.filter((id) => {
          const pair = `${edge.model}|${edge.field}|${id}`;
          if (processed.has(pair)) return false;
          processed.add(pair);
          return true;
        });
        if (fresh.length === 0) continue;

        const { ids, capped } = await selectRelatedIds(options.db, edge, fresh, budget);
        const key = `${edge.model}|${edge.field}`;
        let entry = results.get(key);
        if (entry === undefined) {
          entry = { edge, ids: new Set(), capped: false };
          results.set(key, entry);
        }
        for (const id of ids) entry.ids.add(id);
        entry.capped ||= capped;

        if (ids.length > 0) next.push({ model: edge.model, ids });
      }
    }
    queue = next;
  }

  return [...results.values()]
    .map((entry) => {
      const ids = [...entry.ids];
      return {
        model: entry.edge.model,
        field: entry.edge.field,
        action: entry.edge.action,
        count: ids.length,
        capped: entry.capped,
        sample: ids.slice(0, sampleSize),
      };
    })
    .sort((a, b) => a.model.localeCompare(b.model) || a.field.localeCompare(b.field));
}
