import { describe, expect, it } from "vitest";
import { getLegacySettingsDestination } from "./settings-redirect";
import type { ScopeContext } from "./scope-context";

const personal: ScopeContext = {
  kind: "personal",
  slug: "alex",
  profileId: "user-1",
};
const team: ScopeContext = { kind: "team", slug: "acme", teamId: "team-1" };

describe("legacy Settings destinations", () => {
  it.each([personal, team])(
    "preserves connection return messages in $kind scope",
    (scope) => {
      expect(
        getLegacySettingsDestination(
          scope,
          "tab=connections&sub=old&oauth=success&keep=1"
        )
      ).toBe(`/${scope.slug}/connections?oauth=success&keep=1`);
      expect(
        getLegacySettingsDestination(
          scope,
          "slack=connected&team=T123",
          "#connections"
        )
      ).toBe(`/${scope.slug}/connections?slack=connected&team=T123`);
      expect(getLegacySettingsDestination(scope, "", "#connections")).toBe(
        `/${scope.slug}/connections`
      );
    }
  );

  it("routes old provider callbacks without a tab", () => {
    expect(getLegacySettingsDestination(personal, "oauth=invalid_state")).toBe(
      "/alex/connections?oauth=invalid_state"
    );
    expect(
      getLegacySettingsDestination(personal, "slack=error&reason=denied")
    ).toBe("/alex/connections?slack=error&reason=denied");
  });

  it("keeps Models and Agents redirects and routes Team Models to its own Settings page", () => {
    expect(getLegacySettingsDestination(personal, "tab=models")).toBe(
      "/alex/models/catalog"
    );
    expect(getLegacySettingsDestination(personal, "", "#agents")).toBe(
      "/alex/agents/roster"
    );
    expect(getLegacySettingsDestination(team, "tab=models")).toBe(
      "/acme/settings/models"
    );
    expect(getLegacySettingsDestination(team, "", "#models")).toBe(
      "/acme/settings/models"
    );
  });

  it.each([
    ["", "/alex/settings/account"],
    ["tab=account", "/alex/settings/account"],
    ["tab=billing&billing=topup", "/alex/settings/billing?billing=topup"],
    ["tab=keys&sub=cli", "/alex/settings/mogplex-keys"],
    ["tab=keys&sub=api", "/alex/settings/keys"],
    ["tab=teams", "/alex/settings/teams"],
    ["tab=unknown", "/alex/settings/account"],
    ["tab=constructor", "/alex/settings/account"],
  ])("redirects retired tabs: %s", (query, expected) => {
    expect(getLegacySettingsDestination(personal, query)).toBe(expected);
  });

  it("keeps team settings scoped and handles hashes", () => {
    expect(getLegacySettingsDestination(team, "")).toBe(
      "/acme/settings/members"
    );
    expect(getLegacySettingsDestination(team, "tab=keys&sub=cli")).toBe(
      "/acme/settings/keys"
    );
    expect(getLegacySettingsDestination(team, "", "#audit")).toBe(
      "/acme/settings/audit"
    );
    expect(getLegacySettingsDestination(personal, "keep=1", "#keys")).toBe(
      "/alex/settings/keys?keep=1"
    );
    expect(getLegacySettingsDestination(personal, "billing=topup")).toBe(
      "/alex/settings/billing?billing=topup"
    );
  });
});
