import { describe, expect, it } from "vitest";

import {
  CliUsageError,
  DEFAULT_CONFIG_PATH,
  DEFAULT_MIGRATIONS_DIR,
  parseArgs,
  renderHelp,
} from "../src/args";

describe("parseArgs", () => {
  it("defaults to help with no arguments", () => {
    expect(parseArgs([]).command).toBe("help");
  });

  it("parses makemigrations with defaults", () => {
    const parsed = parseArgs(["makemigrations"]);
    expect(parsed.command).toBe("makemigrations");
    expect(parsed.options).toEqual({
      config: DEFAULT_CONFIG_PATH,
      allowDestructive: false,
      target: "default",
      databases: [],
      migrationsDir: DEFAULT_MIGRATIONS_DIR,
    });
  });

  it("parses migrate targets", () => {
    expect(parseArgs(["migrate", "--local"]).options.target).toBe("local");
    expect(parseArgs(["migrate", "--remote"]).options.target).toBe("remote");
  });

  it("parses flags with values", () => {
    const parsed = parseArgs([
      "makemigrations",
      "--config",
      "config/clango.config.ts",
      "--name",
      "add excerpt",
      "--migrations-dir",
      "db/migrations",
    ]);
    expect(parsed.options.config).toBe("config/clango.config.ts");
    expect(parsed.options.name).toBe("add excerpt");
    expect(parsed.options.migrationsDir).toBe("db/migrations");
  });

  it("collects repeated --database flags", () => {
    const parsed = parseArgs(["migrate", "--database", "DB_MAIN", "--database", "DB_AUDIT"]);
    expect(parsed.options.databases).toEqual(["DB_MAIN", "DB_AUDIT"]);
  });

  it("parses --allow-destructive", () => {
    expect(parseArgs(["makemigrations", "--allow-destructive"]).options.allowDestructive).toBe(
      true,
    );
  });

  it("recognises help and version", () => {
    expect(parseArgs(["--help"]).command).toBe("help");
    expect(parseArgs(["-h"]).command).toBe("help");
    expect(parseArgs(["--version"]).command).toBe("version");
    expect(parseArgs(["-v"]).command).toBe("version");
  });

  it("rejects an unknown command", () => {
    expect(() => parseArgs(["deploy"])).toThrow(CliUsageError);
  });

  it("rejects an unknown flag", () => {
    expect(() => parseArgs(["migrate", "--force"])).toThrow(CliUsageError);
  });

  it("rejects a flag without a value", () => {
    expect(() => parseArgs(["migrate", "--config"])).toThrow(CliUsageError);
  });

  it("rejects two commands", () => {
    expect(() => parseArgs(["migrate", "makemigrations"])).toThrow(CliUsageError);
  });

  it("rejects --local for makemigrations", () => {
    expect(() => parseArgs(["makemigrations", "--local"])).toThrow(CliUsageError);
  });
});

describe("renderHelp", () => {
  it("mentions both commands and the version", () => {
    const help = renderHelp("1.2.3");
    expect(help).toContain("clango 1.2.3");
    expect(help).toContain("makemigrations");
    expect(help).toContain("migrate");
    expect(help).toContain("--allow-destructive");
  });
});
