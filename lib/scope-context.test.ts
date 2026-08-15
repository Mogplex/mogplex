import { describe, expect, it } from "vitest";
import { SCOPE_LAYOUT_MISSING_HEADERS_ERROR } from "@/lib/scope-errors";
import {
  parseScopeContextForLayout,
  parseScopeContextHeaders,
} from "./scope-context";

const forgedScopeHeaders = new Headers({
  "x-mogplex-scope-kind": "personal",
  "x-mogplex-scope-slug": "attacker",
  "x-mogplex-scope-id": "profile-attacker",
});

describe("parseScopeContextForLayout", () => {
  it("rejects image segments before trusting forged scope headers", () => {
    let error: unknown;
    try {
      parseScopeContextForLayout("missing.png", forgedScopeHeaders);
    } catch (caught) {
      error = caught;
    }
    expect((error as { digest?: string }).digest).toBe(
      "NEXT_HTTP_ERROR_FALLBACK;404"
    );

    // Pin that the forged values would otherwise parse, so this test proves
    // the image-segment guard takes precedence over header parsing.
    expect(parseScopeContextHeaders(forgedScopeHeaders)).toEqual({
      kind: "personal",
      slug: "attacker",
      profileId: "profile-attacker",
    });
  });

  it("keeps missing headers on real scope segments loud", () => {
    expect(() =>
      parseScopeContextForLayout("monitoring", new Headers())
    ).toThrowError(SCOPE_LAYOUT_MISSING_HEADERS_ERROR);
  });

  it("returns valid scope context for real segments", () => {
    expect(parseScopeContextForLayout("attacker", forgedScopeHeaders)).toEqual({
      kind: "personal",
      slug: "attacker",
      profileId: "profile-attacker",
    });
  });
});
