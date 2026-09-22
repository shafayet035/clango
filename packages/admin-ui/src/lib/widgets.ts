import type { ReactElement } from "react";

import type { AdminFieldMeta } from "@/features/meta/_types";
import type { FormValue } from "@/features/form/_lib/values";

/**
 * Custom admin widgets.
 *
 * A model can name a widget per field (`registerAdmin(Model, { widgets: { body: "markdown" } })`);
 * the server passes the name through untouched and the SPA looks it up here. Nothing registered means
 * the built-in control is used, so a stale name degrades rather than breaking the form.
 */

/** Props every widget receives, matching the built-in controls. */
export interface WidgetProps {
  readonly field: AdminFieldMeta;
  readonly value: FormValue;
  readonly onChange: (value: FormValue) => void;
  readonly disabled?: boolean;
}

/** A custom widget component. */
export type WidgetComponent = (props: WidgetProps) => ReactElement | null;

const registry = new Map<string, WidgetComponent>();

/** Registers a widget under the name a model refers to it by. */
export function registerWidget(name: string, component: WidgetComponent): void {
  if (name.trim().length === 0) throw new Error("A widget name must not be empty.");
  registry.set(name, component);
}

/** Looks up a registered widget. */
export function widgetByName(name: string): WidgetComponent | undefined {
  return registry.get(name);
}

/** Every registered widget, for diagnostics. */
export function registeredWidgets(): ReadonlyMap<string, WidgetComponent> {
  return registry;
}

/** Removes every registration. Intended for tests. */
export function clearWidgetRegistry(): void {
  registry.clear();
}
