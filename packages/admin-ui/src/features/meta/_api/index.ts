import { api } from "@/lib/api-client";

import type { AdminMeta } from "../_types";

/** Query keys for the model metadata. Everything sits under one root so invalidation is prefix-based. */
export const metaKeys = {
  all: ["meta"] as const,
  root: () => ["meta", "root"] as const,
};

/** Fetches the model metadata for the admin shell. */
export function fetchMeta(): Promise<AdminMeta> {
  return api.get<AdminMeta>("/meta");
}
