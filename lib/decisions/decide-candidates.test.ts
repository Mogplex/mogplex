import { describe, expect, it } from "vitest";
import { decide, type DecideDeps } from "./decide";
import type { EvaluateInput } from "./evaluator";
import type { DecisionEventRecord } from "./record";

const scope = { surface: "control", userId: "user-1", teamId: "team-1" };

function makeDeps() {
  const recorded: DecisionEventRecord[] = [];
  const requests: EvaluateInput[] = [];
  const deps: DecideDeps = {
    evaluate: async (request) => {
      requests.push(request);
      return {
        ok: true,
        answers: Object.fromEntries(
          Object.keys(request.questions).map((key) => [
            key,
            {
              type: "boolean" as const,
              probability: key === "c02" ? 0.05 : 0.9,
            },
          ])
        ),
        confidence: {},
        usage: { latencyMs: 1, inputTokens: 1, costUsd: 0, model: "test" },
      };
    },
    escalate: async () => ({ ok: false, reason: "error", latencyMs: 0 }),
    record: async (event) => {
      recorded.push(event);
    },
    env: {},
    isEnabled: async () => true,
  };
  return { deps, recorded, requests };
}

describe("decide with per-candidate questions", () => {
  it("should ask and record one question per candidate without acting in shadow", async () => {
    const { deps, recorded, requests } = makeDeps();

    const outcome = await decide(
      "memory_relevance",
      { request: "fix the login bug", memories: { c01: "a", c02: "b" } },
      scope,
      { candidates: ["c01", "c02"], baseline: { injected: 2 } },
      deps
    );

    expect(Object.keys(requests[0]?.questions ?? {})).toEqual(["c01", "c02"]);
    expect(outcome).toMatchObject({
      status: "ok",
      mode: "shadow",
      verdict: "drop_some",
      act: false,
    });
    expect(recorded).toHaveLength(1);
    expect(Object.keys(recorded[0]?.questions ?? {})).toEqual(["c01", "c02"]);
    expect(recorded[0]).toMatchObject({
      decisionId: "memory_relevance",
      acted: false,
      baseline: { injected: 2 },
    });
  });

  it("should ask nothing when there are no candidates to judge", async () => {
    const { deps, recorded, requests } = makeDeps();

    const outcome = await decide(
      "skill_selection",
      { request: "fix the login bug", skills: {} },
      scope,
      { candidates: [] },
      deps
    );

    expect(outcome.status).toBe("off");
    expect(requests).toHaveLength(0);
    expect(recorded).toHaveLength(0);
  });

  it("should ignore candidates for a decision with fixed questions", async () => {
    const { deps, requests } = makeDeps();

    await decide(
      "tool_result_failed",
      { command: "ls", output: "ok" },
      scope,
      { candidates: ["c01"] },
      deps
    );

    expect(Object.keys(requests[0]?.questions ?? {})).toEqual(["stepFailed"]);
  });
});
