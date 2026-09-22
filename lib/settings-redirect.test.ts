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

  it("keeps personal Models and Agents redirects and leaves Team Models in Settings", () => {
    expect(getLegacySettingsDestination(personal, "tab=models")).toBe(
      "/alex/models/catalog"
    );
    expect(getLegacySettingsDestination(personal, "", "#agents")).toBe(
      "/alex/agents/roster"
    );
    expect(getLegacySettingsDestination(team, "tab=models")).toBeNull();
    expect(getLegacySettingsDestination(team, "", "#models")).toBeNull();
  });

  it.each(["", "tab=account", "tab=billing", "tab=unknown", "tab=constructor"])(
    "leaves ordinary Settings alone: %s",
    (query) => {
      expect(getLegacySettingsDestination(personal, query)).toBeNull();
    }
  );
});
