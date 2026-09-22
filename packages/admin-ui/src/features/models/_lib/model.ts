import type { AdminFieldMeta, AdminMeta, AdminModelMeta } from "@clango/core";
import { toSnakeCase } from "@clango/core";

/**
 * Model identity helpers.
 *
 * Routes carry the app label and the model segment (`/admin/blog/post`), which together form the
 * key the admin API expects (`blog/post`). Everything derives from these two functions so a model's
 * URL, query keys and API paths can never drift apart.
 */

/** Admin API key for a qualified model name: `blog.Post` becomes `blog/post`. */
export function modelKeyOf(qualifiedName: string): string {
  const [appLabel = "", model = ""] = qualifiedName.split(".");
  return `${appLabel}/${toSnakeCase(model)}`;
}

/** Admin API key for model metadata. */
export function keyOfModel(model: AdminModelMeta): string {
  return `${model.appLabel}/${model.path.split("/").pop() ?? ""}`;
}

/** Finds a model by the route's app label and model segment. */
export function findModel(
  meta: AdminMeta | undefined,
  appLabel: string | undefined,
  model: string | undefined,
): AdminModelMeta | undefined {
  if (meta === undefined || appLabel === undefined || model === undefined) return undefined;
  const key = `${appLabel}/${model}`;
  return meta.models.find((candidate) => keyOfModel(candidate) === key);
}

/** Looks up a field's metadata by name. */
export function fieldOf(model: AdminModelMeta, name: string): AdminFieldMeta | undefined {
  return model.fields.find((field) => field.name === name);
}

/** Relation fields shown in the list view, which need their labels resolved. */
export function relationFields(model: AdminModelMeta): readonly AdminFieldMeta[] {
  return model.listDisplay
    .map((name) => fieldOf(model, name))
    .filter((field): field is AdminFieldMeta => field?.widget === "relation");
}

/** Fields the admin can write to, in the order the edit form should show them. */
export function editableFields(model: AdminModelMeta): readonly AdminFieldMeta[] {
  const inFieldsets = new Set(model.fieldsets.flatMap((fieldset) => [...fieldset.fields]));
  const listed = model.fieldsets
    .flatMap((fieldset) => fieldset.fields)
    .map((name) => fieldOf(model, name))
    .filter((field): field is AdminFieldMeta => field?.editable === true);
  const unlisted = model.fields.filter((field) => field.editable && !inFieldsets.has(field.name));
  return [...listed, ...unlisted];
}
