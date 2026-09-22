import { describe, expect, it } from "vitest";

import { buildSuperuserSql } from "../src/createsuperuser";
import { formatMigrationNumber, parseMigrationNumber, slugify } from "../src/slug";

describe("slugify", () => {
  it("converts summaries into file-name friendly slugs", () => {
    expect(slugify('Create table "blog_author"')).toBe("create_table_blog_author");
    expect(slugify("Add column blog_post.excerpt")).toBe("add_column_blog_post_excerpt");
    expect(slugify("  spaced   out  ")).toBe("spaced_out");
  });

  it("falls back when nothing usable remains", () => {
    expect(slugify("!!!")).toBe("migration");
    expect(slugify("")).toBe("migration");
  });

  it("caps long names", () => {
    expect(slugify("x".repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe("formatMigrationNumber", () => {
  it("pads to four digits", () => {
    expect(formatMigrationNumber(1)).toBe("0001");
    expect(formatMigrationNumber(42)).toBe("0042");
  });

  it("rejects out-of-range numbers", () => {
    expect(() => formatMigrationNumber(0)).toThrow(RangeError);
    expect(() => formatMigrationNumber(10_000)).toThrow(RangeError);
    expect(() => formatMigrationNumber(1.5)).toThrow(RangeError);
  });
});

describe("parseMigrationNumber", () => {
  it("reads the prefix", () => {
    expect(parseMigrationNumber("0007_add_excerpt.sql")).toBe(7);
  });

  it("ignores files without a prefix", () => {
    expect(parseMigrationNumber("_snapshot.json")).toBeUndefined();
    expect(parseMigrationNumber("initial.sql")).toBeUndefined();
  });
});

describe("buildSuperuserSql", () => {
  const options = {
    table: "clango_user",
    id: "01H",
    email: "ada@example.com",
    now: new Date(1_700_000_000_000),
  };

  it("inserts staff and superuser flags", () => {
    const sql = buildSuperuserSql(options);
    expect(sql).toContain('INSERT INTO "clango_user"');
    expect(sql).toContain('"is_staff", "is_superuser") VALUES');
    expect(sql).toContain("1700000000000");
    expect(sql).toContain("1, 1)");
  });

  it("upserts on the email so re-running is safe", () => {
    expect(buildSuperuserSql(options)).toContain(
      'ON CONFLICT("email") DO UPDATE SET "is_staff" = 1, "is_superuser" = 1',
    );
  });

  it("escapes quotes in the email", () => {
    const sql = buildSuperuserSql({ ...options, email: "o'brien@example.com" });
    expect(sql).toContain("'o''brien@example.com'");
  });
});
