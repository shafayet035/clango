import { describe, expect, it } from "vitest";

import { chunkText, fromCsv, parseCsv, toCsv } from "../src/index";

describe("toCsv", () => {
  it("writes a header and rows", () => {
    const csv = toCsv([{ id: "p1", title: "Hello" }], ["id", "title"]);
    expect(csv).toBe("id,title\r\np1,Hello\r\n");
  });

  it("quotes fields containing separators, quotes or newlines", () => {
    const csv = toCsv(
      [{ note: "a,b", quote: 'say "hi"', multi: "one\ntwo" }],
      ["note", "quote", "multi"],
    );
    expect(csv).toBe('note,quote,multi\r\n"a,b","say ""hi""","one\ntwo"\r\n');
  });

  it("renders null and undefined as empty fields", () => {
    expect(toCsv([{ a: null, b: undefined }], ["a", "b"])).toBe("a,b\r\n,\r\n");
  });

  it("renders timestamps as ISO strings and objects as JSON", () => {
    const csv = toCsv(
      [{ at: new Date("2026-09-22T10:00:00.000Z"), meta: { tags: ["a"] } }],
      ["at", "meta"],
    );
    expect(csv).toBe('at,meta\r\n2026-09-22T10:00:00.000Z,"{""tags"":[""a""]}"\r\n');
  });
});

describe("parseCsv", () => {
  it("reads plain records", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("reads quoted fields with separators, quotes and newlines", () => {
    expect(parseCsv('"a,b","say ""hi""","one\ntwo"\r\n')).toEqual([
      ["a,b", 'say "hi"', "one\ntwo"],
    ]);
  });

  it("handles LF-only and missing trailing newlines", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("does not emit a phantom row for a trailing newline", () => {
    expect(parseCsv("a\r\n")).toEqual([["a"]]);
  });

  it("round-trips through toCsv", () => {
    const rows = [
      { id: "p1", title: "a,b" },
      { id: "p2", title: 'quote " and\nnewline' },
    ];
    const table = fromCsv(toCsv(rows, ["id", "title"]));
    expect(table.headers).toEqual(["id", "title"]);
    expect(table.rows).toEqual(rows);
  });
});

describe("fromCsv", () => {
  it("keys rows by header", () => {
    const table = fromCsv("id,title\r\np1,Hello\r\n");
    expect(table.rows).toEqual([{ id: "p1", title: "Hello" }]);
  });

  it("trims headers and pads short rows", () => {
    const table = fromCsv(" id , title \r\np1\r\n");
    expect(table.headers).toEqual(["id", "title"]);
    expect(table.rows).toEqual([{ id: "p1", title: "" }]);
  });

  it("returns nothing for empty input", () => {
    expect(fromCsv("")).toEqual({ headers: [], rows: [] });
  });
});

describe("chunkText", () => {
  it("splits into fixed-size chunks", () => {
    expect(chunkText("abcdefg", 3)).toEqual(["abc", "def", "g"]);
  });

  it("returns one empty chunk for empty input", () => {
    expect(chunkText("", 10)).toEqual([""]);
  });

  it("rejects a non-positive size", () => {
    expect(() => chunkText("abc", 0)).toThrow();
  });
});
