import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { collectDatabases, collectRegistry, type ClangoConfig, type Registry } from "@clango/core";
import {
  buildSnapshot,
  emptySnapshot,
  parseSnapshot,
  planMigration,
  renderMigrationFile,
  serializeSnapshot,
  type SchemaSnapshot,
} from "@clango/migrate";

import { CliUsageError, type CliOptions } from "./args";
import { loadConfig } from "./load-config";
import { formatMigrationNumber, parseMigrationNumber, slugify } from "./slug";

/** Snapshot file kept next to the generated migrations. */
export const SNAPSHOT_FILE = "_snapshot.json";

/** Outcome of a `makemigrations` run. */
export interface MakemigrationsResult {
  readonly written: readonly string[];
  readonly skipped: readonly string[];
}

function registryForDatabase(registry: Registry, database: string): Registry {
  const models = registry.models.filter((entry) => entry.database === database);
  const byName = new Map(models.map((entry) => [entry.model.name, entry]));
  return { models, byName };
}

function readSnapshot(path: string): SchemaSnapshot {
  if (!existsSync(path)) return emptySnapshot();
  return parseSnapshot(readFileSync(path, "utf8"));
}

function nextMigrationNumber(directory: string): number {
  if (!existsSync(directory)) return 1;
  let highest = 0;
  for (const entry of readdirSync(directory)) {
    const number = parseMigrationNumber(entry);
    if (number !== undefined && number > highest) highest = number;
  }
  return highest + 1;
}

function defaultName(summary: readonly string[]): string {
  const first = summary[0] ?? "migration";
  return slugify(first.length > 0 ? first : "migration");
}

/**
 * Diffs the project's models against the stored snapshots and writes one SQL file per database that
 * changed. Destructive changes are refused unless `--allow-destructive` was passed.
 */
export async function runMakemigrations(
  options: CliOptions,
  cwd: string,
  log: (message: string) => void = () => {},
): Promise<MakemigrationsResult> {
  const config: ClangoConfig = await loadConfig(options.config, cwd, log);
  const registry = collectRegistry(config);
  const available = collectDatabases(config);

  const selected = options.databases.length > 0 ? options.databases : available;
  for (const database of selected) {
    if (!available.includes(database)) {
      throw new CliUsageError(
        `Database "${database}" is not used by any model. Available: ${available.join(", ") || "(none)"}.`,
      );
    }
  }

  const written: string[] = [];
  const skipped: string[] = [];

  for (const database of selected) {
    const directory = join(cwd, options.migrationsDir, database);
    const snapshotPath = join(directory, SNAPSHOT_FILE);

    const previous = readSnapshot(snapshotPath);
    const next = buildSnapshot(registryForDatabase(registry, database));
    const plan = planMigration(previous, next);

    if (plan.changes.length === 0) {
      log(`No changes detected for ${database}.`);
      skipped.push(database);
      continue;
    }

    if (plan.destructive.length > 0 && !options.allowDestructive) {
      throw new CliUsageError(
        `Refusing to write a destructive migration for ${database}. Pass --allow-destructive to proceed:\n` +
          plan.destructive.map((entry) => `  - ${entry}`).join("\n"),
      );
    }

    const number = nextMigrationNumber(directory);
    const name = options.name === undefined ? defaultName(plan.summary) : slugify(options.name);
    const fileName = `${formatMigrationNumber(number)}_${name}.sql`;

    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, fileName), renderMigrationFile(plan, fileName), "utf8");
    writeFileSync(snapshotPath, serializeSnapshot(next), "utf8");

    for (const entry of plan.summary) log(`  ${entry}`);
    log(`Wrote ${join(options.migrationsDir, database, fileName)}`);
    written.push(fileName);
  }

  if (written.length === 0) {
    log("Nothing to do.");
  } else {
    log(
      `Created ${written.length} migration${written.length === 1 ? "" : "s"}. ` +
        "Apply with `clango migrate` or `wrangler d1 migrations apply`.",
    );
  }

  return { written, skipped };
}
