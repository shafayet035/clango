import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { CliUsageError, type CliOptions } from "./args";
import { appFiles, projectFiles, type GeneratedFile } from "./generators";

/** Outcome of a generator run. */
export interface GenerateResult {
  readonly written: readonly string[];
  readonly skipped: readonly string[];
}

function isDirectoryEmpty(path: string): boolean {
  return !existsSync(path) || readdirSync(path).length === 0;
}

/**
 * Writes generated files.
 *
 * A generator never overwrites a file it did not create: anything already present that is not marked
 * `skipIfExists` is reported as a conflict, so running `init` in the wrong directory fails instead of
 * destroying work.
 */
function write(files: readonly GeneratedFile[], root: string): GenerateResult {
  const written: string[] = [];
  const skipped: string[] = [];

  const conflicts = files
    .filter((file) => !file.skipIfExists && existsSync(join(root, file.path)))
    .map((file) => file.path);
  if (conflicts.length > 0) {
    throw new CliUsageError(
      `Refusing to overwrite existing files: ${conflicts.join(", ")}. ` +
        "Run the generator in an empty directory, or move the files aside.",
    );
  }

  for (const file of files) {
    const target = join(root, file.path);
    if (file.skipIfExists === true && existsSync(target)) {
      skipped.push(file.path);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.contents, "utf8");
    written.push(file.path);
  }

  return { written, skipped };
}

/** Builds a filesystem-safe project name from a directory name. */
function projectNameFrom(directory: string): string {
  const base =
    directory === "."
      ? (process.cwd().split("/").pop() ?? "app")
      : (directory.split("/").pop() ?? "app");
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length === 0 ? "app" : cleaned;
}

/** Scaffolds a new project. */
export async function runInit(
  options: CliOptions,
  cwd: string,
  log: (message: string) => void = () => {},
): Promise<GenerateResult> {
  const directory = options.subject ?? ".";
  const root = resolve(cwd, directory);

  if (!isDirectoryEmpty(root)) {
    throw new CliUsageError(`${root} is not empty. Run init in a new directory.`);
  }

  const name = projectNameFrom(directory);
  const result = write(projectFiles({ name }), root);

  for (const path of result.written) log(`  created ${path}`);
  log(`Created a Clango project in ${root}.`);
  log("Next: pnpm install, then run `wrangler d1 create` and paste the id into wrangler.jsonc.");
  return result;
}

/** Scaffolds an app inside an existing project. */
export async function runStartapp(
  options: CliOptions,
  cwd: string,
  log: (message: string) => void = () => {},
): Promise<GenerateResult> {
  const name = options.subject;
  if (name === undefined) {
    throw new CliUsageError(
      "clango startapp requires an app name, for example `clango startapp shop`.",
    );
  }
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new CliUsageError(`App name "${name}" must be lower_snake_case, for example "shop".`);
  }
  if (!existsSync(join(cwd, "clango.config.ts"))) {
    throw new CliUsageError("No clango.config.ts here. Run startapp from a project root.");
  }

  const result = write(appFiles(name), cwd);
  for (const path of result.written) log(`  created ${path}`);
  log(
    `Created the "${name}" app. Register it in clango.config.ts (see src/apps/${name}/README.md).`,
  );
  return result;
}
