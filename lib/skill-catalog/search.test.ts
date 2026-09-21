import { describe, expect, it } from "vitest";
import { scoreSkill, searchSkills } from "./search";
import { catalogOf, skillRow } from "./test-fixtures";

const skills = catalogOf(
  skillRow("Deploy checklist", {
    description: "Steps before shipping to production",
    tags: ["release"],
  }),
  skillRow("Release notes", {
    description: "Write a changelog entry",
    content: "Group changes by area. Mention deploy windows.",
  }),
  skillRow("Postgres tuning", { content: "Read the query plan first." })
);

describe("searchSkills", () => {
  it("should list the catalog in order for a blank query", () => {
    expect(searchSkills(skills, "  ", 2).map((skill) => skill.slug)).toEqual([
      "deploy-checklist",
      "release-notes",
    ]);
  });

  it("should rank a name hit above a body hit", () => {
    expect(searchSkills(skills, "deploy").map((skill) => skill.slug)).toEqual([
      "deploy-checklist",
      "release-notes",
    ]);
  });

  it("should match tags and descriptions", () => {
    expect(searchSkills(skills, "changelog")[0]?.slug).toBe("release-notes");
    expect(searchSkills(skills, "release")[0]?.slug).toBe("release-notes");
    expect(
      searchSkills(skills, "release").map((skill) => skill.slug)
    ).toContain("deploy-checklist");
  });

  it("should return nothing when no word matches", () => {
    expect(searchSkills(skills, "kubernetes")).toEqual([]);
  });

  it("should ignore filler words when the query has real ones", () => {
    expect(
      searchSkills(skills, "how do I do the postgres").map((s) => s.slug)
    ).toEqual(["postgres-tuning"]);
  });

  it("should put an exact handle first, with or without its sigil", () => {
    expect(scoreSkill(skills[1], "$release-notes")).toBeGreaterThan(
      scoreSkill(skills[1], "release notes")
    );
    expect(searchSkills(skills, "/release-notes")[0]?.slug).toBe(
      "release-notes"
    );
  });

  it("should respect the limit", () => {
    expect(searchSkills(skills, "deploy", 1)).toHaveLength(1);
  });
});
