/** Converts arbitrary text into a lowercase, underscore-separated identifier. */
export function slugify(value: string): string {
  const slug = value
    .replace(/["'`]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return slug.length === 0 ? "migration" : slug.slice(0, 60).replace(/_+$/, "");
}

/** Formats a migration sequence number, for example `7` becomes `0007`. */
export function formatMigrationNumber(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 9999) {
    throw new RangeError(`Migration number ${value} is out of range (1-9999).`);
  }
  return String(value).padStart(4, "0");
}

/** Extracts the sequence number from `0007_add_excerpt.sql`, or `undefined`. */
export function parseMigrationNumber(fileName: string): number | undefined {
  const match = /^(\d{4})_/.exec(fileName);
  if (match === null) return undefined;
  return Number.parseInt(match[1] as string, 10);
}
