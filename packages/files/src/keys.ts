import { toSnakeCase, type AnyModel } from "@clango/core";

/**
 * Object keys are the only thing the database stores about a file, so their shape is part of the
 * contract: `<app>/<model>/<record id>/<uuid>-<filename>`. The prefix makes it possible to find
 * every file a record owns — which is what cleanup needs — and the uuid stops two uploads of the
 * same filename from overwriting each other.
 */

/** Characters that are safe in a key segment. */
const UNSAFE = /[^a-zA-Z0-9._-]+/g;

/** Reduces a filename to a safe, informative last segment. */
export function sanitizeFilename(filename: string): string {
  const trimmed = filename.split(/[\\/]/).pop() ?? "";
  const cleaned = trimmed
    .replace(UNSAFE, "-")
    .replace(/^[-.]+/, "")
    .slice(0, 120);
  return cleaned.length === 0 ? "file" : cleaned;
}

/** Key prefix that owns every file for a model, for example `blog/post/`. */
export function modelPrefixFor(model: AnyModel): string {
  return `${model.appLabel}/${toSnakeCase(model.modelName)}/`;
}

/** Key prefix that owns every file for a record, for example `blog/post/01H/`. */
export function filePrefixFor(model: AnyModel, recordId: string): string {
  return `${modelPrefixFor(model)}${recordId}/`;
}

/** Options for {@link buildFileKey}. */
export interface FileKeyOptions {
  readonly model: AnyModel;
  readonly recordId: string;
  readonly filename: string;
  /** Defaults to a random v4 UUID. */
  readonly uuid?: string;
}

/** Builds the object key for a new upload. */
export function buildFileKey(options: FileKeyOptions): string {
  const uuid = options.uuid ?? crypto.randomUUID();
  return `${filePrefixFor(options.model, options.recordId)}${uuid}-${sanitizeFilename(options.filename)}`;
}

/** Parsed identity of a stored file. */
export interface ParsedFileKey {
  readonly appLabel: string;
  readonly model: string;
  readonly recordId: string;
  readonly filename: string;
}

/**
 * Parses a key back into the record it belongs to.
 *
 * Returns `null` for anything that does not match the expected shape, so a hand-crafted key cannot
 * make the download route look up an arbitrary model.
 */
export function parseFileKey(key: string): ParsedFileKey | null {
  const parts = key.split("/");
  if (parts.length !== 4) return null;
  const [appLabel, model, recordId, filename] = parts as [string, string, string, string];
  if ([appLabel, model, recordId, filename].some((part) => part.length === 0)) return null;
  if (parts.some((part) => part === "." || part === "..")) return null;
  return { appLabel, model, recordId, filename };
}

/** Returns `true` when `key` belongs to the given record. */
export function keyBelongsTo(key: string, model: AnyModel, recordId: string): boolean {
  return key.startsWith(filePrefixFor(model, recordId));
}

/** The field names of a model that store file keys. */
export function fileFieldsOf(model: AnyModel): readonly string[] {
  return Object.entries(model.fields)
    .filter(([, field]) => field.kind === "file" || field.kind === "image")
    .map(([property]) => property);
}
