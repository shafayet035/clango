import type { AuthAdapter } from "./auth";
import { defineApp, isApp, type App } from "./app";
import { ModelDefinitionError } from "./errors";
import type { AnyModel } from "./model";
import { AUTH_MODELS, AdminLog } from "./system";

/** A D1 database a project can bind models to. */
export interface DatabaseConfig {
  /** The binding name declared in `wrangler.jsonc`. */
  binding: string;
}

/** Opt-in configuration for the generated admin. */
export interface AdminConfig {
  /** The admin is not registered or mounted unless this is `true`. */
  enabled?: boolean;
  /**
   * Database that hosts the admin log. Only needed when the project declares more than one
   * database, because the log cannot live in several at once.
   */
  database?: string;
}

/**
 * R2 file storage.
 *
 * The R2 binding cannot sign URLs, so presigned uploads need an S3 API token: an access key id and
 * secret (stored as Worker secrets, referenced here by binding name), plus the account id and
 * bucket name that make up the S3 endpoint.
 */
export interface FilesConfig {
  /** R2 binding name, used for reads, writes and deletes from the Worker. */
  readonly binding: string;
  /** Bucket name, used to build the S3 endpoint host. */
  readonly bucket: string;
  /** Binding name holding the Cloudflare account id. */
  readonly accountId: string;
  /** Binding name holding the S3 access key id. */
  readonly accessKeyId: string;
  /** Binding name holding the S3 secret access key. */
  readonly secretAccessKey: string;
  /** Path private downloads are served from. Defaults to `/files`. */
  readonly downloadPath?: string;
  /** Default upload URL lifetime in seconds. Defaults to 900. */
  readonly uploadTtlSeconds?: number;
}

/** Queues producer used by admin actions and file cleanup. */
export interface TasksConfig {
  /** Queue binding name. */
  readonly binding: string;
  /** Queue name, for logging. Defaults to the binding name. */
  readonly queue?: string;
}

/** KV-backed caching for read-heavy, staleness-tolerant data. */
export interface CacheConfig {
  /** KV binding name. */
  readonly binding: string;
  /** Key namespace. Defaults to `clango:`. */
  readonly prefix?: string;
}

/** The shape of `clango.config.ts`. */
export interface ClangoConfig<TApps extends readonly App[] = readonly App[]> {
  apps: TApps;
  /** Databases models may be routed to, keyed by the name used in `defineApp`/`defineModel`. */
  databases?: Readonly<Record<string, DatabaseConfig>>;
  /** Enables the generated admin API, SPA and audit log. */
  admin?: AdminConfig;
  /** Enables authentication and the permission system. */
  auth?: AuthConfig;
  /** Enables R2 file and image fields. */
  files?: FilesConfig;
  /** Enables the KV cache helpers. */
  cache?: CacheConfig;
  /** Enables background tasks: admin actions and file cleanup are enqueued here. */
  tasks?: TasksConfig;
}

/**
 * Opt-in configuration for authentication and authorization.
 *
 * The adapter answers "who is this?"; Clango answers "what may they do?" using its own tables, so
 * swapping providers never touches permissions (D-003).
 */
export interface AuthConfig {
  /** The staff gate and permission checks are only installed when this is `true`. */
  enabled?: boolean;
  /** Resolves the current user. Required when the auth is enabled. */
  adapter?: AuthAdapter;
  /** Database that hosts the authorization tables. Needed when several are declared. */
  database?: string;
}

/** App label reserved for framework-owned models. */
export const SYSTEM_APP_LABEL = "clango";

/** A model together with the app that owns it and the database it is routed to. */
export interface RegisteredModel {
  readonly model: AnyModel;
  readonly app: App;
  readonly database: string;
}

/** The resolved set of models a project defines. */
export interface Registry {
  readonly models: readonly RegisteredModel[];
  readonly byName: ReadonlyMap<string, RegisteredModel>;
}

/**
 * Defines the project configuration. `clango makemigrations` and `clango migrate` load this file.
 *
 * @example
 * export default defineConfig({
 *   apps: [blog],
 *   databases: { DB_MAIN: { binding: "DB_MAIN" } },
 * });
 */
