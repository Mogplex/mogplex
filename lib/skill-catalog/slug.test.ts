import { describe, expect, it } from "vitest";
import { assignSkillSlugs, slugifySkillName } from "./slug";
import { skillRow } from "./test-fixtures";

describe("slugifySkillName", () => {
  it("should lower-case and hyphenate a name", () => {
    expect(slugifySkillName("Deploy Checklist (v2)")).toBe(
      "deploy-checklist-v2"
    );
  });

  it("should fall back to a fixed slug when nothing survives", () => {
    expect(slugifySkillName("🚀🚀")).toBe("skill");
  });
});

describe("assignSkillSlugs", () => {
  it("should number later skills whose names collide", () => {
    const slugs = assignSkillSlugs([
      skillRow("Release notes", { id: "a" }),
      skillRow("release-notes", { id: "b" }),
      skillRow("Release  Notes!", { id: "c" }),
    ]).map((skill) => [skill.id, skill.slug]);
    expect(slugs).toEqual([
      ["a", "release-notes"],
      ["b", "release-notes-2"],
      ["c", "release-notes-3"],
    ]);
  });

  it("should not hand a numbered slug to a skill that already owns it", () => {
    const slugs = assignSkillSlugs([
      skillRow("Notes", { id: "a" }),
      skillRow("Notes 2", { id: "b" }),
      skillRow("notes", { id: "c" }),
    ]).map((skill) => skill.slug);
    expect(slugs).toEqual(["notes", "notes-2", "notes-3"]);
  });
});
