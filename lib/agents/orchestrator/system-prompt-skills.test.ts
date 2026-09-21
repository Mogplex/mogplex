import { describe, expect, it } from "vitest";
import { catalogOf, skillRow } from "@/lib/skill-catalog/test-fixtures";
import { buildOrchestratorSystemPrompt } from "./system-prompt";

const [deploy, notes] = catalogOf(
  skillRow("Deploy checklist", { content: "1. Run the tests." }),
  skillRow("Release notes", { content: "Group changes by area." })
);

describe("orchestrator skills block", () => {
  it("should deliver an invoked skill in full and index the rest after the memory block", () => {
    const prompt = buildOrchestratorSystemPrompt({
      repoFullName: "acme/demo",
      skills: { invoked: [deploy], available: [deploy, notes] },
      availableToolNames: ["find_skills", "load_skill", "run_command"],
    });
    expect(prompt).toContain("## Invoked skills");
    expect(prompt).toContain("1. Run the tests.");
    expect(prompt).toContain("- $release-notes: Release notes");
    expect(prompt).not.toContain("Group changes by area.");
    expect(prompt.indexOf("</memory>")).toBeLessThan(
      prompt.indexOf("<skills>")
    );
    expect(prompt.indexOf("</skills>")).toBeLessThan(prompt.indexOf("<role>"));
  });

  it("should keep invoked skills but drop the index when load_skill is not callable", () => {
    const prompt = buildOrchestratorSystemPrompt({
      repoFullName: "acme/demo",
      skills: { invoked: [deploy], available: [deploy, notes] },
      availableToolNames: ["run_command"],
    });
    expect(prompt).toContain("1. Run the tests.");
    expect(prompt).not.toContain("## Available skills");
    expect(prompt).not.toContain("$release-notes");
  });

  it("should add nothing for an operator without skills", () => {
    const base = buildOrchestratorSystemPrompt({ repoFullName: "acme/demo" });
    expect(
      buildOrchestratorSystemPrompt({
        repoFullName: "acme/demo",
        skills: { invoked: [], available: [] },
      })
    ).toBe(base);
    expect(base).not.toContain("<skills>");
  });

  it("should list the skill tools under the memory category", () => {
    const prompt = buildOrchestratorSystemPrompt({
      repoFullName: "acme/demo",
      availableToolNames: ["find_skills", "load_skill"],
    });
    expect(prompt).toContain("find_skills");
    expect(prompt).toContain("load_skill");
  });
});
