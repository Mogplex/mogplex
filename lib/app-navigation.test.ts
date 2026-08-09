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
      ["workspaces", "Repositories", "/projects/repositories"],
      ["automations", "Automations", "/automations"],
      ["sandboxes", "Sandboxes", "/projects/repositories/sandboxes"],
      ["delivery", "Delivery", "/delivery"],
      ["observe", "Observe", "/observability"],
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
    const repositories = items.find((item) => item.id === "workspaces");

    expect(repositories?.href).toBe("/acme/projects/repositories");
    expect(repositories?.match).toEqual([
      "/acme/projects/repositories",
      "/acme/projects/workspace",
      "/acme/workspaces",
    ]);
  });

  it("matches descendants except the repositories root", () => {
    expect(isAppNavItemActive("/acme/settings/profile", "/acme/settings")).toBe(
      true
    );
    expect(
      isAppNavItemActive(
        "/acme/projects/repositories/sandboxes",
        "/acme/projects/repositories"
      )
    ).toBe(false);
    expect(
      isAppNavItemActive(
        "/acme/projects/repositories",
        "/acme/projects/repositories"
      )
    ).toBe(true);
  });
});
