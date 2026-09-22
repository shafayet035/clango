import { newUlid, type AdminLogAction } from "@clango/core";

/** One audit record, ready to be inserted into the admin log. */
export interface AdminLogInput {
  readonly action: AdminLogAction;
  readonly modelName: string;
  readonly objectId: string;
  readonly userId: string | null;
  readonly diff: Record<string, unknown> | null;
}

/** Values for an `clango_admin_log` insert. */
export function adminLogValues(input: AdminLogInput, now: Date): Record<string, unknown> {
  return {
    id: newUlid(),
    createdAt: now,
    updatedAt: now,
    action: input.action,
    modelName: input.modelName,
    objectId: input.objectId,
    userId: input.userId,
    diff: input.diff,
  };
}

function canonical(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/**
 * Field-by-field diff for an update, limited to the fields the request actually supplied.
 *
 * Returns `null` when nothing changed, so a no-op save does not produce a misleading log entry.
 */
export function buildUpdateDiff(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
  properties: readonly string[],
): Record<string, { from: unknown; to: unknown }> | null {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const property of properties) {
    if (!(property in patch)) continue;
    const from = before[property] ?? null;
    const to = patch[property] ?? null;
    if (canonical(from) !== canonical(to)) diff[property] = { from, to };
  }
  return Object.keys(diff).length === 0 ? null : diff;
}
