import type { AdminFieldMeta } from "@/features/meta/_types";

/**
 * Conversions between API values and HTML form values. Pure and DOM-free so they can be unit tested.
 *
 * Timestamps use `datetime-local` inputs, which hold wall-clock time with no zone. Conversion goes
 * through the local `Date` components, so a value written in the browser round-trips at the same
 * wall-clock time.
 */

/** The value an input element holds. */
export type FormValue = string | boolean;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Formats a `Date` as the `YYYY-MM-DDTHH:mm` an `datetime-local` input expects (local time). */
export function toLocalInput(value: Date): string {
  return (
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` +
    `T${pad(value.getHours())}:${pad(value.getMinutes())}`
  );
}

/** Parses an `datetime-local` value back into an ISO 8601 string. */
export function fromLocalInput(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("Expected a valid date and time.");
  return parsed.toISOString();
}

/** Renders an API value into what the control expects. */
export function toFormValue(field: AdminFieldMeta, value: unknown): FormValue {
  if (field.widget === "checkbox") return value === true;
  if (value === null || value === undefined) return "";
  switch (field.widget) {
    case "datetime": {
      const date = value instanceof Date ? value : new Date(value as string | number);
      return Number.isNaN(date.getTime()) ? "" : toLocalInput(date);
    }
    case "json":
      return JSON.stringify(value, null, 2);
    default:
      return String(value);
  }
}

/** The value a newly created row's control should start with. */
export function emptyFormValue(field: AdminFieldMeta): FormValue {
  return field.widget === "checkbox" ? false : "";
}

/**
 * Converts a control value back into the value the API expects.
 *
 * Empty inputs become `null` for nullable fields and stay empty for required ones, so the client
 * never invents a value the server would accept but a person did not mean.
 */
export function fromFormValue(field: AdminFieldMeta, value: FormValue): unknown {
  if (field.widget === "checkbox") return value === true;

  const text = typeof value === "string" ? value : String(value);
  if (text.trim().length === 0) return field.nullable ? null : "";

  switch (field.widget) {
    case "number": {
      const parsed = Number(text);
      if (!Number.isFinite(parsed)) throw new Error(`${field.label} must be a number.`);
      return parsed;
    }
    case "json": {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new Error(`${field.label} must be valid JSON.`);
      }
    }
    case "datetime":
      try {
        return fromLocalInput(text);
      } catch {
        throw new Error(`${field.label} must be a valid date and time.`);
      }
    default:
      return text;
  }
}

function isEmpty(field: AdminFieldMeta, value: FormValue | undefined): boolean {
  if (field.widget === "checkbox") return false;
  return value === undefined || String(value).trim().length === 0;
}

/** Labels of required fields the form left empty. */
export function validateRequired(
  fields: readonly AdminFieldMeta[],
  values: Readonly<Record<string, FormValue>>,
): readonly string[] {
  return fields
    .filter((field) => field.editable && field.required && isEmpty(field, values[field.name]))
    .map((field) => field.label);
}

/**
 * Request body for a create.
 *
 * Empty optional fields are omitted rather than sent as `null`, so column defaults declared in the
 * model still apply and a blank input does not overwrite them.
 */
export function buildCreatePayload(
  fields: readonly AdminFieldMeta[],
  values: Readonly<Record<string, FormValue>>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    if (!field.editable || !(field.name in values)) continue;
    if (!field.required && isEmpty(field, values[field.name])) continue;
    payload[field.name] = fromFormValue(field, values[field.name] as FormValue);
  }
  return payload;
}

/** Request body for an update. Every editable field is written, so blanking a field clears it. */
export function buildUpdatePayload(
  fields: readonly AdminFieldMeta[],
  values: Readonly<Record<string, FormValue>>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    if (!field.editable || !(field.name in values)) continue;
    payload[field.name] = fromFormValue(field, values[field.name] as FormValue);
  }
  return payload;
}

/** Fills form state from a row returned by the API. */
export function valuesFromRow(
  fields: readonly AdminFieldMeta[],
  row: Readonly<Record<string, unknown>>,
): Record<string, FormValue> {
  const values: Record<string, FormValue> = {};
  for (const field of fields) values[field.name] = toFormValue(field, row[field.name]);
  return values;
}
