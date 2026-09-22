import { ModelDefinitionError } from "./errors";
import type { AnyModel } from "./model";

/** Every field kind supported by Clango v1. */
export type FieldKind =
  | "string"
  | "email"
  | "slug"
  | "url"
  | "text"
  | "integer"
  | "decimal"
  | "boolean"
  | "datetime"
  | "date"
  | "choice"
  | "json"
  | "foreignKey"
  | "manyToMany"
  | "file"
  | "image";

/** Maps a field kind to the SQLite storage class Clango stores it in. */
export type StorageClass = "TEXT" | "INTEGER" | "REAL";

/**
 * A field definition produced by the {@link fields} builders.
 *
 * The type parameters are never used at runtime; `__clango` is a phantom property that carries the
 * inferred value, insert and optionality information into the type system. Do not read it.
 */
export interface Field<
  TValue = unknown,
  TKind extends FieldKind = FieldKind,
  TOptions = unknown,
  TInsert = TValue,
> {
  readonly kind: TKind;
  readonly options: TOptions;
  /** For `foreignKey` and `manyToMany`: a lazy reference to the target model. */
  readonly ref?: () => AnyModel;
  /** For `choice`: the allowed values. */
  readonly values?: readonly string[];
  /** @internal Phantom type carrier. Never set at runtime. */
  readonly __clango?: {
    readonly value: TValue;
    readonly insert: TInsert;
  };
}

/** A model's field map, keyed by TypeScript property name. */
export type FieldMap = Readonly<Record<string, Field>>;

type PhantomOf<F> = F extends { readonly __clango?: infer P } ? NonNullable<P> : never;

/** The value type a field contributes to a model row. `null` when the field is optional. */
export type FieldValue<F> = PhantomOf<F> extends { readonly value: infer V } ? V : never;

/** The value type accepted for a field when inserting a row. */
export type FieldInsertValue<F> = PhantomOf<F> extends { readonly insert: infer I } ? I : never;

/**
 * `true` when a field may be omitted from an insert because it is optional or declares a default.
 * Derived from the literal options object captured by the field builder.
 */
export type FieldIsInsertOptional<F> = F extends { readonly options: infer O }
  ? O extends { readonly optional: true }
    ? true
    : "default" extends keyof O
      ? true
      : false
  : false;

type Nullable<O, T> = O extends { readonly optional: true } ? T | null : T;

/** Options accepted by every field kind. */
export interface BaseFieldOptions {
  /** Stores `NULL` for missing values and makes the field optional in inserts. */
  optional?: boolean;
  /** Adds a unique index for the column. */
  unique?: boolean;
  /** Adds a non-unique index for the column. */
  index?: boolean;
  /** Human-readable label used by the admin UI. */
  label?: string;
  /** Help text shown under the field in the admin UI. */
  helpText?: string;
}

/** Options for `string`, `email` and `url` fields. */
export interface StringFieldOptions extends BaseFieldOptions {
  default?: string;
  /** Maximum accepted length. Enforced in DDL only for `choice`. */
  max?: number;
  /** Minimum accepted length. */
  min?: number;
}

/** Options for `text` fields. */
export interface TextFieldOptions extends BaseFieldOptions {
  default?: string;
  /** Includes the column in the model's FTS5 index. */
  searchable?: boolean;
}

/** Options for `slug` fields. */
export interface SlugFieldOptions extends StringFieldOptions {
  /** Field this slug is generated from. Used by the admin UI, not by the schema. */
  from?: string;
}

/** Options for `integer` fields. */
export interface IntegerFieldOptions extends BaseFieldOptions {
  default?: number;
  min?: number;
  max?: number;
}

/** Options for `decimal` fields. Values are stored as integer minor units. */
export interface DecimalFieldOptions extends BaseFieldOptions {
  default?: number;
  /** Number of decimal places to store. Defaults to `2`. */
  scale?: number;
  min?: number;
  max?: number;
}

/** Options for `boolean` fields. */
export interface BooleanFieldOptions extends BaseFieldOptions {
  default?: boolean;
}

/** Options for `datetime` fields. Values are stored as UTC epoch milliseconds. */
export interface DateTimeFieldOptions extends BaseFieldOptions {
  default?: "now" | number | Date;
}

/** Options for `date` fields. Values are stored as `YYYY-MM-DD` strings. */
export interface DateFieldOptions extends BaseFieldOptions {
  default?: string;
}

/** Options for `choice` fields. */
export interface ChoiceFieldOptions<TValue extends string = string> extends BaseFieldOptions {
  default?: TValue;
}

/** Options for `json` fields. */
export interface JsonFieldOptions<TValue = unknown> extends BaseFieldOptions {
  default?: TValue;
}

