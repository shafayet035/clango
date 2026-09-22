import {
  ADMIN_LOG_MODEL_NAME,
  automaticField,
  collectRegistry,
  permissionCodename,
  PERMISSION_ACTIONS,
  searchableFields,
  toSnakeCase,
  type AdminFieldMeta,
  type AdminModelPermissions,
  type PermissionCodename,
  type AdminFieldsetMeta,
  type AdminMeta,
  type AdminModelMeta,
  type AdminUser,
  type AdminWidget,
  type AnyModel,
  type ClangoConfig,
  type Field,
  type FieldKind,
  type Registry,
} from "@clango/core";

import { adminConfigFor } from "./registry";

const WIDGETS: Readonly<Record<FieldKind, AdminWidget>> = {
  string: "text",
  email: "email",
  url: "url",
  slug: "slug",
  text: "textarea",
  integer: "number",
  decimal: "number",
  boolean: "checkbox",
  datetime: "datetime",
  date: "date",
  choice: "select",
  json: "json",
  foreignKey: "relation",
  manyToMany: "multiRelation",
  file: "file",
  image: "image",
};

const AUTOMATIC = ["id", "createdAt", "updatedAt"] as const;

/** Client-side route for a model, for example `/admin/blog/post`. */
export function adminPathFor(model: AnyModel): string {
  return `/admin/${adminKeyFor(model)}`;
}

/** Path segment that identifies a model in admin API URLs, for example `blog/post`. */
export function adminKeyFor(model: AnyModel): string {
  return `${model.appLabel}/${toSnakeCase(model.modelName)}`;
}

/** Turns `publishedAt` into `Published at`. */
export function humanize(property: string): string {
  const words = property.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" ");
  return words
    .map((word, index) =>
      index === 0 ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word.toLowerCase(),
    )
    .join(" ");
}

/** Property names of every column a model owns, excluding many-to-many relations. */
export function columnsOf(model: AnyModel): readonly string[] {
  return Object.entries(model.fields)
    .filter(([, field]) => field.kind !== "manyToMany")
    .map(([property]) => property);
}

/**
 * Field used to label a row in pickers and the audit log.
 *
 * `display` is a function and cannot be used to build SQL, so `meta.labelField` is the declared
 * answer; without one the admin falls back to `id`.
 */
export function labelFieldOf(model: AnyModel): string {
  return model.meta.labelField ?? "id";
}

function optionsOf(field: Field): Record<string, unknown> {
  return (field.options ?? {}) as Record<string, unknown>;
}

function buildFieldMeta(
  property: string,
  field: Field,
  readonly: boolean,
  customWidget?: string,
): AdminFieldMeta {
  const options = optionsOf(field);
  const meta: {
    name: string;
    label: string;
    kind: FieldKind;
    widget: AdminWidget;
    customWidget?: string;
    required: boolean;
    nullable: boolean;
    editable: boolean;
    helpText?: string;
    choices?: readonly string[];
    maxLength?: number;
    scale?: number;
    related?: { model: string; labelField?: string };
  } = {
    name: property,
    label: (options["label"] as string | undefined) ?? humanize(property),
    kind: field.kind,
    widget: WIDGETS[field.kind],
    required: options["optional"] !== true && options["default"] === undefined,
    nullable: options["optional"] === true,
    editable: !readonly,
  };

  if (customWidget !== undefined) meta.customWidget = customWidget;
  if (typeof options["helpText"] === "string") meta.helpText = options["helpText"];
  if (field.values !== undefined) meta.choices = field.values;
  if (typeof options["max"] === "number" && field.kind !== "text") {
    meta.maxLength = options["max"];
  }
  if (field.kind === "decimal") {
    meta.scale = typeof options["scale"] === "number" ? options["scale"] : 2;
  }
  const target = field.ref?.();
  if (target !== undefined) {
    meta.related = {
      model: target.name,
      ...(target.meta.labelField === undefined ? {} : { labelField: target.meta.labelField }),
    };
  }
  return meta;
}

function defaultListDisplay(model: AnyModel): readonly string[] {
  return columnsOf(model)
    .filter((property) => {
      const kind = (model.fields[property] as Field).kind;
      return kind !== "text" && kind !== "json";
    })
    .slice(0, 5);
}

