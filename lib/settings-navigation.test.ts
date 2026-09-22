import { describe, expect, it } from "vitest";
import { buildSettingsNavItems } from "./settings-navigation";

describe("Settings navigation", () => {
  it("gives each personal section a scoped page", () => {
    expect(
      buildSettingsNavItems("alex", "personal").map((item) => item.href)
    ).toEqual([
      "/alex/settings/account",
      "/alex/settings/teams",
      "/alex/settings/keys",
      "/alex/settings/mogplex-keys",
      "/alex/settings/billing",
    ]);
  });
  it("keeps personal settings out of team navigation and hides audit from members", () => {
    expect(
      buildSettingsNavItems("acme", "team").map((item) => item.id)
    ).toEqual(["members", "keys", "models", "billing"]);
    expect(
      buildSettingsNavItems("acme", "team", true).map((item) => item.id)
    ).toEqual(["members", "keys", "models", "audit", "billing"]);
  });
});
