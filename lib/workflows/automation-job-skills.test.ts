import { describe, expect, it, vi } from "vitest";
import type { Tool } from "ai";
import { catalogOf, skillRow } from "@/lib/skill-catalog/test-fixtures";
import type { JobContext } from "@/lib/workflows/automation-job-types";
import {
  buildAutomationHarnessPrompt,
  buildJobRunSpec,
} from "@/lib/workflows/automation-job-prompts";
import {
  NO_AUTOMATION_SKILLS,
  readAutomationInvocationTexts,
  resolveAutomationSkills,
  type AutomationSkillsDeps,
} from "./automation-job-skills";

const OWNER = "00000000-0000-4000-8000-000000000401";
const AGENT = "00000000-0000-4000-8000-000000000402";

const [deploy, notes, linked] = catalogOf(
  skillRow("Deploy checklist", { content: "1. Run the tests." }),
  skillRow("Release notes", { content: "Group changes by area." }),
  skillRow("RSC Audit", { id: "linked-skill", content: "Look for use client." })
);

function job(overrides: Partial<JobContext> = {}): JobContext {
  return {
    metadata: { flow_node_role: "task" },
    assignmentType: "cron",
    skillId: null,
    agent: {
      model: "test/model",
      system_prompt: "Ship the weekly release. Follow $deploy-checklist.",
    },
    repo: {
      id: "repo-1",
      user_id: OWNER,
      full_name: "acme/widgets",
      default_branch: "main",
      github_installation_id: 1,
    },
    ...overrides,
  } as JobContext;
}

function deps(overrides: Partial<AutomationSkillsDeps> = {}) {
  const tools = { find_skills: {} as Tool, load_skill: {} as Tool };
  return {
    loadCatalog: vi.fn(async () => ({ skills: [deploy, notes, linked] })),
    loadLinkedSkills: vi.fn(async () => []),
    loadLinkedRules: vi.fn(async () => []),
    createTools: vi.fn(() => tools),
    ...overrides,
  } satisfies AutomationSkillsDeps;
}

describe("readAutomationInvocationTexts", () => {
  it("should read the node's instructions and nothing from the payload", () => {
    expect(
      readAutomationInvocationTexts(
        job({
          assignmentType: "pr_review",
          metadata: {
            comment_body: "$release-notes",
            pr_body: "$release-notes",
          },
        })
      )
    ).toEqual(["Ship the weekly release. Follow $deploy-checklist."]);
  });

  it("should also read a comment that @mentions the agent", () => {
    expect(
      readAutomationInvocationTexts(
        job({
          assignmentType: "mention",
          agent: { model: "m", system_prompt: null },
          metadata: { comment_body: "@mogplex use $release-notes" },
        })
      )
    ).toEqual(["@mogplex use $release-notes"]);
  });

  it("should also read the prompt of a signed webhook", () => {
    expect(
      readAutomationInvocationTexts(
        job({
          assignmentType: "webhook",
          agent: { model: "m", system_prompt: " " },
          metadata: { webhook: { prompt: "$deploy-checklist", other: 1 } },
        })
      )
    ).toEqual(["$deploy-checklist"]);
  });
});

