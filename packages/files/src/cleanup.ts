import { newUlid, type AnyModel, type Registry } from "@clango/core";
import type { DatabaseSchema } from "@clango/orm";
import { eq, getTableColumns } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { z } from "zod";

import { defineTask, taskByName, type TaskDefinition } from "@clango/tasks";

import { fileFieldsOf, modelPrefixFor } from "./keys";
import type { FileStorage } from "./storage";

/**
 * File cleanup.
 *
 * Deleting a record leaves its objects behind, and a presigned upload that never became a record
 * leaves objects that were never referenced at all. Both are cleaned up by the same task, which
 * takes keys — so the delete path and the orphan sweep share one code path.
 */

/** Name of the task that removes objects from R2. */
export const FILE_CLEANUP_TASK = "clango.cleanup_files";

/** Payload accepted by the cleanup task. */
export const cleanupPayload = z.object({
  keys: z.array(z.string().min(1)).min(1).max(500),
});

/** Type of {@link cleanupPayload}. */
export type CleanupPayload = z.infer<typeof cleanupPayload>;

/** Builds storage from an environment. Supplied by the caller so this package holds no config. */
export type StorageFactory = (env: object) => FileStorage;

/**
 * Registers the cleanup task once.
 *
 * Registration is lazy because the task must exist without the application having to import a
 * side-effect module, and idempotent so several callers can ask for it.
 */
export function ensureFileCleanupTask(storage: StorageFactory): TaskDefinition<CleanupPayload> {
  const existing = taskByName(FILE_CLEANUP_TASK);
  if (existing !== undefined) return existing as unknown as TaskDefinition<CleanupPayload>;

  return defineTask(
    FILE_CLEANUP_TASK,
    cleanupPayload,
    async (payload, context) => {
      await storage(context.env).delete(payload.keys);
    },
    { retryDelaySeconds: 300 },
  );
}

/** Returns the file keys a row references. */
export function fileKeysIn(
  model: AnyModel,
  row: Readonly<Record<string, unknown>>,
): readonly string[] {
  const keys: string[] = [];
  for (const property of fileFieldsOf(model)) {
    const value = row[property];
    if (typeof value === "string" && value.length > 0) keys.push(value);
  }
  return keys;
}

/** The unreferenced objects found for one model. */
export interface OrphanGroup {
  readonly model: string;
  readonly keys: readonly string[];
}

/** Options accepted by {@link sweepOrphans}. */
export interface SweepOptions {
  readonly registry: Registry;
  readonly schema: DatabaseSchema;
  readonly db: DrizzleD1Database;
  readonly storage: FileStorage;
  /** Limits the sweep to one model. Defaults to every model with file fields. */
  readonly model?: AnyModel;
  /** Maximum keys returned per model. */
  readonly limit?: number;
  /**
   * Ignores objects uploaded more recently than this, in milliseconds.
   *
   * A presigned URL hands the client a key before the record exists, so a sweep that did not wait
   * would delete uploads that are still in flight. Defaults to one hour.
   */
  readonly olderThanMs?: number;
}

async function isReferenced(options: SweepOptions, model: AnyModel, key: string): Promise<boolean> {
  const prefix = modelPrefixFor(model);
  const remainder = key.slice(prefix.length);
  const recordId = remainder.slice(0, remainder.indexOf("/"));
  if (recordId.length === 0) return true;

  const table = options.schema.table(model.name);
  const columns = getTableColumns(table) as unknown as Record<string, SQLiteColumn>;
  const rows = await options.db
    .select()
    .from(table)
    .where(eq(columns["id"] as SQLiteColumn, recordId))
    .limit(1)
    .all();
  return rows.length > 0;
}

/**
 * Finds uploaded objects no record references.
 *
 * Only models that have file fields are swept, and only their own prefix, so unrelated objects in
 * the bucket are never touched.
 */
export async function sweepOrphans(options: SweepOptions): Promise<readonly OrphanGroup[]> {
  const cutoff = Date.now() - (options.olderThanMs ?? 3_600_000);
  const models =
    options.model === undefined
      ? options.registry.models
          .map((entry) => entry.model)
          .filter((model) => fileFieldsOf(model).length > 0)
      : [options.model];

  const groups: OrphanGroup[] = [];

  for (const model of models) {
    const keys = await options.storage.orphans(
      modelPrefixFor(model),
      async (key, uploaded) =>
        uploaded.getTime() >= cutoff || (await isReferenced(options, model, key)),
      options.limit === undefined ? {} : { limit: options.limit },
    );
    if (keys.length > 0) groups.push({ model: model.name, keys });
  }

  return groups;
}

/** Generates a record id for an upload that arrives before the record is saved. */
export function newUploadRecordId(): string {
  return newUlid();
}
