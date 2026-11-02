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
      "/alex/settings/repositories",
      "/alex/settings/billing",
    ]);
  });
  it("keeps personal settings out of team navigation and hides audit from members", () => {
    expect(
      buildSettingsNavItems("acme", "team").map((item) => item.id)
    ).toEqual(["members", "keys", "models", "repositories", "billing"]);
    expect(
      buildSettingsNavItems("acme", "team", true).map((item) => item.id)
    ).toEqual([
      "members",
      "keys",
      "models",
      "audit",
      "repositories",
      "billing",
    ]);
  });
  it("hides Billing in personal and team navigation on self-hosted deployments", () => {
    expect(
      buildSettingsNavItems("alex", "personal", false, {
        hideBilling: true,
      }).map((item) => item.id)
    ).toEqual(["account", "teams", "keys", "mogplex-keys", "repositories"]);
    expect(
      buildSettingsNavItems("acme", "team", true, { hideBilling: true }).map(
        (item) => item.id
      )
    ).toEqual(["members", "keys", "models", "audit", "repositories"]);
  });
});
