import { describe, expect, it } from "vitest";
import type { CandidateDecideFn } from "./candidates";
import { CANDIDATE_LIMIT } from "./definitions-selection";
import { observeSkillSelection, type SelectableSkill } from "./skills";

const scope = { surface: "harness", userId: "user-1", teamId: "team-1" };

function skill(
  n: number,
  content = `# Skill ${n}\n\nBody ${n}.`
): SelectableSkill {
  return { id: `skill-${n}`, name: `Skill ${n}`, description: null, content };
}

function recorder() {
  const calls: Parameters<CandidateDecideFn>[] = [];
  const decideFn: CandidateDecideFn = async (...args) => {
    calls.push(args);
    return { status: "ok", verdict: "some" };
  };
  return { calls, decideFn };
}

describe("observeSkillSelection", () => {
  it("should label each skill, send the request, and record what was loaded", async () => {
    const { calls, decideFn } = recorder();

    await observeSkillSelection(
      {
        agent: {
          id: "agent-1",
          name: "Reviewer",
          skills: [
            { ...skill(1), description: "Find client boundaries" },
            skill(2, "x".repeat(2000)),
          ],
        },
        request: "  Audit the dashboard for client components.  ",
        delivery: "files",
        scope,
      },
      decideFn
    );

    expect(calls).toHaveLength(1);
    const [id, state, askedScope, options] = calls[0] ?? [];
    expect(id).toBe("skill_selection");
    expect(askedScope).toBe(scope);
    expect(state).toMatchObject({
      request: "Audit the dashboard for client components.",
      skills: {
        c01: { name: "Skill 1", description: "Find client boundaries" },
        c02: { name: "Skill 2" },
      },
    });
    const excerpt = (state as { skills: Record<string, { excerpt: string }> })
      .skills.c02?.excerpt;
    expect(excerpt?.length).toBeLessThan(700);
    expect(options).toMatchObject({
      candidates: ["c01", "c02"],
      baseline: { loaded: 2, delivery: "files" },
      metadata: {
        agent_id: "agent-1",
        omitted: 0,
        candidates: { c01: "skill-1", c02: "skill-2" },
      },
    });
  });

  it("should ask nothing for an agent without skills or a blank request", async () => {
    const { calls, decideFn } = recorder();
    const agent = { id: "agent-1", name: "Reviewer", skills: [skill(1)] };

    await observeSkillSelection(
      {
        agent: { ...agent, skills: [] },
        request: "do it",
        delivery: "inline",
        scope,
      },
      decideFn
    );
    await observeSkillSelection(
      { agent, request: "   ", delivery: "inline", scope },
      decideFn
    );

    expect(calls).toHaveLength(0);
  });

  it("should judge at most the candidate limit and count the rest", async () => {
    const { calls, decideFn } = recorder();
    const skills = Array.from({ length: CANDIDATE_LIMIT + 3 }, (_, n) =>
      skill(n)
    );

    await observeSkillSelection(
      {
        agent: { id: "a", name: "A", skills },
        request: "go",
        delivery: "inline",
        scope,
      },
      decideFn
    );

    const options = calls[0]?.[3];
    expect(options?.candidates).toHaveLength(CANDIDATE_LIMIT);
    expect(options?.metadata).toMatchObject({ omitted: 3 });
    expect(options?.baseline).toMatchObject({ loaded: CANDIDATE_LIMIT + 3 });
  });

  it("should judge the user's catalog beside the agent's skills, once each", async () => {
    const { calls, decideFn } = recorder();
    await observeSkillSelection(
      {
        agent: { id: "agent-1", name: "Reviewer", skills: [skill(1)] },
        catalog: {
          skills: [skill(1), skill(2), skill(3, "abc")],
          invokedIds: ["skill-3"],
        },
        request: "Ship it with $skill-3",
        delivery: "files",
        scope,
      },
      decideFn
    );
    const options = calls[0]?.[3];
    expect(options?.candidates).toEqual(["c01", "c02", "c03"]);
    expect(options?.metadata).toMatchObject({
      candidates: { c01: "skill-1", c02: "skill-2", c03: "skill-3" },
      sources: { c01: "agent", c02: "catalog", c03: "catalog" },
      invoked: ["skill-3"],
    });
    // Attached and invoked skills are delivered in full; the rest is an index.
    expect(options?.baseline).toMatchObject({
      loaded: 2,
      offered: 3,
      contentChars: skill(1).content.length + 3,
    });
  });

  it("should observe a run that has a catalog and no agent", async () => {
    const { calls, decideFn } = recorder();
    await observeSkillSelection(
      {
        catalog: { skills: [skill(1), skill(2)], invokedIds: [] },
        request: "Fix the header",
        delivery: "inline",
        scope,
      },
      decideFn
    );
    expect(calls[0]?.[3]).toMatchObject({
      candidates: ["c01", "c02"],
      baseline: { loaded: 0, offered: 2, contentChars: 0 },
      metadata: { agent_id: null, agent_name: null, invoked: [] },
    });

    await observeSkillSelection(
      {
        catalog: { skills: [], invokedIds: [] },
        request: "Fix the header",
        delivery: "inline",
        scope,
      },
      decideFn
    );
    expect(calls).toHaveLength(1);
  });

  it("should never reject when the check itself throws", async () => {
    await expect(
      observeSkillSelection(
        {
          agent: { id: "a", name: "A", skills: [skill(1)] },
          request: "go",
          delivery: "files",
          scope,
        },
        async () => {
          throw new Error("boom");
        }
      )
    ).resolves.toBeUndefined();
  });
});
