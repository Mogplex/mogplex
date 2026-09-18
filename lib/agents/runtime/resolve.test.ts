import { describe, expect, it } from "vitest";
import { resolveAgentRuntime, type ResolveAgentRuntimeDeps } from "./resolve";
import type { AgentRuntimeRow } from "./types";

const OWNER = "user-owner";
const TEAMMATE = "user-teammate";
const STRANGER = "user-stranger";
const TEAM = "team-1";

function row(overrides: Partial<AgentRuntimeRow> = {}): AgentRuntimeRow {
  return {
    id: "agent-1",
    user_id: OWNER,
    team_id: null,
    name: "NEXTJS-REVIEWER",
    slug: "nextjs-reviewer",
    model: "anthropic/claude-sonnet-4.5",
    system_prompt: "Review App Router code.",
    ...overrides,
  };
}

function deps(
  overrides: Partial<ResolveAgentRuntimeDeps> = {}
): ResolveAgentRuntimeDeps {
  return {
    loadAgent: async () => row(),
    loadLinkedSkills: async () => [
      { id: "skill-1", name: "RSC audit", description: null, content: "# RSC" },
    ],
    loadLinkedRules: async () => [
      { id: "rule-1", name: "No any", content: "Never use any." },
    ],
    isTeamMember: async (teamId, userId) =>
      teamId === TEAM && userId === TEAMMATE,
    ...overrides,
  };
}

describe("resolveAgentRuntime", () => {
  it("resolves a preset from the template catalog without touching storage", async () => {
    const runtime = await resolveAgentRuntime(
      { agentId: "preset:PR-REVIEWER", userId: STRANGER },
      deps({
        loadAgent: async () => {
          throw new Error("storage must not be read for presets");
        },
      })
    );
    expect(runtime?.preset).toBe(true);
    expect(runtime?.name).toBe("PR-REVIEWER");
    expect(runtime?.systemPrompt).toMatch(/pull request reviewer/i);
    expect(runtime?.skills).toEqual([]);
    expect(runtime?.rules).toEqual([]);
  });

  it("returns null for an unknown preset name", async () => {
    expect(
      await resolveAgentRuntime(
        { agentId: "preset:NOT-A-TEMPLATE", userId: OWNER },
        deps()
      )
    ).toBeNull();
  });

  it("resolves an owned agent with its linked skills and rules", async () => {
    const runtime = await resolveAgentRuntime(
      { agentId: "agent-1", userId: OWNER },
      deps()
    );
    expect(runtime).toMatchObject({
      id: "agent-1",
      name: "NEXTJS-REVIEWER",
      slug: "nextjs-reviewer",
      systemPrompt: "Review App Router code.",
      preset: false,
      ownerUserId: OWNER,
      teamId: null,
    });
    expect(runtime?.skills.map((skill) => skill.name)).toEqual(["RSC audit"]);
    expect(runtime?.rules.map((rule) => rule.content)).toEqual([
      "Never use any.",
    ]);
  });

  it("resolves a team-shared agent for a member of that team", async () => {
    const runtime = await resolveAgentRuntime(
      { agentId: "agent-1", userId: TEAMMATE },
      deps({ loadAgent: async () => row({ team_id: TEAM }) })
    );
    expect(runtime?.teamId).toBe(TEAM);
    expect(runtime?.ownerUserId).toBe(OWNER);
  });

  it("hides a team-shared agent from a non-member", async () => {
    expect(
      await resolveAgentRuntime(
        { agentId: "agent-1", userId: STRANGER },
        deps({ loadAgent: async () => row({ team_id: TEAM }) })
      )
    ).toBeNull();
  });

  it("hides another user's personal agent even from a teammate", async () => {
    expect(
      await resolveAgentRuntime(
        { agentId: "agent-1", userId: TEAMMATE },
        deps()
      )
    ).toBeNull();
  });

  it("returns null when the agent row does not exist", async () => {
    expect(
      await resolveAgentRuntime(
        { agentId: "missing", userId: OWNER },
        deps({ loadAgent: async () => null })
      )
    ).toBeNull();
  });
});
