import { describe, expect, it, beforeEach } from "vitest";

import {
  clearWidgetRegistry,
  registerWidget,
  registeredWidgets,
  widgetByName,
} from "../src/lib/widgets";

const component = () => null;

beforeEach(() => {
  clearWidgetRegistry();
});

describe("widget registry", () => {
  it("returns nothing for an unregistered name", () => {
    expect(widgetByName("markdown")).toBeUndefined();
  });

  it("registers and looks up a widget", () => {
    registerWidget("markdown", component);
    expect(widgetByName("markdown")).toBe(component);
    expect([...registeredWidgets().keys()]).toEqual(["markdown"]);
  });

  it("replaces a widget registered under the same name", () => {
    const replacement = () => null;
    registerWidget("markdown", component);
    registerWidget("markdown", replacement);
    expect(widgetByName("markdown")).toBe(replacement);
  });

  it("rejects an empty name", () => {
    expect(() => registerWidget("  ", component)).toThrow();
  });

  it("clears every registration", () => {
    registerWidget("markdown", component);
    clearWidgetRegistry();
    expect(widgetByName("markdown")).toBeUndefined();
  });
});
