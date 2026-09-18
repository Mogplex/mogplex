import { describe, expect, it } from "vitest";
import {
  AGENT_INLINE_SKILLS_MAX_CHARS,
  AGENT_RULES_MAX_CHARS,
  AGENT_SKILLS_DIR,
  agentSkillPath,
  prependAgentInstructions,
  renderAgentInstructions,
} from "./instructions";
import type { AgentRuntime } from "./types";

function runtime(overrides: Partial<AgentRuntime> = {}): AgentRuntime {
  return {
    id: "agent-1",
    name: "NEXTJS-REVIEWER",
    slug: "nextjs-reviewer",
    model: null,
    systemPrompt: "Review App Router code carefully.",
    skills: [
      {
        id: "skill-1",
        name: "RSC Audit",
        description: "Find client boundaries",
        content: "# RSC Audit\n\nLook for use client.",
      },
    ],
    rules: [{ id: "rule-1", name: "No any", content: "Never use any." }],
    preset: false,
    teamId: null,
    ownerUserId: "user-1",
    ...overrides,
  };
}

describe("renderAgentInstructions", () => {
  it("inlines the system prompt and rules and lists skills by sandbox path", () => {
    const rendered = renderAgentInstructions(runtime());
    expect(rendered.prompt).toContain('<agent name="NEXTJS-REVIEWER">');
    expect(rendered.prompt).toContain("Review App Router code carefully.");
    expect(rendered.prompt).toContain("### No any\nNever use any.");
    expect(rendered.prompt).toContain(
      `- RSC Audit — Find client boundaries (${AGENT_SKILLS_DIR}/rsc-audit/SKILL.md)`
    );
    expect(rendered.prompt).not.toContain("Look for use client.");
    expect(rendered.files).toEqual([
      {
        path: `${AGENT_SKILLS_DIR}/rsc-audit/SKILL.md`,
        content: "# RSC Audit\n\nLook for use client.\n",
      },
    ]);
  });

  it("embeds skill content and writes no files in inline mode", () => {
    const rendered = renderAgentInstructions(runtime(), "inline");
    expect(rendered.prompt).toContain("### RSC Audit\nFind client boundaries");
    expect(rendered.prompt).toContain("Look for use client.");
    expect(rendered.prompt).not.toContain(AGENT_SKILLS_DIR);
    expect(rendered.files).toEqual([]);
  });

  it("caps inlined rules and marks the truncation", () => {
    const rendered = renderAgentInstructions(
      runtime({
        rules: [
          {
            id: "r1",
            name: "Long",
            content: "x".repeat(AGENT_RULES_MAX_CHARS + 5),
          },
          { id: "r2", name: "Next", content: "must be omitted" },
        ],
      })
    );
    expect(rendered.prompt).toContain("[truncated]");
    expect(rendered.prompt).toContain(
      "### Next\n[omitted: rules budget exhausted]"
    );
    expect(rendered.prompt).not.toContain("must be omitted");
  });

  it("caps inlined skills without dropping their headers", () => {
    const rendered = renderAgentInstructions(
      runtime({
        skills: [
          {
            id: "s1",
            name: "Big",
            description: null,
            content: "y".repeat(AGENT_INLINE_SKILLS_MAX_CHARS + 10),
          },
          {
            id: "s2",
            name: "Small",
            description: "still listed",
            content: "z",
          },
        ],
      }),
      "inline"
    );
    expect(rendered.prompt).toContain("[truncated]");
    expect(rendered.prompt).toContain("### Small\nstill listed");
    expect(rendered.prompt).not.toMatch(/### Small\nstill listed\n\nz/);
  });

  it("renders a bare identity block when the agent has nothing attached", () => {
    const rendered = renderAgentInstructions(
      runtime({ systemPrompt: null, skills: [], rules: [] })
    );
    expect(rendered.prompt).toBe(
      '<agent name="NEXTJS-REVIEWER">\nYou are running as the Mogplex agent "NEXTJS-REVIEWER".\n</agent>'
    );
    expect(rendered.files).toEqual([]);
  });

  it("skips skill files with empty content but keeps them out of the list too", () => {
    const rendered = renderAgentInstructions(
      runtime({
        skills: [{ id: "s1", name: "Empty", description: null, content: "  " }],
      })
    );
    expect(rendered.files).toEqual([]);
    expect(rendered.prompt).toContain(
      `- Empty (${agentSkillPath({ name: "Empty" })})`
    );
  });

  it("prepends the block ahead of the task prompt", () => {
    expect(prependAgentInstructions("  Fix the tests  ", "<agent/>")).toBe(
      "<agent/>\n\nFix the tests"
    );
  });
});
