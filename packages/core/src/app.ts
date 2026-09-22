import { ModelDefinitionError } from "./errors";
import { isModel, type AnyModel } from "./model";

/**
 * A group of models that share a database. An app's `name` becomes the prefix of every model it
 * owns, so `defineApp({ name: "blog", models: [Post] })` requires `Post` to be named `"blog.Post"`.
 */
export interface App<TModels extends readonly AnyModel[] = readonly AnyModel[]> {
  readonly kind: "app";
  readonly name: string;
  readonly models: TModels;
  /** Default database for the app's models. Individual models may override it. */
  readonly database?: string;
}

/** Configuration accepted by {@link defineApp}. */
export interface AppConfig<TModels extends readonly AnyModel[]> {
  name: string;
  models: TModels;
  database?: string;
}

/**
 * Defines an app.
 *
 * @example
 * export default defineApp({ name: "blog", models: [Author, Post], database: "DB_MAIN" });
 */
export function defineApp<const TModels extends readonly AnyModel[]>(
  config: AppConfig<TModels>,
): App<TModels> {
  if (config === null || typeof config !== "object") {
    throw new ModelDefinitionError("defineApp requires a configuration object.");
  }
  const { name } = config;
  if (typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    throw new ModelDefinitionError(`App name ${JSON.stringify(name)} is not a valid identifier.`);
  }
  if (!Array.isArray(config.models) || config.models.length === 0) {
    throw new ModelDefinitionError(`App "${name}" must declare at least one model.`);
  }
  const seen = new Set<string>();
  for (const model of config.models) {
    if (!isModel(model)) {
      throw new ModelDefinitionError(
        `App "${name}" contains a value that is not a model. Use defineModel(...).`,
      );
    }
    if (model.appLabel !== name) {
      throw new ModelDefinitionError(
        `App "${name}" contains model "${model.name}", whose app label is "${model.appLabel}". ` +
          `Rename the model to "${name}.${model.modelName}" or move it to the "${model.appLabel}" app.`,
      );
    }
    if (seen.has(model.name)) {
      throw new ModelDefinitionError(
        `App "${name}" declares model "${model.name}" more than once.`,
      );
    }
    seen.add(model.name);
  }
  if (config.database !== undefined && typeof config.database !== "string") {
    throw new ModelDefinitionError(`App "${name}" database must be a string.`);
  }

  const app: {
    kind: "app";
    name: string;
    models: TModels;
    database?: string;
  } = { kind: "app", name, models: config.models };
  if (config.database !== undefined) app.database = config.database;
  return app;
}

/** Returns `true` when `value` is an app produced by {@link defineApp}. */
export function isApp(value: unknown): value is App {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "app" &&
    typeof (value as { name?: unknown }).name === "string" &&
    Array.isArray((value as { models?: unknown }).models)
  );
}