export function defineConfig<const TApps extends readonly App[]>(
  config: ClangoConfig<TApps>,
): ClangoConfig<TApps> {
  if (config === null || typeof config !== "object") {
    throw new ModelDefinitionError("defineConfig requires a configuration object.");
  }
  if (!Array.isArray(config.apps)) {
    throw new ModelDefinitionError("defineConfig requires an `apps` array.");
  }
  const appNames = new Set<string>();
  for (const app of config.apps) {
    if (!isApp(app)) {
      throw new ModelDefinitionError(
        "defineConfig received a value in `apps` that is not an app. Use defineApp(...).",
      );
    }
    if (appNames.has(app.name)) {
      throw new ModelDefinitionError(`defineConfig declares app "${app.name}" more than once.`);
    }
    appNames.add(app.name);
  }
  if (config.admin !== undefined) {
    if (typeof config.admin !== "object" || config.admin === null) {
      throw new ModelDefinitionError("defineConfig `admin` must be an object.");
    }
    if (config.admin.enabled !== undefined && typeof config.admin.enabled !== "boolean") {
      throw new ModelDefinitionError("defineConfig `admin.enabled` must be a boolean.");
    }
    if (config.admin.database !== undefined && typeof config.admin.database !== "string") {
      throw new ModelDefinitionError("defineConfig `admin.database` must be a string.");
    }
    if (config.admin.enabled === true && config.apps.some((app) => app.name === SYSTEM_APP_LABEL)) {
      throw new ModelDefinitionError(
        `The app label "${SYSTEM_APP_LABEL}" is reserved for framework models. Rename your app.`,
      );
    }
  }
  if (config.auth !== undefined) {
    if (typeof config.auth !== "object" || config.auth === null) {
      throw new ModelDefinitionError("defineConfig `auth` must be an object.");
    }
    if (config.auth.enabled !== undefined && typeof config.auth.enabled !== "boolean") {
      throw new ModelDefinitionError("defineConfig `auth.enabled` must be a boolean.");
    }
    if (config.auth.enabled === true && config.auth.adapter === undefined) {
      throw new ModelDefinitionError(
        "defineConfig `auth.enabled` requires an `adapter` that resolves the current user.",
      );
    }
    if (config.auth.database !== undefined && typeof config.auth.database !== "string") {
      throw new ModelDefinitionError("defineConfig `auth.database` must be a string.");
    }
  }
  if (config.files !== undefined) {
    for (const key of [
      "binding",
      "bucket",
      "accountId",
      "accessKeyId",
      "secretAccessKey",
    ] as const) {
      const value = config.files[key];
      if (typeof value !== "string" || value.length === 0) {
        throw new ModelDefinitionError(`defineConfig \`files.${key}\` must be a non-empty string.`);
      }
    }
  }
  if (
    config.cache !== undefined &&
    (typeof config.cache.binding !== "string" || config.cache.binding.length === 0)
  ) {
    throw new ModelDefinitionError("defineConfig `cache.binding` must be a non-empty string.");
  }
  if (
    config.tasks !== undefined &&
    (typeof config.tasks.binding !== "string" || config.tasks.binding.length === 0)
  ) {
    throw new ModelDefinitionError("defineConfig `tasks.binding` must be a non-empty string.");
  }
  if (config.databases !== undefined) {
    if (typeof config.databases !== "object" || config.databases === null) {
      throw new ModelDefinitionError("defineConfig `databases` must be an object.");
    }
    for (const [name, database] of Object.entries(config.databases)) {
      if (typeof database?.binding !== "string" || database.binding.length === 0) {
        throw new ModelDefinitionError(
          `Database "${name}" must declare a non-empty \`binding\` string.`,
        );
      }
    }
  }
  return config;
}

/**
 * Resolves every model in the project together with the database it lives in.
 *
 * A model's database is, in order of precedence: the model's own `database`, its app's `database`,
 * or — when the project declares exactly one database — that database.
 */
export function collectRegistry(config: ClangoConfig): Registry {
  const databases = config.databases ?? {};
  const databaseNames = Object.keys(databases);
  const models: RegisteredModel[] = [];
  const byName = new Map<string, RegisteredModel>();

  for (const app of [...config.apps, ...systemApps(config)]) {
    for (const model of app.models) {
      const database = resolveDatabase(model, app, databaseNames);
      const registered: RegisteredModel = { model, app, database };
      if (byName.has(model.name)) {
        throw new ModelDefinitionError(
          `Model "${model.name}" is declared more than once. Model names must be unique across all apps.`,
        );
      }
      models.push(registered);
      byName.set(model.name, registered);
    }
  }

  return { models, byName };
}

/** Convenience wrapper returning only the models in the project. */
export function collectModels(config: ClangoConfig): readonly AnyModel[] {
  return collectRegistry(config).models.map((entry) => entry.model);
}

/** Returns the registered model named `name`, or `undefined`. */
export function findModel(config: ClangoConfig, name: string): RegisteredModel | undefined {
  return collectRegistry(config).byName.get(name);
}

/** Returns every distinct database binding referenced by the project's models. */
export function collectDatabases(config: ClangoConfig): readonly string[] {
  const names = new Set(collectRegistry(config).models.map((entry) => entry.database));
  return [...names].sort();
}

function resolveDatabase(model: AnyModel, app: App, databaseNames: readonly string[]): string {
  const name =
    model.database ?? app.database ?? (databaseNames.length === 1 ? databaseNames[0] : undefined);
  if (name === undefined) {
    throw new ModelDefinitionError(
      `Model "${model.name}" does not resolve to a database. Set \`database\` on the model or its app, ` +
        "or declare exactly one database in defineConfig.",
    );
  }
  if (databaseNames.length > 0 && !databaseNames.includes(name)) {
    throw new ModelDefinitionError(
      `Model "${model.name}" is routed to database "${name}", which is not declared in ` +
        `defineConfig databases (${databaseNames.join(", ")}).`,
    );
  }
  return name;
}

/**
 * Framework models are registered only when the feature that owns them is enabled, so a project that
 * does not use the admin never gets its tables.
 */
function systemApps(config: ClangoConfig): readonly App[] {
  const models = [
    ...(config.admin?.enabled === true ? [AdminLog] : []),
    ...(config.auth?.enabled === true ? AUTH_MODELS : []),
  ];
  if (models.length === 0) return [];

  const database = config.auth?.enabled === true ? config.auth.database : config.admin?.database;
  return [
    defineApp({
      name: SYSTEM_APP_LABEL,
      models,
      ...(database === undefined ? {} : { database }),
    }),
  ];
}
