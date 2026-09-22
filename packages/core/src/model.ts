import { ModelDefinitionError } from "./errors";
import { fields } from "./fields";
import type {
  Field,
  FieldInsertValue,
  FieldIsInsertOptional,
  FieldMap,
  FieldValue,
} from "./fields";
import { columnNameFor, parseModelName, tableNameFor } from "./naming";

/** Fields Clango adds to every model automatically. These names are reserved. */
export const AUTOMATIC_FIELDS = ["id", "createdAt", "updatedAt"] as const;

/** One of the automatically managed field names. */
export type AutomaticField = (typeof AUTOMATIC_FIELDS)[number];

/** An operation the generated REST API can expose for a model. */
export type ApiOp = "list" | "retrieve" | "create" | "update" | "delete";

/** Every operation an exposed model gets when `ops` is omitted. */
export const ALL_API_OPS: readonly ApiOp[] = ["list", "retrieve", "create", "update", "delete"];

/**
 * Controls whether a model is exposed over the generated REST API. Nothing is exposed unless a
 * model opts in with `api: { enabled: true }`.
 */
export interface ApiConfig {
  /** Models are not reachable over HTTP unless this is `true`. */
  enabled?: boolean;
  /** Restricts which operations are mounted. Defaults to every operation. */
  ops?: readonly ApiOp[];
}

/**
 * Synthetic field definitions for the automatically managed columns, so filtering and ordering can
 * treat `id`, `createdAt` and `updatedAt` like any other column.
 */
export const AUTOMATIC_FIELD_DEFINITIONS: Readonly<Record<AutomaticField, Field>> = {
  id: fields.string({ unique: true }),
  createdAt: fields.datetime({ index: true }),
  updatedAt: fields.datetime(),
};

/** Returns the synthetic definition for an automatic field name, or `undefined`. */
export function automaticField(property: string): Field | undefined {
  return (AUTOMATIC_FIELDS as readonly string[]).includes(property)
    ? AUTOMATIC_FIELD_DEFINITIONS[property as AutomaticField]
    : undefined;
}

/** Returns the field definition for `property`, including the automatic columns. */
export function resolveField(fields: FieldMap, property: string): Field | undefined {
  return fields[property] ?? automaticField(property);
}

/** Resolved, runtime model metadata. */
export interface ModelMeta {
  /** Default ordering, for example `["-publishedAt"]`. Prefix a field with `-` for descending. */
  ordering?: readonly string[];
  /** Human-readable singular name used by the admin UI. */
  verboseName?: string;
  /** Human-readable plural name used by the admin UI. */
  verboseNamePlural?: string;
  /**
   * Field used as this model's human-readable label, for example in relation pickers and audit
   * logs. Falls back to `display` for in-process rendering and to `id` in SQL-only contexts.
   */
  labelField?: string;
}

/** Flattens intersections so editor tooltips stay readable. */
export type Simplify<T> = { [K in keyof T]: T[K] } & {};

type OrderingSpec<TFields extends FieldMap> =
  `${"-" | ""}${Extract<keyof TFields, string>}` | `${"-" | ""}${AutomaticField}`;

/** Field keys that map to a real column. `manyToMany` fields are materialised as join tables. */
export type ColumnFieldKeys<TFields extends FieldMap> = {
  [K in keyof TFields]: TFields[K] extends { readonly kind: "manyToMany" } ? never : K;
}[keyof TFields];

/** The shape of a row read from the database. */
export type ModelRow<TFields extends FieldMap> = Simplify<
  { id: string; createdAt: Date; updatedAt: Date } & {
    [K in ColumnFieldKeys<TFields>]: FieldValue<TFields[K]>;
  }
>;

type OptionalInsertKeys<TFields extends FieldMap> = {
  [K in ColumnFieldKeys<TFields>]: FieldIsInsertOptional<TFields[K]> extends true ? K : never;
}[ColumnFieldKeys<TFields>];

type RequiredInsertKeys<TFields extends FieldMap> = Exclude<
  ColumnFieldKeys<TFields>,
  OptionalInsertKeys<TFields>
>;

