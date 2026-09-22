import { CliUsageError, parseArgs, renderHelp } from "./args";
import { runCreatesuperuser } from "./command-createsuperuser";
import { runInit, runStartapp } from "./generate";
import { runMakemigrations } from "./makemigrations";
import { runMigrate } from "./migrate";
import { VERSION } from "./version";

/** Output sinks, injected so the CLI can be driven from tests. */
export interface CliIo {
  readonly log: (message: string) => void;
  readonly error: (message: string) => void;
}

/**
 * Runs the CLI and returns the process exit code.
 *
 * @param argv - Arguments after the binary name, typically `process.argv.slice(2)`.
 * @param cwd - Directory the config and migrations are resolved from.
 * @param io - Where normal output and errors are written.
 */
export async function main(argv: readonly string[], cwd: string, io: CliIo): Promise<number> {
  try {
    const { command, options } = parseArgs(argv);
    switch (command) {
      case "help":
        io.log(renderHelp(VERSION));
        return 0;
      case "version":
        io.log(VERSION);
        return 0;
      case "makemigrations":
        await runMakemigrations(options, cwd, io.log);
        return 0;
      case "migrate":
        await runMigrate(options, cwd, io.log);
        return 0;
      case "createsuperuser":
        await runCreatesuperuser(options, cwd, io.log);
        return 0;
      case "init":
        await runInit(options, cwd, io.log);
        return 0;
      case "startapp":
        await runStartapp(options, cwd, io.log);
        return 0;
    }
  } catch (error) {
    if (error instanceof CliUsageError) {
      io.error(error.message);
      return 1;
    }
    const message = error instanceof Error ? error.message : String(error);
    io.error(message);
    if (process.env["CLANGO_DEBUG"] !== undefined && error instanceof Error && error.stack) {
      io.error(error.stack);
    }
    return 1;
  }
}
