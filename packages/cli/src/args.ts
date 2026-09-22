/**
 * Command-line parsing for the `clango` binary. Pure and Workers-safe so it can be unit tested in
 * the same runtime as the rest of the framework.
 */

/** A command the CLI understands. */
export type CliCommand =
  "makemigrations" | "migrate" | "createsuperuser" | "init" | "startapp" | "help" | "version";

/** Where migrations should be applied. */
export type MigrationTarget = "default" | "local" | "remote";

/** Options shared by the commands. */
export interface CliOptions {
  /** Path to `clango.config.ts`, relative to the working directory. */
  readonly config: string;
  /** Allows migrations that drop columns or tables. */
  readonly allowDestructive: boolean;
  readonly target: MigrationTarget;
  /** Restricts the command to specific database names. Empty means every database. */
  readonly databases: readonly string[];
  /** Overrides the generated migration name. */
  readonly name?: string;
  /** Overrides the migrations directory (defaults to `migrations`). */
  readonly migrationsDir: string;
  /** Email of the account to appoint, for `createsuperuser`. */
  readonly email?: string;
  /** Applies migrations to every active tenant, not just the project's own database. */
  readonly allTenants: boolean;
  /** Directory for `init`, or app name for `startapp`. */
  readonly subject?: string;
}

/** The result of parsing `process.argv.slice(2)`. */
export interface ParsedCommand {
  readonly command: CliCommand;
  readonly options: CliOptions;
}

/** Raised for malformed command lines. */
export class CliUsageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CliUsageError";
  }
}

export const DEFAULT_CONFIG_PATH = "clango.config.ts";
export const DEFAULT_MIGRATIONS_DIR = "migrations";

const COMMANDS: readonly CliCommand[] = [
  "makemigrations",
  "migrate",
  "createsuperuser",
  "init",
  "startapp",
  "help",
  "version",
];

/** Commands that take a positional argument after the command name. */
const POSITIONAL_COMMANDS: readonly CliCommand[] = ["init", "startapp"];

function requireValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new CliUsageError(`Flag "${flag}" requires a value.`);
  }
  return value;
}

/**
 * Parses command-line arguments.
 *
 * @param argv - Arguments after the binary name, typically `process.argv.slice(2)`.
 */
export function parseArgs(argv: readonly string[]): ParsedCommand {
  const options: {
    config: string;
    allowDestructive: boolean;
    target: MigrationTarget;
    databases: string[];
    name?: string;
    migrationsDir: string;
    email?: string;
    allTenants: boolean;
    subject?: string;
  } = {
    config: DEFAULT_CONFIG_PATH,
    allowDestructive: false,
    target: "default",
    databases: [],
    migrationsDir: DEFAULT_MIGRATIONS_DIR,
    allTenants: false,
  };

  let command: CliCommand | undefined;
  let positional: string | undefined;

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index] as string;

    if (!argument.startsWith("-")) {
      if (command === undefined) {
        if (!(COMMANDS as readonly string[]).includes(argument)) {
          throw new CliUsageError(
            `Unknown command "${argument}". Expected one of ${COMMANDS.join(", ")}.`,
          );
        }
        command = argument as CliCommand;
        continue;
      }
      if (!POSITIONAL_COMMANDS.includes(command) || positional !== undefined) {
        throw new CliUsageError(`Unexpected argument "${argument}".`);
      }
      positional = argument;
      continue;
    }

    switch (argument) {
      case "--config":
        options.config = requireValue(argv, index, "--config");
        index++;
        break;
      case "--name":
        options.name = requireValue(argv, index, "--name");
        index++;
        break;
      case "--email":
        options.email = requireValue(argv, index, "--email");
        index++;
        break;
      case "--database":
        options.databases = [...options.databases, requireValue(argv, index, "--database")];
        index++;
        break;
      case "--migrations-dir":
        options.migrationsDir = requireValue(argv, index, "--migrations-dir");
        index++;
        break;
      case "--allow-destructive":
        options.allowDestructive = true;
        break;
      case "--all-tenants":
        options.allTenants = true;
        break;
      case "--local":
        options.target = "local";
        break;
      case "--remote":
        options.target = "remote";
        break;
      case "--help":
      case "-h":
        return { command: "help", options };
      case "--version":
      case "-v":
        return { command: "version", options };
      default:
        throw new CliUsageError(`Unknown flag "${argument}".`);
    }
  }

  if (command === undefined) {
    return { command: "help", options };
  }

  if (options.target === "local" || options.target === "remote") {
    if (command !== "migrate" && command !== "createsuperuser") {
      throw new CliUsageError(
        `"--${options.target}" is only valid for "clango migrate" and "clango createsuperuser".`,
      );
    }
  }

  if (
    command === "createsuperuser" &&
    (options.email === undefined || options.email.length === 0)
  ) {
    throw new CliUsageError("clango createsuperuser requires --email <address>.");
  }

  if (options.allTenants && command !== "migrate") {
    throw new CliUsageError('"--all-tenants" is only valid for "clango migrate".');
  }

  if (POSITIONAL_COMMANDS.includes(command) && positional !== undefined) {
    options.subject = positional;
  }

  return { command, options };
}

/** Renders the `clango --help` text. */
export function renderHelp(version: string): string {
  return [
    `clango ${version}`,
    "",
    "Usage:",
    "  clango makemigrations [options]   Diff the models against the last snapshot and write SQL",
    "  clango migrate [options]          Apply pending migrations with wrangler",
    "  clango createsuperuser [options]  Appoint a superuser by email, before they sign in",
    "  clango init [directory]           Scaffold a new project",
    "  clango startapp <name>            Scaffold an app inside the current project",
    "",
    "Options:",
    `  --config <path>          Config file (default: ${DEFAULT_CONFIG_PATH})`,
    `  --migrations-dir <path>  Migrations root (default: ${DEFAULT_MIGRATIONS_DIR})`,
    "  --database <name>        Restrict to a database; repeatable",
    "  --name <slug>            Override the generated migration name",
    "  --email <address>        createsuperuser only: who to appoint",
    "  --allow-destructive      Required to drop columns or tables",
    "  --all-tenants            migrate only: apply to every active tenant",
    "  --local | --remote       migrate only: apply to the local or remote database",
    "  -h, --help               Show this message",
    "  -v, --version            Show the version",
    "",
    "Migrations are written to <migrations-dir>/<database>/ and applied with",
    "`wrangler d1 migrations apply`, so set `migrations_dir` on the D1 binding to match.",
  ].join("\n");
}
