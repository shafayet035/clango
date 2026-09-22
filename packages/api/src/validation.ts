import type { AnyModel, Field, FieldKind } from "@clango/core";
import { z } from "zod";

/** Zod schemas generated from a model definition. */
export interface ValidationSchemas {
  readonly create: z.ZodType;
  readonly update: z.ZodType;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function boundedString(field: Field): z.ZodType {
  const options = field.options as { min?: number; max?: number };
  let schema = z.string();
  if (options.min !== undefined) schema = schema.min(options.min);
  if (options.max !== undefined) schema = schema.max(options.max);
  return schema;
}

function datetimeSchema(): z.ZodType {
  return z
    .union([z.string(), z.number().int()])
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message: "Expected an ISO 8601 timestamp or epoch milliseconds.",
    })
    .transform((value) => new Date(value));
}

/** Builds the validation schema for one field, before optionality is applied. */
function baseSchema(field: Field): z.ZodType {
  switch (field.kind) {
    case "string":
      return boundedString(field);
    case "email":
      return z.email();
    case "url":
      return z.url();
    case "slug":
      return z.string().regex(SLUG, "Slugs are lowercase words separated by hyphens.");
    case "text":
      return z.string();
    case "integer":
      return z.number().int();
    case "decimal":
      return z.number().finite();
    case "boolean":
      return z.boolean();
    case "datetime":
      return datetimeSchema();
    case "date":
      return z.string().regex(DATE, "Dates are formatted as YYYY-MM-DD.");
    case "choice":
      return z.enum((field.values ?? []) as unknown as [string, ...string[]]);
    case "json":
      return z.unknown();
    case "foreignKey":
      return z.string().min(1);
    case "file":
    case "image":
      return z.string().min(1);
    case "manyToMany":
      throw new Error("manyToMany fields are not part of an API payload.");
  }
}

function isNullable(kind: FieldKind): boolean {
  return kind !== "manyToMany";
}

/**
 * Generates the Zod schemas used to validate request bodies for a model.
 *
 * Create accepts every column, makes optional and defaulted fields optional, and allows a
 * client-supplied `id` so records can be imported idempotently. Update accepts the same columns but
 * everything is optional, and `id`, `createdAt` and `updatedAt` are rejected because Clango manages
 * them. Both schemas are strict, so unknown keys are an error rather than being silently dropped.
 */
export function buildValidation(model: AnyModel): ValidationSchemas {
  const createShape: Record<string, z.ZodType> = {};
  const updateShape: Record<string, z.ZodType> = {};

  for (const [property, field] of Object.entries(model.fields)) {
    if (field.kind === "manyToMany") continue;
    const options = field.options as { optional?: boolean; default?: unknown };
    const optional = options.optional === true;
    const hasDefault = options.default !== undefined;
    const base = baseSchema(field);

    let create = base;
    if (optional && isNullable(field.kind)) create = create.nullable();
    if (optional || hasDefault) create = create.optional();
    createShape[property] = create;

    let update = base;
    if (optional && isNullable(field.kind)) update = update.nullable();
    updateShape[property] = update.optional();
  }

  createShape["id"] = z.string().min(1).optional();

  return {
    create: z.strictObject(createShape),
    update: z.strictObject(updateShape),
  };
}