function defaultListFilter(model: AnyModel): readonly string[] {
  return columnsOf(model).filter((property) => {
    const kind = (model.fields[property] as Field).kind;
    return kind === "choice" || kind === "boolean" || kind === "foreignKey";
  });
}

/** Predicate deciding whether the current user holds a permission. */
export type Allows = (codename: PermissionCodename) => boolean;

const ALLOW_ALL: Allows = () => true;

function permissionsFor(model: AnyModel, allows: Allows): AdminModelPermissions {
  const allowed = new Set(
    PERMISSION_ACTIONS.filter((action) => allows(permissionCodename(model, action))),
  );
  return {
    view: allowed.has("view"),
    add: allowed.has("add"),
    change: allowed.has("change"),
    delete: allowed.has("delete"),
  };
}

function buildModelMeta(model: AnyModel, allows: Allows): AdminModelMeta {
  const config = adminConfigFor(model);
  const readonly = new Set(config.readonlyFields ?? []);

  const fields: readonly AdminFieldMeta[] = [
    ...columnsOf(model).map((property) =>
      buildFieldMeta(
        property,
        model.fields[property] as Field,
        readonly.has(property),
        config.widgets?.[property],
      ),
    ),
    ...AUTOMATIC.map((property) => {
      const field = automaticField(property);
      if (field === undefined) throw new Error(`Missing automatic field "${property}".`);
      return buildFieldMeta(property, field, true);
    }),
  ];

  const fieldsets: readonly AdminFieldsetMeta[] =
    config.fieldsets === undefined
      ? [{ title: "Details", fields: columnsOf(model) }]
      : config.fieldsets.map((fieldset) => ({
          title: fieldset.title,
          fields: [...fieldset.fields],
          ...(fieldset.description === undefined ? {} : { description: fieldset.description }),
        }));

  const searchFields = config.searchFields ?? searchableFields(model);
  const verboseName =
    config.verboseName ?? model.meta.verboseName ?? humanize(model.modelName).toLowerCase();

  return {
    name: model.name,
    appLabel: model.appLabel,
    modelName: model.modelName,
    verboseName,
    verboseNamePlural:
      config.verboseNamePlural ??
      model.meta.verboseNamePlural ??
      `${humanize(model.modelName).toLowerCase()}s`,
    path: adminPathFor(model),
    fields,
    listDisplay: config.listDisplay ?? defaultListDisplay(model),
    listFilter: config.listFilter ?? defaultListFilter(model),
    searchFields,
    ordering: config.ordering ?? model.meta.ordering ?? ["-createdAt"],
    fieldsets,
    readonlyFields: config.readonlyFields ?? [],
    permissions: permissionsFor(model, allows),
    actions: (config.actions ?? []).map((action) => ({
      name: action.name,
      label: action.label,
      ...(action.description === undefined ? {} : { description: action.description }),
    })),
  };
}

/**
 * Builds the admin metadata for every registered model.
 *
 * Framework tables (the admin log) and models hidden with `registerAdmin(..., { hidden: true })` are
 * excluded. `user` is `null` until authentication lands in M4, at which point this function becomes
 * the place where permissions filter the model and field lists.
 */
export function buildMeta(
  config: ClangoConfig,
  options: {
    readonly user?: AdminUser | null;
    readonly registry?: Registry;
    /** Defaults to allowing everything, which is the behaviour when auth is disabled. */
    readonly allows?: Allows;
  } = {},
): AdminMeta {
  const registry = options.registry ?? collectRegistry(config);
  const allows = options.allows ?? ALLOW_ALL;
  const models = registry.models
    .map((entry) => entry.model)
    .filter((model) => model.name !== ADMIN_LOG_MODEL_NAME)
    .filter((model) => adminConfigFor(model).hidden !== true)
    // A model the user cannot read is invisible: no sidebar entry, no fields, no hint it exists.
    .filter((model) => allows(permissionCodename(model, "view")))
    .map((model) => buildModelMeta(model, allows));

  return { models, user: options.user ?? null };
}