/** Referential actions supported by SQLite foreign keys. */
export type ReferentialAction = "cascade" | "restrict" | "set null" | "no action";

/** Options for `foreignKey` fields. */
export interface ForeignKeyFieldOptions extends BaseFieldOptions {
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
}

/** Options for `manyToMany` fields. */
export interface ManyToManyFieldOptions {
  /** Overrides the generated join table name (`<app>_<model>_<field>`). */
  through?: string;
  label?: string;
  helpText?: string;
}

/** Options for `file` and `image` fields. */
export interface FileFieldOptions extends BaseFieldOptions {
  /** Maximum upload size in bytes. Enforced by the upload endpoint (M5). */
  maxSize?: number;
  /** Accepted MIME types. Enforced by the upload endpoint (M5). */
  accept?: readonly string[];
}

function assertString(value: unknown, label: string): void {
  if (typeof value !== "string") {
    throw new ModelDefinitionError(`Field option "${label}" must be a string.`);
  }
}

function assertNonEmptyString(value: unknown, label: string): void {
  assertString(value, label);
  if ((value as string).length === 0) {
    throw new ModelDefinitionError(`Field option "${label}" must not be empty.`);
  }
}

function assertBoolean(value: unknown, label: string): void {
  if (typeof value !== "boolean") {
    throw new ModelDefinitionError(`Field option "${label}" must be a boolean.`);
  }
}

function assertInteger(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ModelDefinitionError(`Field option "${label}" must be an integer.`);
  }
}

function assertNumber(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ModelDefinitionError(`Field option "${label}" must be a finite number.`);
  }
}

function assertPositiveInteger(value: unknown, label: string): void {
  assertInteger(value, label);
  if ((value as number) <= 0) {
    throw new ModelDefinitionError(`Field option "${label}" must be greater than zero.`);
  }
}

function assertNonNegativeInteger(value: unknown, label: string): void {
  assertInteger(value, label);
  if ((value as number) < 0) {
    throw new ModelDefinitionError(`Field option "${label}" must not be negative.`);
  }
}

function validateCommon(kind: FieldKind, options: BaseFieldOptions): void {
  if (options.optional !== undefined) assertBoolean(options.optional, `${kind}.optional`);
  if (options.unique !== undefined) assertBoolean(options.unique, `${kind}.unique`);
  if (options.index !== undefined) assertBoolean(options.index, `${kind}.index`);
  if (options.label !== undefined) assertNonEmptyString(options.label, `${kind}.label`);
  if (options.helpText !== undefined) assertString(options.helpText, `${kind}.helpText`);
}

