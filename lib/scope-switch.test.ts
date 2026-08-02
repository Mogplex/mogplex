import { describe, expect, it } from "vitest";
import { switchScopePath } from "./scope-switch";

describe("switchScopePath", () => {
  it("returns the new scope root when current path is /", () => {
    expect(switchScopePath("/", "charles", "acme")).toBe("/acme");
  });

  it("swaps the leading scope segment", () => {
    expect(
      switchScopePath("/charles/projects/workspace", "charles", "acme")
    ).toBe("/acme/projects/workspace");
  });

  it("preserves search params", () => {
    expect(
      switchScopePath("/charles/observability?tab=runs", "charles", "acme")
    ).toBe("/acme/observability?tab=runs");
  });

  it("preserves hash fragments", () => {
    expect(switchScopePath("/charles/settings#keys", "charles", "acme")).toBe(
      "/acme/settings#keys"
    );
  });

  it("navigates to the new scope root when the current path is unscoped", () => {
    // /new/team is unscoped — switching scope from there should land on the
    // selected scope's root, not "/acme/new/team".
    expect(switchScopePath("/new/team", "charles", "acme")).toBe("/acme");
    expect(switchScopePath("/invite/abc", undefined, "acme")).toBe("/acme");
  });

  it("navigates to the new scope root when first segment is not the current scope", () => {
    // Defensive: if our scope state is out of sync with the URL, don't
    // produce "/acme/some-other-scope/...".
    expect(switchScopePath("/stranger/projects", "charles", "acme")).toBe(
      "/acme"
    );
  });

  it("throws when nextScope is empty", () => {
    expect(() => switchScopePath("/", "charles", "")).toThrow();
  });
});
