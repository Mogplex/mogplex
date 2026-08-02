import { describe, expect, it } from "vitest";
import { isValidScopeSlug, slugifyTeamName } from "./team-slug";

describe("isValidScopeSlug", () => {
  it("accepts simple alphanumeric slugs", () => {
    expect(isValidScopeSlug("acme")).toBe(true);
    expect(isValidScopeSlug("acme-corp")).toBe(true);
    expect(isValidScopeSlug("team42")).toBe(true);
    expect(isValidScopeSlug("a")).toBe(true);
  });

  it("rejects leading and trailing hyphens", () => {
    expect(isValidScopeSlug("-acme")).toBe(false);
    expect(isValidScopeSlug("acme-")).toBe(false);
  });

  it("rejects consecutive hyphens", () => {
    expect(isValidScopeSlug("acme--corp")).toBe(false);
  });

  it("rejects uppercase, underscores, and other punctuation", () => {
    expect(isValidScopeSlug("Acme")).toBe(false);
    expect(isValidScopeSlug("acme_corp")).toBe(false);
    expect(isValidScopeSlug("acme.corp")).toBe(false);
    expect(isValidScopeSlug("acme corp")).toBe(false);
  });

  it("rejects empty and >39-char slugs", () => {
    expect(isValidScopeSlug("")).toBe(false);
    expect(isValidScopeSlug("a".repeat(40))).toBe(false);
    expect(isValidScopeSlug("a".repeat(39))).toBe(true);
  });
});

describe("slugifyTeamName", () => {
  it("lowercases and replaces non-alphanumerics with hyphens", () => {
    expect(slugifyTeamName("Acme Corp")).toBe("acme-corp");
    expect(slugifyTeamName("Hello, World!")).toBe("hello-world");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugifyTeamName("  Acme  ")).toBe("acme");
    expect(slugifyTeamName("--Acme--")).toBe("acme");
  });

  it("collapses long names to 39 chars without trailing hyphen", () => {
    const long = "A".repeat(60);
    const out = slugifyTeamName(long);
    expect(out.length).toBeLessThanOrEqual(39);
    expect(out.endsWith("-")).toBe(false);
  });

  it("produces a valid scope slug for typical inputs", () => {
    expect(isValidScopeSlug(slugifyTeamName("Acme Corp"))).toBe(true);
    expect(isValidScopeSlug(slugifyTeamName("My Team 123"))).toBe(true);
  });
});