/** The shape accepted when inserting a row. `id`, `createdAt` and `updatedAt` are generated. */
export type ModelInsert<TFields extends FieldMap> = Simplify<
  { id?: string; createdAt?: Date; updatedAt?: Date } & {
    [K in OptionalInsertKeys<TFields>]?: FieldInsertValue<TFields[K]>;
  } & {
    [K in RequiredInsertKeys<TFields>]: FieldInsertValue<TFields[K]>;
  }
>;

/** The shape accepted when updating a row. Every column is optional. */
export type ModelUpdate<TFields extends FieldMap> = Simplify<{
  [K in ColumnFieldKeys<TFields>]?: FieldInsertValue<TFields[K]>;
}>;

/**
 * A model definition. `TName` is the qualified name (`"blog.Post"`) and `TFields` the declared
 * field map, from which {@link ModelRow}, {@link ModelInsert} and {@link ModelUpdate} are derived.
 */
export interface Model<TName extends string = string, TFields extends FieldMap = FieldMap> {
  readonly kind: "model";
  readonly name: TName;
  readonly appLabel: string;
  readonly modelName: string;
  readonly tableName: string;
  readonly fields: TFields;
  readonly meta: ModelMeta;
  /** Name of the database this model lives in. Falls back to the owning app's database. */
  readonly database?: string;
  /** REST API exposure for this model. Nothing is exposed unless `enabled` is true. */
  readonly api?: ApiConfig;
  /** Returns the human-readable label for a row. Used by the admin UI and relations. */
  readonly display?: (row: ModelRow<TFields>) => string;
}

/**
 * A model of unknown shape. Used wherever Clango needs to accept any model — for example
 * `fields.foreignKey(() => Author)` or `defineApp({ models: [...] })`.
 */
export interface AnyModel {
  readonly kind: "model";
  readonly name: string;
  readonly appLabel: string;
  readonly modelName: string;
  readonly tableName: string;
  readonly fields: FieldMap;
  readonly meta: ModelMeta;
  readonly database?: string;
  readonly api?: ApiConfig;
}

/** Configuration accepted by {@link defineModel}. */
export interface ModelConfig<TFields extends FieldMap> {
  fields: TFields;
  meta?: {
    ordering?: readonly OrderingSpec<TFields>[];
    verboseName?: string;
    verboseNamePlural?: string;
    labelField?: Extract<keyof TFields, string> | AutomaticField;
  };
  display?: (row: ModelRow<TFields>) => string;
  database?: string;
  /** Opts the model into the generated REST API. */
  api?: ApiConfig;
}

function validateFields(name: string, fields: FieldMap): void {
  const entries = Object.entries(fields);
  if (entries.length === 0) {
    throw new ModelDefinitionError(`Model "${name}" must declare at least one field.`);
  }
  for (const [property, field] of entries) {
    if ((AUTOMATIC_FIELDS as readonly string[]).includes(property)) {
      throw new ModelDefinitionError(
        `Model "${name}" declares field "${property}", which Clango adds automatically.`,
      );
    }
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(property)) {
      throw new ModelDefinitionError(
        `Model "${name}" declares field "${property}", which is not a valid identifier.`,
      );
    }
    if (field === null || typeof field !== "object" || typeof field.kind !== "string") {
      throw new ModelDefinitionError(
        `Field "${name}.${property}" is not a Clango field. Use one of the \`fields\` builders.`,
      );
    }
    if (field.kind === "manyToMany" && (field.options as { unique?: boolean }).unique === true) {
      throw new ModelDefinitionError(
        `Field "${name}.${property}" is a manyToMany relation and cannot be unique.`,
      );
    }
  }
}

function validateApi(name: string, api: ApiConfig | undefined): void {
  if (api === undefined) return;
  if (typeof api !== "object" || api === null) {
    throw new ModelDefinitionError(`Model "${name}" api must be an object.`);
  }
  if (api.enabled !== undefined && typeof api.enabled !== "boolean") {
    throw new ModelDefinitionError(`Model "${name}" api.enabled must be a boolean.`);
  }
  if (api.ops !== undefined) {
    if (!Array.isArray(api.ops)) {
      throw new ModelDefinitionError(`Model "${name}" api.ops must be an array.`);
    }
    for (const op of api.ops) {
      if (!(ALL_API_OPS as readonly string[]).includes(op)) {
        throw new ModelDefinitionError(
          `Model "${name}" api.ops contains "${op}". Expected one of ${ALL_API_OPS.join(", ")}.`,
        );
      }
    }
  }
}

