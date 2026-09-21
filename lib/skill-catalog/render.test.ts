import { describe, expect, it } from "vitest";
import {
  CATALOG_SKILLS_DIR,
  INVOKED_SKILLS_MAX_CHARS,
  SKILL_INDEX_MAX_ENTRIES,
  renderSkillCatalog,
} from "./render";
import { catalogOf, skillRow } from "./test-fixtures";

const [deploy, notes, empty] = catalogOf(
  skillRow("Deploy checklist", {
    description: "Steps before\nshipping",
    content: "1. Run the tests.\n",
  }),
  skillRow("Release notes", { content: "Group changes by area." }),
  skillRow("Empty", { content: "  " })
);

describe("renderSkillCatalog", () => {
  it("should say nothing when there are no skills", () => {
    expect(
      renderSkillCatalog({
        invoked: [],
        available: [],
        delivery: "inline",
        loadHint: "tool",
      })
    ).toEqual({ prompt: null, files: [] });
  });

  it("should inline invoked skills and index the rest for a tool surface", () => {
    const { prompt, files } = renderSkillCatalog({
      invoked: [deploy],
      available: [deploy, notes],
      delivery: "inline",
      loadHint: "tool",
    });
    expect(files).toEqual([]);
    expect(prompt).toMatch(/^<skills>\n## Invoked skills/);
    expect(prompt).toContain("### Deploy checklist ($deploy-checklist)");
    expect(prompt).toContain("1. Run the tests.");
    expect(prompt).toContain("## Available skills");
    expect(prompt).toContain("load_skill");
    expect(prompt).toContain("- $release-notes: Release notes");
    expect(prompt).not.toContain("- $deploy-checklist:");
    expect(prompt).not.toContain("Group changes by area.");
  });

  it("should flatten a description onto the index line", () => {
    const { prompt } = renderSkillCatalog({
      invoked: [],
      available: [deploy],
      delivery: "inline",
      loadHint: "tool",
    });
    expect(prompt).toContain(
      "- $deploy-checklist: Deploy checklist — Steps before shipping"
    );
  });

  it("should write every skill as a file when the surface reads files", () => {
    const { prompt, files } = renderSkillCatalog({
      invoked: [deploy, empty],
      available: [deploy, notes, empty],
      delivery: "files",
      loadHint: "files",
    });
    expect(files).toEqual([
      {
        path: `${CATALOG_SKILLS_DIR}/deploy-checklist/SKILL.md`,
        content: "1. Run the tests.\n",
      },
      {
        path: `${CATALOG_SKILLS_DIR}/release-notes/SKILL.md`,
        content: "Group changes by area.\n",
      },
    ]);
    expect(prompt).toContain(
      `- Deploy checklist (${CATALOG_SKILLS_DIR}/deploy-checklist/SKILL.md)`
    );
    expect(prompt).toContain("- Empty (no instructions written yet)");
    expect(prompt).not.toContain("1. Run the tests.");
  });

  it("should leave the index out when the agent has no way to load a skill", () => {
    const { prompt, files } = renderSkillCatalog({
      invoked: [],
      available: [deploy, notes],
      delivery: "inline",
      loadHint: "none",
    });
    expect(prompt).toBeNull();
    expect(files).toEqual([]);
  });

  it("should cap inlined skill text and name what it dropped", () => {
    const [big, next] = catalogOf(
      skillRow("Big", { content: "x".repeat(INVOKED_SKILLS_MAX_CHARS + 50) }),
      skillRow("Next", { content: "never shown" })
    );
    const { prompt } = renderSkillCatalog({
      invoked: [big, next],
      available: [],
      delivery: "inline",
      loadHint: "none",
    });
    expect(prompt).toContain("[truncated]");
    expect(prompt).toContain(
      "### Next ($next)\n[omitted: skill budget exhausted]"
    );
    expect(prompt).not.toContain("never shown");
  });

  it("should cap the index and point at search for the remainder", () => {
    const many = catalogOf(
      ...Array.from({ length: SKILL_INDEX_MAX_ENTRIES + 3 }, (_, index) =>
        skillRow(`Skill ${index + 1}`)
      )
    );
    const { prompt } = renderSkillCatalog({
      invoked: [],
      available: many,
      delivery: "inline",
      loadHint: "tool",
    });
    expect(prompt).toContain(`- $skill-${SKILL_INDEX_MAX_ENTRIES}:`);
    expect(prompt).not.toContain(`- $skill-${SKILL_INDEX_MAX_ENTRIES + 1}:`);
    expect(prompt).toContain("…and 3 more. Use find_skills to search them.");
  });

  it("should write files only for the skills a file surface indexes", () => {
    const many = catalogOf(
      ...Array.from({ length: SKILL_INDEX_MAX_ENTRIES + 3 }, (_, index) =>
        skillRow(`Skill ${index + 1}`)
      )
    );
    const invoked = many[many.length - 1];
    const { prompt, files } = renderSkillCatalog({
      invoked: [invoked],
      available: many,
      delivery: "files",
      loadHint: "files",
    });
    expect(files).toHaveLength(SKILL_INDEX_MAX_ENTRIES + 1);
    expect(files[0].path).toBe(
      `${CATALOG_SKILLS_DIR}/${invoked.slug}/SKILL.md`
    );
    expect(prompt).toContain(
      "…and 2 more. Ask the user to invoke one by its $slug."
    );
  });
});
