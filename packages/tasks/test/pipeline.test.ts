import { describe, expect, it } from "vitest";

import { exportCsv, importCsv, type Page } from "../src/index";

interface Row {
  readonly id: string;
  readonly title: string;
}

/** A paged source that yields `rows` in chunks, mimicking the API's cursor pagination. */
function source(rows: readonly Row[], size: number): (cursor: string | null) => Promise<Page<Row>> {
  return async (cursor) => {
    const start = cursor === null ? 0 : Number(cursor);
    const page = rows.slice(start, start + size);
    const next = start + size < rows.length ? String(start + size) : null;
    return { rows: page, nextCursor: next };
  };
}

describe("exportCsv", () => {
  it("writes the header once and every row", async () => {
    const chunks: string[] = [];
    const result = await exportCsv<Row>({
      columns: ["id", "title"],
      fetchPage: source(
        [
          { id: "1", title: "One" },
          { id: "2", title: "Two" },
          { id: "3", title: "Three" },
        ],
        2,
      ),
      write: async (chunk) => {
        chunks.push(chunk);
      },
    });

    expect(result).toEqual({ rows: 3, pages: 2 });
    expect(chunks[0]).toBe("id,title\r\n1,One\r\n2,Two\r\n");
    expect(chunks[1]).toBe("3,Three\r\n");
    expect(chunks.join("")).toBe("id,title\r\n1,One\r\n2,Two\r\n3,Three\r\n");
  });

  it("still writes a header for an empty table", async () => {
    const chunks: string[] = [];
    const result = await exportCsv<Row>({
      columns: ["id", "title"],
      fetchPage: source([], 10),
      write: async (chunk) => {
        chunks.push(chunk);
      },
    });
    expect(result.rows).toBe(0);
    expect(chunks).toEqual(["id,title\r\n"]);
  });

  it("reports progress per page", async () => {
    const progress: number[] = [];
    await exportCsv<Row>({
      columns: ["id"],
      fetchPage: source(
        [
          { id: "1", title: "a" },
          { id: "2", title: "b" },
          { id: "3", title: "c" },
        ],
        2,
      ),
      write: async () => {},
      onProgress: (exported) => {
        progress.push(exported);
      },
    });
    expect(progress).toEqual([2, 3]);
  });
});

describe("importCsv", () => {
  const parse = (row: Readonly<Record<string, string>>, line: number): Row => {
    if ((row["id"] ?? "").length === 0) throw new Error(`line ${line}: missing id`);
    return { id: row["id"] as string, title: row["title"] ?? "" };
  };

  it("applies accepted rows in batches", async () => {
    const batches: Row[][] = [];
    const result = await importCsv("id,title\r\n1,One\r\n2,Two\r\n3,Three\r\n", {
      parse,
      batchSize: 2,
      handle: async (rows) => {
        batches.push([...rows]);
      },
    });

    expect(result.imported).toBe(3);
    expect(result.failures).toEqual([]);
    expect(batches).toEqual([
      [
        { id: "1", title: "One" },
        { id: "2", title: "Two" },
      ],
      [{ id: "3", title: "Three" }],
    ]);
  });

  it("reports bad rows instead of abandoning the file", async () => {
    const result = await importCsv("id,title\r\n1,One\r\n,Missing\r\n3,Three\r\n", {
      parse,
      handle: async () => {},
    });
    expect(result.imported).toBe(2);
    expect(result.failures).toEqual([{ line: 2, message: "line 2: missing id" }]);
  });

  it("skips blank lines rather than reporting them", async () => {
    const result = await importCsv("id,title\r\n1,One\r\n\r\n2,Two\r\n", {
      parse,
      handle: async () => {},
    });
    expect(result.imported).toBe(2);
    expect(result.failures).toEqual([]);
  });

  it("stops once the failure budget is reached", async () => {
    const strict = (row: Readonly<Record<string, string>>, line: number): Row => {
      const id = row["id"] ?? "";
      if (!/^\d+$/.test(id)) throw new Error(`line ${line}: id must be numeric`);
      return { id, title: row["title"] ?? "" };
    };
    const result = await importCsv("id\r\na\r\nb\r\nc\r\n1\r\n", {
      parse: strict,
      maxFailures: 2,
      handle: async () => {},
    });
    // The budget is reached before the file ends, so the run stops: imported is 0 and the caller
    // sees two failures and a truncated file rather than a partial import it might trust.
    expect(result.failures).toHaveLength(2);
    expect(result.imported).toBe(0);
  });

  it("handles an empty file", async () => {
    const result = await importCsv("", { parse, handle: async () => {} });
    expect(result).toEqual({ imported: 0, failures: [] });
  });
});
