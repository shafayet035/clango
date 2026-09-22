import type { FieldKind } from "./fields";

/** Input control the admin UI should render for a field. */
export type AdminWidget =
  | "text"
  | "email"
  | "url"
  | "slug"
  | "textarea"
  | "number"
  | "checkbox"
  | "datetime"
  | "date"
  | "select"
  | "json"
  | "relation"
  | "multiRelation"
  | "file"
  | "image";

/** How a related model is identified in the admin UI. */
export interface AdminRelationMeta {
  /** Qualified model name of the target, for example `blog.Author`. */
  readonly model: string;
  /** Field used as the human-readable label, when the model declares `display`. */
  readonly labelField?: string;
}

/** Everything the admin UI needs to render one field. */
export interface AdminFieldMeta {
  readonly name: string;
  readonly label: string;
  readonly kind: FieldKind;
  readonly widget: AdminWidget;
  /** Value must be supplied on create. */
  readonly required: boolean;
  /** Field accepts `null`. */
  readonly nullable: boolean;
  /** Field may be edited after creation. */
  readonly editable: boolean;
  readonly helpText?: string;
  readonly choices?: readonly string[];
  readonly maxLength?: number;
  /** Decimal places, for `decimal` fields. */
  readonly scale?: number;
  readonly related?: AdminRelationMeta;
}

/** A group of fields rendered together on the edit form. */
export interface AdminFieldsetMeta {
  readonly title: string;
  readonly description?: string;
  readonly fields: readonly string[];
}

/** A bulk action offered by the admin for a model. */
export interface AdminActionMeta {
  readonly name: string;
  readonly label: string;
  readonly description?: string;
}

/** Which operations the current user may perform on a model. */
export interface AdminModelPermissions {
  readonly view: boolean;
  readonly add: boolean;
  readonly change: boolean;
  readonly delete: boolean;
}

/** Everything the admin UI needs to render one model. */
export interface AdminModelMeta {
  /** Qualified model name, for example `blog.Post`. */
  readonly name: string;
  readonly appLabel: string;
  readonly modelName: string;
  readonly verboseName: string;
  readonly verboseNamePlural: string;
  /** Client-side route, for example `/admin/blog/post`. */
  readonly path: string;
  readonly fields: readonly AdminFieldMeta[];
  readonly listDisplay: readonly string[];
  readonly listFilter: readonly string[];
  readonly searchFields: readonly string[];
  /** Default ordering, using the same `-field` syntax as the REST API. */
  readonly ordering: readonly string[];
  readonly fieldsets: readonly AdminFieldsetMeta[];
  readonly readonlyFields: readonly string[];
  readonly actions: readonly AdminActionMeta[];
  /** Operations the current user may perform. */
  readonly permissions: AdminModelPermissions;
}

/** The identity the admin is acting as. `null` until authentication lands in M4. */
export interface AdminUser {
  readonly id: string;
  readonly isStaff: boolean;
  readonly isSuperuser: boolean;
}

/** The payload of `GET /admin/api/meta`. */
export interface AdminMeta {
  readonly models: readonly AdminModelMeta[];
  readonly user: AdminUser | null;
}
