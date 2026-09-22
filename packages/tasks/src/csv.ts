/**
 * CSV encoding and decoding for import/export jobs.
 *
 * Pure and streaming-friendly: an export builds one chunk per page and an import parses a chunk at a
 * time, so neither needs the whole file in memory. RFC 4180 quoting is applied on write and honoured
 * on read, including embedded newlines.
 */

const NEEDS_QUOTING = /[",\r\n]/;

function escapeField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return NEEDS_QUOTING.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Options accepted by {@link toCsv}. */
export interface ToCsvOptions {
  /** Include the header row. Defaults to `true`; an export writes it only on the first chunk. */
  readonly header?: boolean;
}

/** Renders rows as CSV. */
export function toCsv(
  rows: readonly object[],
  columns: readonly string[],
  options: ToCsvOptions = {},
): string {
  const lines: string[] = options.header === false ? [] : [columns.map(escapeField).join(",")];
  for (const row of rows) {
    const record = row as Readonly<Record<string, unknown>>;
    lines.push(columns.map((column) => escapeField(record[column])).join(","));
  }
  return lines.length === 0 ? "" : `${lines.join("\r\n")}\r\n`;
}

/** Splits CSV text into records of raw field values. */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  let index = 0;

  while (index < text.length) {
    const character = text[index] as string;

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += character;
      index += 1;
      continue;
    }

    if (character === '"') {
      quoted = true;
      index += 1;
      continue;
    }
    if (character === ",") {
      record.push(field);
      field = "";
      index += 1;
      continue;
    }
    if (character === "\r" || character === "\n") {
      record.push(field);
      records.push(record);
      field = "";
      record = [];
      index += character === "\r" && text[index + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += character;
    index += 1;
  }

  // A trailing newline must not produce a phantom empty record.
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

/** Result of reading a CSV chunk. */
export interface CsvTable {
  readonly headers: readonly string[];
  readonly rows: readonly Readonly<Record<string, string>>[];
}

/**
 * Reads CSV text into header-keyed rows.
 *
 * Short rows are padded and extra fields are dropped, so one malformed line cannot abort an import;
 * the import job reports the count of adjusted rows instead.
 */
export function fromCsv(text: string): CsvTable {
  const records = parseCsv(text).filter((record) => record.some((value) => value.length > 0));
  const [headerRow, ...body] = records;
  if (headerRow === undefined) return { headers: [], rows: [] };

  const headers = headerRow.map((header) => header.trim());
  const rows = body.map((record) => {
    const row: Record<string, string> = {};
    for (const [position, header] of headers.entries()) row[header] = record[position] ?? "";
    return row;
  });

  return { headers, rows };
}

/** Splits text into fixed-size chunks without reading the whole file at once. */
export function chunkText(text: string, size: number): string[] {
  if (size < 1) throw new Error("Chunk size must be at least 1.");
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += size) {
    chunks.push(text.slice(start, start + size));
  }
  return chunks.length === 0 ? [""] : chunks;
}
