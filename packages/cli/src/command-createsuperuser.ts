import { spawnSync } from "node:child_process";

import { CLANGO_USER_MODEL, collectRegistry, newUlid, type ClangoConfig } from "@clango/core";

import { CliUsageError, type CliOptions } from "./args";
import { buildSuperuserSql } from "./createsuperuser";
import { loadConfig } from "./load-config";
import { resolveWrangler } from "./migrate";

/** Outcome of a `createsuperuser` run. */
export interface CreatesuperuserResult {
  readonly email: string;
  readonly database: string;
}

/**
 * Appoints a superuser by email.
 *
 * The identity itself stays with the auth provider: this only grants authority in Clango's tables,
 * and the row is linked to the provider's id the first time that address signs in. That is why the
 * command can be run before the account exists.
 */
export async function runCreatesuperuser(
  options: CliOptions,
  cwd: string,
  log: (message: string) => void = () => {},
): Promise<CreatesuperuserResult> {
  const config: ClangoConfig = await loadConfig(options.config, cwd, log);
  if (config.auth?.enabled !== true) {
    throw new CliUsageError(
      "createsuperuser needs authentication: set `auth: { enabled: true, adapter: ... }` in defineConfig.",
    );
  }

  const registry = collectRegistry(config);
  const entry = registry.byName.get(CLANGO_USER_MODEL);
  if (entry === undefined) {
    throw new CliUsageError(
      `The framework user model "${CLANGO_USER_MODEL}" is not registered. Is the auth plugin enabled?`,
    );
  }

  const binding = config.databases?.[entry.database]?.binding;
  if (binding === undefined) {
    throw new CliUsageError(`Database "${entry.database}" is not declared in defineConfig.`);
  }

  const email = options.email as string;
  const sql = buildSuperuserSql({
    table: entry.model.tableName,
    id: newUlid(),
    email,
    now: new Date(),
  });

  const wrangler = resolveWrangler(cwd);
  const args = ["d1", "execute", binding, "--command", sql];
  if (options.target === "local" || options.target === "remote") args.push(`--${options.target}`);

  log(`Appointing ${email} as a superuser in ${entry.database}...`);
  const result = spawnSync(wrangler, args, { cwd, stdio: "inherit" });
  if (result.error !== undefined) {
    throw new CliUsageError(
      `Could not run "${wrangler}". Install wrangler or set CLANGO_WRANGLER.\n${result.error.message}`,
      { cause: result.error },
    );
  }
  if (result.status !== 0) {
    throw new CliUsageError(
      `wrangler exited with code ${String(result.status)}. Ensure migrations are applied and the ` +
        `"${binding}" binding exists in wrangler.jsonc.`,
    );
  }

  log(`${email} is now a superuser. They keep that authority after signing in with that address.`);
  return { email, database: entry.database };
}
