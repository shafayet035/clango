import { toCsv, fromCsv } from "./csv";

/**
 * CSV import and export pipelines.
 *
 * A Workflow step must be retryable and bounded, so these helpers never hold a whole table: they
 * pull one page at a time, hand each page to a writer, and report progress. The same shape works for
 * an export to R2 and for an import that validates a page at a time.
 */

/** One page of rows, plus how to get the next one. */
export interface Page<T> {
  readonly rows: readonly T[];
  /** Opaque cursor for the next page, or `null` when this was the last one. */
  readonly nextCursor: string | null;
}

/** Options accepted by {@link exportCsv}. */
export interface ExportOptions<T> {
  /** Columns to write, in order. */
  readonly columns: readonly string[];
  /** Loads one page. Receives `null` for the first page. */
  readonly fetchPage: (cursor: string | null) => Promise<Page<T>>;
  /** Receives each chunk of CSV as it is produced. */
  readonly write: (chunk: string, page: number) => Promise<void>;
  /** Called after each page, so a Workflow can report progress. */
  readonly onProgress?: (exported: number, page: number) => Promise<void> | void;
}

/** Summary of an export run. */
export interface ExportResult {
  readonly rows: number;
  readonly pages: number;
}

/**
 * Streams a table to CSV.
 *
 * Only the first chunk carries the header, and the header is written even when the table is empty, so
 * the result is always a parsable file rather than a zero-byte object. Each page is handed to
 * `write` as it arrives, so a Workflow step never holds the whole table.
 */
export async function exportCsv<T extends object>(
  options: ExportOptions<T>,
): Promise<ExportResult> {
  let cursor: string | null = null;
  let page = 0;
  let rows = 0;

  do {
    const current = await options.fetchPage(cursor);
    await options.write(toCsv(current.rows, options.columns, { header: page === 0 }), page);
    rows += current.rows.length;
    page += 1;
    await options.onProgress?.(rows, page);
    cursor = current.nextCursor;
    // An empty page with a cursor would loop forever; stop instead.
    if (current.rows.length === 0) break;
  } while (cursor !== null);

  return { rows, pages: page };
}

/** A row that failed validation during an import. */
export interface ImportFailure {
  /** 1-based index within the file, header excluded. */
  readonly line: number;
  readonly message: string;
}

/** Options accepted by {@link importCsv}. */
export interface ImportOptions<T> {
  /** Parses and validates one row. Throw to reject it. */
  readonly parse: (row: Readonly<Record<string, string>>, line: number) => T;
  /** Receives each accepted batch. */
  readonly handle: (rows: readonly T[], batch: number) => Promise<void>;
  /** Rows per batch handed to `handle`. Defaults to 500. */
  readonly batchSize?: number;
  /** Stops after this many failures. Defaults to 100. */
  readonly maxFailures?: number;
}

/** Summary of an import run. */
export interface ImportResult {
  readonly imported: number;
  readonly failures: readonly ImportFailure[];
}

/**
 * Validates and applies CSV rows in bounded batches.
 *
 * Bad rows are collected rather than thrown, so one malformed line does not abandon an otherwise
 * good file; the caller decides what to do with the report. The run stops early once `maxFailures`
 * is reached, which keeps a systematically broken file from filling memory with errors.
 */
export async function importCsv<T>(text: string, options: ImportOptions<T>): Promise<ImportResult> {
  const table = fromCsv(text);
  const maxFailures = options.maxFailures ?? 100;
  const batchSize = options.batchSize ?? 500;
  const failures: ImportFailure[] = [];
  const accepted: T[] = [];

  for (const [index, row] of table.rows.entries()) {
    try {
      accepted.push(options.parse(row, index + 1));
    } catch (cause) {
      failures.push({
        line: index + 1,
        message: cause instanceof Error ? cause.message : String(cause),
      });
      if (failures.length >= maxFailures) break;
    }
  }

  let imported = 0;
  let batch = 0;
  for (let start = 0; start < accepted.length; start += batchSize) {
    const slice = accepted.slice(start, start + batchSize);
    await options.handle(slice, batch);
    imported += slice.length;
    batch += 1;
  }

  return { imported, failures };
}