function validateString(options: StringFieldOptions, kind: FieldKind): void {
  validateCommon(kind, options);
  if (options.default !== undefined) assertString(options.default, `${kind}.default`);
  if (options.max !== undefined) assertPositiveInteger(options.max, `${kind}.max`);
  if (options.min !== undefined) assertNonNegativeInteger(options.min, `${kind}.min`);
  if (options.min !== undefined && options.max !== undefined && options.min > options.max) {
    throw new ModelDefinitionError(
      `Field option "${kind}.min" (${options.min}) must not exceed "${kind}.max" (${options.max}).`,
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

function makeField<TValue, TKind extends FieldKind, TOptions, TInsert>(
  kind: TKind,
  options: TOptions | undefined,
  extras: { ref?: () => AnyModel; values?: readonly string[] } = {},
): Field<TValue, TKind, TOptions, TInsert> {
  const field: {
    kind: TKind;
    options: TOptions;
    ref?: () => AnyModel;
    values?: readonly string[];
  } = { kind, options: (options ?? {}) as TOptions };
  if (extras.ref !== undefined) field.ref = extras.ref;
  if (extras.values !== undefined) field.values = extras.values;
  return field as Field<TValue, TKind, TOptions, TInsert>;
}

function stringField<
  const K extends "string" | "email" | "url",
  const O extends StringFieldOptions = Record<never, never>,
>(kind: K, options?: O): Field<Nullable<O, string>, K, O, Nullable<O, string>> {
  const resolved = asRecord(options) as StringFieldOptions;
  validateString(resolved, kind);
  return makeField<Nullable<O, string>, K, O, Nullable<O, string>>(kind, options);
}

/**
 * Field builders passed to `defineModel`. Every builder validates its options at definition time
 * and returns a {@link Field} whose TypeScript type flows into the model's row and insert types.
 */
export const fields = {
  /** A short text field. Stored as `TEXT`. */
  string: <const O extends StringFieldOptions = Record<never, never>>(options?: O) =>
    stringField("string", options),

  /** An email address. Stored as `TEXT`. */
  email: <const O extends StringFieldOptions = Record<never, never>>(options?: O) =>
    stringField("email", options),

  /** A URL. Stored as `TEXT`. */
  url: <const O extends StringFieldOptions = Record<never, never>>(options?: O) =>
    stringField("url", options),

  /** A slug, typically derived from another field. Stored as `TEXT`. */
  slug: <const O extends SlugFieldOptions = Record<never, never>>(options?: O) => {
    const resolved = asRecord(options) as SlugFieldOptions;
    validateString(resolved, "slug");
    if (resolved.from !== undefined) assertNonEmptyString(resolved.from, "slug.from");
    return makeField<Nullable<O, string>, "slug", O, Nullable<O, string>>("slug", options);
  },

  /** Long-form text. Stored as `TEXT`. Set `searchable: true` to index it with FTS5. */
  text: <const O extends TextFieldOptions = Record<never, never>>(options?: O) => {
    const resolved = asRecord(options) as TextFieldOptions;
    validateString(resolved, "text");
    if (resolved.searchable !== undefined) assertBoolean(resolved.searchable, "text.searchable");
    return makeField<Nullable<O, string>, "text", O, Nullable<O, string>>("text", options);
  },

  /** A whole number. Stored as `INTEGER`. */
  integer: <const O extends IntegerFieldOptions = Record<never, never>>(options?: O) => {
    const resolved = asRecord(options) as IntegerFieldOptions;
    validateCommon("integer", resolved);
    if (resolved.default !== undefined) assertInteger(resolved.default, "integer.default");
    if (resolved.min !== undefined) assertInteger(resolved.min, "integer.min");
    if (resolved.max !== undefined) assertInteger(resolved.max, "integer.max");
    return makeField<Nullable<O, number>, "integer", O, Nullable<O, number>>("integer", options);
  },

  /**
   * A fixed-point decimal stored as an `INTEGER` of minor units. `scale` is the number of decimal
   * places (default `2`, so `12.34` is stored as `1234`).
   */
  decimal: <const O extends DecimalFieldOptions = Record<never, never>>(options?: O) => {
    const resolved = asRecord(options) as DecimalFieldOptions;
    validateCommon("decimal", resolved);
    if (resolved.default !== undefined) assertNumber(resolved.default, "decimal.default");
    if (resolved.scale !== undefined) assertNonNegativeInteger(resolved.scale, "decimal.scale");
    if (resolved.scale !== undefined && (resolved.scale as number) > 9) {
      throw new ModelDefinitionError(
        'Field option "decimal.scale" must not exceed 9 to stay within JavaScript\'s safe integer range.',
      );
    }
    return makeField<Nullable<O, number>, "decimal", O, Nullable<O, number>>("decimal", options);
  },

  /** A boolean stored as `INTEGER` (`0` or `1`). */
  boolean: <const O extends BooleanFieldOptions = Record<never, never>>(options?: O) => {
    const resolved = asRecord(options) as BooleanFieldOptions;
    validateCommon("boolean", resolved);
    if (resolved.default !== undefined) assertBoolean(resolved.default, "boolean.default");
    return makeField<Nullable<O, boolean>, "boolean", O, Nullable<O, boolean>>("boolean", options);
  },

  /** A UTC timestamp stored as `INTEGER` epoch milliseconds and exposed as a `Date`. */
  datetime: <const O extends DateTimeFieldOptions = Record<never, never>>(options?: O) => {
    const resolved = asRecord(options) as DateTimeFieldOptions;
    validateCommon("datetime", resolved);
    if (resolved.default !== undefined && resolved.default !== "now") {
      const value = resolved.default;
      const valid = typeof value === "number" || value instanceof Date;
      if (!valid) {
        throw new ModelDefinitionError(
          'Field option "datetime.default" must be "now", a number (epoch ms) or a Date.',
        );
      }
    }
    return makeField<Nullable<O, Date>, "datetime", O, Nullable<O, Date | number>>(
      "datetime",
      options,
    );
  },

  /** A calendar date stored as a `YYYY-MM-DD` string. */
  date: <const O extends DateFieldOptions = Record<never, never>>(options?: O) => {
    const resolved = asRecord(options) as DateFieldOptions;
    validateCommon("date", resolved);
    if (resolved.default !== undefined) {
      assertString(resolved.default, "date.default");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(resolved.default)) {
        throw new ModelDefinitionError(
          'Field option "date.default" must be a "YYYY-MM-DD" string.',
        );
      }
    }
    return makeField<Nullable<O, string>, "date", O, Nullable<O, string>>("date", options);
  },

  /** A value from a fixed set. Stored as `TEXT` with a `CHECK` constraint. */
  choice: <
    const V extends readonly [string, ...string[]],
    const O extends ChoiceFieldOptions<V[number]> = Record<never, never>,
  >(
    values: V,
    options?: O,
  ) => {
    if (!Array.isArray(values) || values.length === 0) {
      throw new ModelDefinitionError("`fields.choice` requires at least one allowed value.");
    }
    const seen = new Set<string>();
    for (const value of values) {
      assertNonEmptyString(value, "choice");
      if (seen.has(value)) {
        throw new ModelDefinitionError(`Duplicate choice value "${value}".`);
      }
      seen.add(value);
    }
    const resolved = asRecord(options) as ChoiceFieldOptions;
    validateCommon("choice", resolved);
    if (resolved.default !== undefined) {
      assertNonEmptyString(resolved.default, "choice.default");
      if (!seen.has(resolved.default)) {
        throw new ModelDefinitionError(
          `Field option "choice.default" ("${resolved.default}") is not one of the allowed values.`,
        );
      }
    }
    return makeField<Nullable<O, V[number]>, "choice", O, Nullable<O, V[number]>>(
      "choice",
      options,
      { values },
    );
  },

  /** Arbitrary JSON stored as a serialized `TEXT` column. */
  json: <const T = unknown, const O extends JsonFieldOptions<T> = Record<never, never>>(
    options?: O,
  ) => {
    const resolved = asRecord(options) as JsonFieldOptions<T>;
    validateCommon("json", resolved);
    return makeField<Nullable<O, T>, "json", O, Nullable<O, T>>("json", options);
  },

  /** A reference to another model, stored as the target's `id`. */
  foreignKey: <M extends AnyModel, const O extends ForeignKeyFieldOptions = Record<never, never>>(
    target: () => M,
    options?: O,
  ) => {
    if (typeof target !== "function") {
      throw new ModelDefinitionError(
        "`fields.foreignKey` expects a lazy model reference, for example `() => Author`.",
      );
    }
    const resolved = asRecord(options) as ForeignKeyFieldOptions;
    validateCommon("foreignKey", resolved);
    if (resolved.onDelete !== undefined)
      assertReferentialAction(resolved.onDelete, "foreignKey.onDelete");
    if (resolved.onUpdate !== undefined)
      assertReferentialAction(resolved.onUpdate, "foreignKey.onUpdate");
    return makeField<Nullable<O, string>, "foreignKey", O, Nullable<O, string>>(
      "foreignKey",
      options,
      { ref: target as () => AnyModel },
    );
  },

  /** A many-to-many relation materialised as a join table. Adds no column to the model. */
  manyToMany: <M extends AnyModel, const O extends ManyToManyFieldOptions = Record<never, never>>(
    target: () => M,
    options?: O,
  ) => {
    if (typeof target !== "function") {
      throw new ModelDefinitionError(
        "`fields.manyToMany` expects a lazy model reference, for example `() => Tag`.",
      );
    }
    const resolved = asRecord(options) as ManyToManyFieldOptions;
    if (resolved.through !== undefined)
      assertNonEmptyString(resolved.through, "manyToMany.through");
    return makeField<never, "manyToMany", O, never>("manyToMany", options, {
      ref: target as () => AnyModel,
    });
  },

  /** A file stored in R2. The column holds the object key. */
  file: <const O extends FileFieldOptions = Record<never, never>>(options?: O) =>
    fileField("file", options),

  /** An image stored in R2. The column holds the object key. */
  image: <const O extends FileFieldOptions = Record<never, never>>(options?: O) =>
    fileField("image", options),
};

function fileField<
  const K extends "file" | "image",
  const O extends FileFieldOptions = Record<never, never>,
>(kind: K, options?: O): Field<Nullable<O, string>, K, O, Nullable<O, string>> {
  const resolved = asRecord(options) as FileFieldOptions;
  validateCommon(kind, resolved);
  if (resolved.maxSize !== undefined) assertPositiveInteger(resolved.maxSize, `${kind}.maxSize`);
  if (resolved.accept !== undefined) {
    if (!Array.isArray(resolved.accept)) {
      throw new ModelDefinitionError(
        `Field option "${kind}.accept" must be an array of MIME types.`,
      );
    }
    for (const mime of resolved.accept) assertNonEmptyString(mime, `${kind}.accept`);
  }
  return makeField<Nullable<O, string>, K, O, Nullable<O, string>>(kind, options);
}

function assertReferentialAction(value: unknown, label: string): void {
  const allowed: readonly string[] = ["cascade", "restrict", "set null", "no action"];
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new ModelDefinitionError(
      `Field option "${label}" must be one of ${allowed.map((a) => `"${a}"`).join(", ")}.`,
    );
  }
}
