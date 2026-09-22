import type { AdminModelMeta } from "../../meta/_types";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import { fetchOptions, listKeys } from "../_api";
import { modelKeyOf, relationFields } from "../../models/_lib/model";

/**
 * Resolves relation columns on the current page to human labels.
 *
 * One lookup per related model rather than per row: the list endpoint returns ids, and `/options`
 * accepts a batch of them, so a page of 25 rows costs at most one request per relation column.
 */
export function useRelationLabels(
  model: AdminModelMeta,
  rows: readonly Record<string, unknown>[],
): ReadonlyMap<string, string> {
  const requests = useMemo(() => {
    const byTarget = new Map<string, string[]>();
    for (const field of relationFields(model)) {
      const target = field.related === undefined ? undefined : modelKeyOf(field.related.model);
      if (target === undefined) continue;
      const ids = rows
        .map((row) => row[field.name])
        .filter((value): value is string => typeof value === "string" && value.length > 0);
      if (ids.length === 0) continue;
      const existing = byTarget.get(target) ?? [];
      byTarget.set(target, [...new Set([...existing, ...ids])]);
    }
    return [...byTarget.entries()];
  }, [model, rows]);

  const results = useQueries({
    queries: requests.map(([target, ids]) => ({
      queryKey: listKeys.options(target, "", ids),
      queryFn: () => fetchOptions(target, "", ids),
      enabled: ids.length > 0,
    })),
  });

  const labels = new Map<string, string>();
  for (const result of results) {
    for (const option of result.data?.data ?? []) labels.set(option.id, option.label);
  }
  return labels;
}
