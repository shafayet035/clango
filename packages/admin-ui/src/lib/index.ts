/**
 * Public surface of `@clango/admin-ui`.
 *
 * The package ships a prebuilt SPA for the common case, and these exports for an application that
 * needs custom widgets: import `mountAdminUi`, register widgets, and build your own bundle.
 */

export { mountAdminUi, type MountOptions } from "./mount";
export {
  clearWidgetRegistry,
  registerWidget,
  registeredWidgets,
  widgetByName,
  type WidgetComponent,
  type WidgetProps,
} from "./widgets";
