import { ModelDefinitionError } from "./errors";

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Converts a TypeScript property name to its SQL column name.
 *
 * @example
 * toSnakeCase("publishedAt"); // "published_at"
 */
export function toSnakeCase(value: string): string {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

/**
 * Converts a SQL column name to its TypeScript property name.
 *
 * @example
 * toCamelCase("published_at"); // "publishedAt"
 */
export function toCamelCase(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

/** Splits `"blog.Post"` into its app label and model name, validating both parts. */
export function parseModelName(name: string): { appLabel: string; modelName: string } {
  const parts = name.split(".");
  if (parts.length !== 2) {
    throw new ModelDefinitionError(
      `Model name "${name}" must be qualified as "<app>.<Model>", for example "blog.Post".`,
    );
  }
  const [appLabel, modelName] = parts as [string, string];
  if (!IDENTIFIER.test(appLabel)) {
    throw new ModelDefinitionError(
      `App label "${appLabel}" in model "${name}" is not a valid identifier.`,
    );
  }
  if (!IDENTIFIER.test(modelName)) {
    throw new ModelDefinitionError(
      `Model name "${modelName}" in model "${name}" is not a valid identifier.`,
    );
  }
  return { appLabel, modelName };
}

/** Returns the SQL table name for a model, for example `"blog_post"`. */
export function tableNameFor(appLabel: string, modelName: string): string {
  return `${toSnakeCase(appLabel)}_${toSnakeCase(modelName)}`;
}

/** Returns the SQL column name for a model field, for example `"published_at"`. */
export function columnNameFor(property: string): string {
  return toSnakeCase(property);
}
