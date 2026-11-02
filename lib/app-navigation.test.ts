import { describe, expect, it } from "vitest";
import {
  APP_NAV_ITEM_DEFS,
  buildAppNavItems,
  isAppNavItemActive,
} from "./app-navigation";

describe("app navigation", () => {
  it("exposes the Mogplex shell route order and labels", () => {
    expect(
      APP_NAV_ITEM_DEFS.map((item) => [item.id, item.label, item.path])
    ).toEqual([
      ["control", "Command Center", "/control"],
      ["automations", "Automations", "/automations"],
      ["sandboxes", "Sandboxes", "/sandboxes"],
      ["delivery", "Delivery", "/delivery"],
      ["observe", "Observe", "/observability"],
      ["agents", "Agents", "/agents/roster"],
      ["models", "Models", "/models"],
      ["connections", "Connections", "/connections"],
      ["settings", "Settings", "/settings"],
    ]);
  });

  it("places settings alone in the admin section", () => {
    expect(
      APP_NAV_ITEM_DEFS.filter((item) => item.section === "admin").map(
        (item) => item.id
      )
    ).toEqual(["settings"]);
    expect(
      APP_NAV_ITEM_DEFS.every(
        (item) => item.section === "primary" || item.section === "admin"
      )
    ).toBe(true);
  });

  it("scopes href and match paths", () => {
    const items = buildAppNavItems("acme");
    const control = items.find((item) => item.id === "control");

    expect(control?.href).toBe("/acme/control");
    expect(control?.match).toEqual([
      "/acme/control",
      "/acme/projects/workspace",
      "/acme/workspaces",
    ]);
  });

  it("matches a destination and its descendants", () => {
    expect(isAppNavItemActive("/acme/settings/profile", "/acme/settings")).toBe(
      true
    );
    expect(isAppNavItemActive("/acme/settingsx", "/acme/settings")).toBe(false);
  });

  it("selects only the destination that owns repositories or sandboxes", () => {
    const items = buildAppNavItems("acme");
    for (const [path, id] of [
      ["/acme/projects/workspace", "control"],
      ["/acme/sandboxes", "sandboxes"],
      ["/acme/sandboxes/record-1", "sandboxes"],
      ["/acme/models/catalog", "models"],
      ["/acme/connections", "connections"],
      ["/acme/models/configuration", "models"],
      ["/acme/agents/roster", "agents"],
      ["/acme/agents/context", "agents"],
      ["/acme/settings/billing", "settings"],
    ]) {
      expect(
        items
          .filter((item) => isAppNavItemActive(path, item.match))
          .map((item) => item.id)
      ).toEqual([id]);
    }
  });
});