describe("resolveAutomationSkills", () => {
  it("should inline the skill a native node invokes, index the rest, and hand over the tools", async () => {
    const injected = deps();
    const result = await resolveAutomationSkills(job(), "native", injected);
    expect(injected.loadCatalog).toHaveBeenCalledWith({
      userId: OWNER,
      repoId: "repo-1",
    });
    expect(injected.createTools).toHaveBeenCalledWith({
      userId: OWNER,
      repoId: "repo-1",
    });
    expect(Object.keys(result.tools)).toEqual(["find_skills", "load_skill"]);
    expect(result.instructionsSuffix).toContain("1. Run the tests.");
    expect(result.instructionsSuffix).toContain(
      "- $release-notes: Release notes"
    );
    expect(result.instructionsSuffix).not.toContain("Group changes by area.");
  });

  it("should add the roster agent's rules and skills, and not index them twice", async () => {
    const injected = deps({
      loadLinkedSkills: vi.fn(async () => [
        {
          id: "linked-skill",
          name: "RSC Audit",
          description: null,
          content: "Look for use client.",
        },
      ]),
      loadLinkedRules: vi.fn(async () => [
        { id: "rule-1", name: "No any", content: "Never use any." },
      ]),
    });
    const result = await resolveAutomationSkills(
      job({
        agent: {
          id: AGENT,
          name: "REVIEWER",
          model: "m",
          system_prompt: "Review.",
        },
      }),
      "native",
      injected
    );
    expect(injected.loadLinkedSkills).toHaveBeenCalledWith(AGENT);
    const suffix = result.instructionsSuffix ?? "";
    expect(suffix).toContain('<agent name="REVIEWER">');
    expect(suffix).toContain("### No any\nNever use any.");
    expect(suffix).toContain("Look for use client.");
    // The node carries the instructions; the block must not restate them.
    expect(suffix).not.toContain("## Agent instructions");
    expect(suffix).not.toContain("- $rsc-audit:");
    expect(suffix.indexOf("</agent>")).toBeLessThan(suffix.indexOf("<skills>"));
  });

  it("should leave the catalog to the harness route and add only the agent's attachments", async () => {
    const injected = deps({
      loadLinkedRules: vi.fn(async () => [
        { id: "rule-1", name: "No any", content: "Never use any." },
      ]),
    });
    const result = await resolveAutomationSkills(
      job({
        agent: {
          id: AGENT,
          name: "REVIEWER",
          model: "m",
          system_prompt: "$deploy-checklist",
        },
      }),
      "harness",
      injected
    );
    expect(injected.loadCatalog).not.toHaveBeenCalled();
    expect(result.tools).toEqual({});
    expect(result.instructionsSuffix).toContain("Never use any.");
    expect(result.instructionsSuffix).not.toContain("<skills>");
  });

  it("should add nothing for a preset agent, an owner without skills, or a non-UUID owner", async () => {
    const preset = deps({ loadCatalog: vi.fn(async () => ({ skills: [] })) });
    expect(
      await resolveAutomationSkills(
        job({
          agent: { id: "preset:REVIEWER", model: "m", system_prompt: null },
        }),
        "native",
        preset
      )
    ).toEqual(NO_AUTOMATION_SKILLS);
    expect(preset.loadLinkedSkills).not.toHaveBeenCalled();
    expect(preset.createTools).not.toHaveBeenCalled();

    const legacy = deps();
    const context = job();
    context.repo.user_id = "user-123";
    expect(await resolveAutomationSkills(context, "native", legacy)).toEqual(
      NO_AUTOMATION_SKILLS
    );
    expect(legacy.loadCatalog).not.toHaveBeenCalled();
  });

  it("should let the automation run when skills cannot load", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await resolveAutomationSkills(
      job(),
      "native",
      deps({
        loadCatalog: vi.fn(async () => {
          throw new Error("database offline");
        }),
      })
    );
    expect(result).toBe(NO_AUTOMATION_SKILLS);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("run specs with a skills suffix", () => {
  it("should join the instructions of a task node and keep the default when it wrote none", () => {
    const spec = buildJobRunSpec(
      job({ agent: { model: "m", system_prompt: null } }),
      "cron",
      "<skills>S</skills>"
    );
    expect(spec.instructions).toBe(
      "Complete the scheduled repository task.\n\n<skills>S</skills>"
    );
    expect(spec.prompt).not.toContain("<skills>");
  });

  it("should lead the prompt for a job type without separate instructions", () => {
    const spec = buildJobRunSpec(
      job({
        assignmentType: "mention",
        metadata: {
          comment_body: "hi",
          comment_author: "sam",
          issue_number: 4,
        },
        agent: { model: "m", system_prompt: null },
      }),
      "mention",
      "<skills>S</skills>"
    );
    expect(spec.instructions).toBeUndefined();
    expect(
      spec.prompt.startsWith("<skills>S</skills>\n\nYou were @mentioned")
    ).toBe(true);
  });

  it("should leave a run spec untouched without a suffix", () => {
    expect(buildJobRunSpec(job(), "cron", null)).toEqual(
      buildJobRunSpec(job(), "cron")
    );
  });

  it("should carry the agent's attachments into a CLI harness PR-fix prompt", () => {
    const prompt = buildAutomationHarnessPrompt({
      context: job({ agent: { model: "m", system_prompt: "Fix carefully." } }),
      harnessId: "codex",
      review: {
        hasIssues: true,
        summary: "Null guard missing",
        commentBody: null,
        affectedFiles: [],
        findings: [],
      },
      pullRequest: {
        number: 7,
        title: "Guard",
        headRef: "fix/guard",
        baseRef: "main",
      } as never,
      targetRepo: job().repo,
      instructionsSuffix: '<agent name="R">rules</agent>',
    });
    expect(prompt).toContain('<agent name="R">rules</agent>\n\nFix carefully.');
    expect(prompt).toContain("A prior PR review found issues in PR #7");
  });

  it("should carry the agent's attachments into a CLI harness prompt", () => {
    const prompt = buildAutomationHarnessPrompt({
      context: job(),
      harnessId: "codex",
      instructionsSuffix: '<agent name="R">rules</agent>',
    });
    expect(prompt).toContain(
      'Agent instructions:\nShip the weekly release. Follow $deploy-checklist.\n\n<agent name="R">rules</agent>'
    );
  });
});
