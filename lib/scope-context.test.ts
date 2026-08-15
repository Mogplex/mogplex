import { describe, expect, it } from "vitest";
import { parseScopeContextForLayout } from "./scope-context";

const personalHeaders = new Headers({
  "x-mogplex-scope-kind": "personal",
  "x-mogplex-scope-slug": "alice",
  "x-mogplex-scope-id": "profile-alice",
});

describe("parseScopeContextForLayout", () => {
  it("fails closed when trusted scope headers are missing", () => {
    expect(() =>
      parseScopeContextForLayout("monitoring", new Headers())
    ).toThrowError("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("rejects image-like segments before trusting supplied headers", () => {
    expect(() =>
      parseScopeContextForLayout("logo.svg", personalHeaders)
    ).toThrowError("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("returns a valid trusted scope context", () => {
    expect(parseScopeContextForLayout("alice", personalHeaders)).toEqual({
      kind: "personal",
      slug: "alice",
      profileId: "profile-alice",
    });
  });

  it("keeps malformed injected scope kinds loud", () => {
    expect(() =>
      parseScopeContextForLayout(
        "alice",
        new Headers({
          "x-mogplex-scope-kind": "organization",
          "x-mogplex-scope-slug": "alice",
          "x-mogplex-scope-id": "profile-alice",
        })
      )
    ).toThrowError(
      'parseScopeContextHeaders: unknown scope kind "organization"'
    );
  });
});