function validateMeta(name: string, meta: ModelMeta, fields: FieldMap): void {
  if (meta.labelField !== undefined && resolveField(fields, meta.labelField) === undefined) {
    throw new ModelDefinitionError(
      `Model "${name}" meta.labelField references "${meta.labelField}", which is not a field.`,
    );
  }
  if (meta.ordering === undefined) return;
  if (!Array.isArray(meta.ordering)) {
    throw new ModelDefinitionError(`Model "${name}" meta.ordering must be an array.`);
  }
  for (const entry of meta.ordering) {
    const property = entry.startsWith("-") ? entry.slice(1) : entry;
    if (!(property in fields) && automaticField(property) === undefined) {
      throw new ModelDefinitionError(
        `Model "${name}" meta.ordering references "${entry}", which is not a declared field.`,
      );
    }
  }
}

/**
 * Defines a model. The qualified `name` (`"<app>.<Model>"`) determines the app label and the SQL
 * table name (`blog.Post` becomes `blog_post`).
 *
 * @example
 * export const Post = defineModel("blog.Post", {
 *   fields: {
 *     title: fields.string({ max: 200 }),
 *     body: fields.text({ searchable: true, optional: true }),
 *     status: fields.choice(["draft", "published"], { default: "draft" }),
 *   },
 *   meta: { ordering: ["-createdAt"] },
 * });
 */
export function defineModel<const TName extends string, TFields extends FieldMap>(
  name: TName,
  config: ModelConfig<TFields>,
): Model<TName, TFields> {
  const { appLabel, modelName } = parseModelName(name);
  if (config === null || typeof config !== "object") {
    throw new ModelDefinitionError(`Model "${name}" requires a configuration object.`);
  }
  validateFields(name, config.fields);
  const meta: ModelMeta = config.meta ?? {};
  validateMeta(name, meta, config.fields);
  validateApi(name, config.api);
  if (config.display !== undefined && typeof config.display !== "function") {
    throw new ModelDefinitionError(`Model "${name}" display must be a function.`);
  }

  const model: {
    kind: "model";
    name: TName;
    appLabel: string;
    modelName: string;
    tableName: string;
    fields: TFields;
    meta: ModelMeta;
    database?: string;
    api?: ApiConfig;
    display?: (row: ModelRow<TFields>) => string;
  } = {
    kind: "model",
    name,
    appLabel,
    modelName,
    tableName: tableNameFor(appLabel, modelName),
    fields: config.fields,
    meta,
  };
  if (config.database !== undefined) model.database = config.database;
  if (config.api !== undefined) model.api = config.api;
  if (config.display !== undefined) model.display = config.display;
  return model as Model<TName, TFields>;
}

/** Returns `true` when `value` is a model produced by {@link defineModel}. */
export function isModel(value: unknown): value is AnyModel {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "model" &&
    typeof (value as { tableName?: unknown }).tableName === "string"
  );
}

/** Returns the SQL column name for a model field. */
export function columnFor(property: string): string {
  return columnNameFor(property);
}

/** Returns the fields of `model` that are indexed with FTS5 (`searchable: true`). */
export function searchableFields(model: AnyModel): readonly string[] {
  return Object.entries(model.fields)
    .filter(([, field]) => (field.options as { searchable?: boolean }).searchable === true)
    .map(([property]) => property);
}

/** Returns the `manyToMany` fields of `model`. */
export function manyToManyFields(model: AnyModel): readonly [string, Field][] {
  return Object.entries(model.fields).filter(([, field]) => field.kind === "manyToMany") as [
    string,
    Field,
  ][];
}

/** Returns the REST operations a model exposes. Empty when the model has not opted in. */
export function apiOps(model: AnyModel): readonly ApiOp[] {
  if (model.api === undefined || model.api.enabled !== true) return [];
  return model.api.ops ?? ALL_API_OPS;
}
