import {
  AUTOMATIC_FIELDS,
  ModelDefinitionError,
  resolveField,
  type AnyModel,
  type Field,
} from "@clango/core";
import type { Enqueuer } from "@clango/tasks";
import type { DrizzleD1Database } from "drizzle-orm/d1";

/** Context handed to an admin action handler. */
export interface AdminActionContext {
  readonly model: AnyModel;
  /** Id of the staff user running the action, or `null` when auth is disabled. */
  readonly userId: string | null;
  readonly db: DrizzleD1Database;
  /**
   * Sends a registered task to the Queues producer.
   *
   * Present only when `tasks.binding` is configured. An action that may exceed the Worker CPU budget
   * should hand work to a task rather than doing it in the request — and should prefer a query
   * descriptor over an id list, so the payload does not grow with the selection (D-011).
   */
  readonly enqueue?: Enqueuer;
}

/** A bulk action offered in the admin list view. */
export interface AdminAction {
  readonly name: string;
  readonly label: string;
  readonly description?: string;
  /**
   * Runs the action over the selected ids. Values for `ids` are ordered, de-duplicated and capped.
   * Long-running work must be handed to Queues by the handler (M5).
   */
  readonly handler: (ids: readonly string[], context: AdminActionContext) => Promise<void> | void;
}

/** A group of fields rendered together on the edit form. */
export interface AdminFieldset {
  readonly title: string;
  readonly description?: string;
  readonly fields: readonly string[];
}

/** Per-model admin configuration passed to {@link registerAdmin}. */
export interface ModelAdminConfig {
  /** Columns shown in the list view. Defaults to the first few editable columns. */
  readonly listDisplay?: readonly string[];
  /** Columns offered as filters. Defaults to choice, boolean and relation columns. */
  readonly listFilter?: readonly string[];
  /** Columns searched by the admin search box. Defaults to the model's searchable fields. */
  readonly searchFields?: readonly string[];
  /** Columns shown but never editable. */
  readonly readonlyFields?: readonly string[];
  /**
   * Names of custom widgets to render for specific fields.
   *
   * The name is opaque to the server: it is passed through in the metadata and looked up in the SPA's
   * widget registry, which falls back to the built-in control when nothing is registered (D-059).
   */
  readonly widgets?: Readonly<Record<string, string>>;
  /** Groups the edit form. Defaults to a single fieldset with every editable column. */
  readonly fieldsets?: readonly AdminFieldset[];
  /** Default list ordering. Defaults to the model's `meta.ordering`. */
  readonly ordering?: readonly string[];
  readonly verboseName?: string;
  readonly verboseNamePlural?: string;
  readonly actions?: readonly AdminAction[];
  /** Excludes the model from the admin entirely. */
  readonly hidden?: boolean;
}

const registry = new Map<string, ModelAdminConfig>();

function assertFields(model: AnyModel, config: ModelAdminConfig): void {
  const groups: readonly [string, readonly string[] | undefined][] = [
    ["listDisplay", config.listDisplay],
    ["listFilter", config.listFilter],
    ["searchFields", config.searchFields],
    ["readonlyFields", config.readonlyFields],
    ["ordering", config.ordering?.map((entry) => entry.replace(/^-/, ""))],
  ];
  for (const [name, properties] of groups) {
    for (const property of properties ?? []) {
      if (resolveField(model.fields, property) === undefined) {
        throw new ModelDefinitionError(
          `Model "${model.name}" admin ${name} references "${property}", which is not a field.`,
        );
      }
    }
  }
  for (const property of Object.keys(config.widgets ?? {})) {
    if (resolveField(model.fields, property) === undefined) {
      throw new ModelDefinitionError(
        `Model "${model.name}" admin widgets references "${property}", which is not a field.`,
      );
    }
  }
  for (const fieldset of config.fieldsets ?? []) {
    for (const property of fieldset.fields) {
      if (resolveField(model.fields, property) === undefined) {
        throw new ModelDefinitionError(
          `Model "${model.name}" admin fieldset "${fieldset.title}" references "${property}", which is not a field.`,
        );
      }
    }
  }
  const names = new Set<string>();
  for (const action of config.actions ?? []) {
    if (names.has(action.name)) {
      throw new ModelDefinitionError(
        `Model "${model.name}" declares action "${action.name}" twice.`,
      );
    }
    if (!/^[a-z][a-z0-9_]*$/.test(action.name)) {
      throw new ModelDefinitionError(
        `Model "${model.name}" action name "${action.name}" must be lower_snake_case.`,
      );
    }
    names.add(action.name);
  }
}

/**
 * Registers admin customisation for a model. Models need no registration to appear in the admin —
 * registering one customises how it is displayed.
 *
 * Registration is process-wide, matching how model definitions are module-level constants. Tests can
 * clear it with {@link clearAdminRegistry}.
 */
export function registerAdmin(model: AnyModel, config: ModelAdminConfig = {}): void {
  if (typeof model !== "object" || model === null || model.kind !== "model") {
    throw new ModelDefinitionError("registerAdmin requires a model created by defineModel.");
  }
  assertFields(model, config);
  registry.set(model.name, config);
}

/** Returns the admin configuration for a model, or an empty configuration. */
export function adminConfigFor(model: AnyModel): ModelAdminConfig {
  return registry.get(model.name) ?? {};
}

/** Every registered model, keyed by qualified name. */
export function registeredAdmins(): ReadonlyMap<string, ModelAdminConfig> {
  return registry;
}

/** Removes every registration. Intended for tests. */
export function clearAdminRegistry(): void {
  registry.clear();
}

/** Field names the admin may write to: everything except the automatic columns. */
export function editableFields(model: AnyModel): readonly string[] {
  return Object.entries(model.fields)
    .filter(([, field]: [string, Field]) => field.kind !== "manyToMany")
    .map(([property]) => property);
}

/** Returns `true` when the property is one of the automatically managed columns. */
export function isAutomatic(property: string): boolean {
  return (AUTOMATIC_FIELDS as readonly string[]).includes(property);
}
