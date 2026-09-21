import { describe, expect, it } from "vitest";
import { applySkillSuggestion, getSkillSuggestions } from "./suggest";

const skills = [
  { slug: "deploy-checklist", name: "Deploy checklist", description: null },
  { slug: "release-notes", name: "Release notes", description: "Changelog" },
  { slug: "rsc-audit", name: "RSC Audit", description: null },
];

function slugs(value: string) {
  return getSkillSuggestions(value, skills)?.matches.map((s) => s.slug) ?? null;
}

describe("getSkillSuggestions", () => {
  it("should list every skill for a bare sigil", () => {
    expect(slugs("$")).toHaveLength(3);
    expect(slugs("/")).toHaveLength(3);
    expect(slugs("ship it with $")).toHaveLength(3);
  });

  it("should narrow by slug prefix or a word in the name", () => {
    expect(slugs("use $re")).toEqual(["release-notes"]);
    expect(slugs("use $audit")).toEqual(["rsc-audit"]);
    expect(slugs("$Deploy_")).toEqual(["deploy-checklist"]);
  });

  it("should open a slash handle only as the first word", () => {
    expect(slugs("/dep")).toEqual(["deploy-checklist"]);
    expect(slugs("  /dep")).toEqual(["deploy-checklist"]);
    expect(slugs("look at src/dep")).toBeNull();
    expect(slugs("please /dep")).toBeNull();
  });

  it("should close once the handle is finished or the user moves on", () => {
    expect(slugs("$release-notes")).toBeNull();
    expect(slugs("$release-notes ")).toBeNull();
    expect(slugs("costs $5 and $zzz")).toBeNull();
    expect(slugs("plain text")).toBeNull();
  });

  it("should report the partial token it would replace", () => {
    expect(getSkillSuggestions("try $rel", skills)?.token).toBe("$rel");
  });
});

describe("applySkillSuggestion", () => {
  it("should complete the handle in place and keep its sigil", () => {
    expect(applySkillSuggestion("try $rel", "release-notes")).toBe(
      "try $release-notes "
    );
    expect(applySkillSuggestion("/dep", "deploy-checklist")).toBe(
      "/deploy-checklist "
    );
  });

  it("should leave text without a partial handle alone", () => {
    expect(applySkillSuggestion("plain text", "release-notes")).toBe(
      "plain text"
    );
  });
});
