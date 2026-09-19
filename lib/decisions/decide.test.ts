import { describe, expect, it } from "vitest";
import { commitDecisionAfter, decide, type DecideDeps } from "./decide";
import type { DecisionEvaluator } from "./evaluator";
import type { DecisionEventRecord } from "./record";
import type { DecisionAnswers, EvaluationResult } from "./types";

const scope = { surface: "control", userId: "user-1", aiCallId: "call-1" };

const usage = {
  latencyMs: 120,
  inputTokens: 300,
  costUsd: 0.00001,
  model: "test-eval",
};

function riskAnswer(destructive: number): DecisionAnswers {
  return {
    risk: {
      type: "score",
      score: destructive >= 0.5 ? 3 : 1,
      probabilities: { "1": 1 - destructive, "3": destructive },
    },
  };
}

function ok(answers: DecisionAnswers): EvaluationResult {
  return { ok: true, answers, confidence: { risk: 0.9 }, usage };
}

function makeDeps(input: {
  primary: EvaluationResult | (() => never);
  escalation?: EvaluationResult;
  env?: Record<string, string>;
}) {
  const recorded: DecisionEventRecord[] = [];
  const calls = { evaluate: 0, escalate: 0, escalationTimeoutMs: 0 };
  const evaluate: DecisionEvaluator = async () => {
    calls.evaluate += 1;
    return typeof input.primary === "function"
      ? input.primary()
      : input.primary;
  };
  const escalate: DecisionEvaluator = async (request) => {
    calls.escalate += 1;
    calls.escalationTimeoutMs = request.timeoutMs;
    return input.escalation ?? { ok: false, reason: "error", latencyMs: 1 };
  };
  const deps: DecideDeps = {
    evaluate,
    escalate,
    record: async (event) => {
      recorded.push(event);
    },
    env: input.env ?? {},
  };
  return { deps, recorded, calls };
}

describe("decide", () => {
  it("should act and record when an enforced decision crosses its threshold", async () => {
    const { deps, recorded, calls } = makeDeps({
      primary: ok(riskAnswer(0.95)),
    });

    const outcome = await decide(
      "command_risk",
      { command: "git push --force origin main" },
      scope,
      { baseline: { guardBlocked: false } },
      deps
    );

    expect(outcome).toMatchObject({
      status: "ok",
      mode: "enforce",
      verdict: "remote_destructive",
      act: true,
      escalated: false,
    });
    expect(calls.escalate).toBe(0);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      decisionId: "command_risk",
      status: "ok",
      acted: true,
      baseline: { guardBlocked: false },
      state: { command: "git push --force origin main" },
      usage,
    });
  });

  it("should record but never act in shadow mode", async () => {
    const { deps, recorded } = makeDeps({ primary: ok(riskAnswer(0.95)) });

    const outcome = await decide(
      "command_risk",
      { command: "git push --force origin main" },
      { ...scope, surface: "agent_tool" },
      {},
      deps
    );

    expect(outcome.mode).toBe("shadow");
    expect(outcome.verdict).toBe("remote_destructive");
    expect(outcome.act).toBe(false);
    expect(recorded[0]?.acted).toBe(false);
  });

  it("should let the language model settle an uncertain answer", async () => {
    const { deps, recorded, calls } = makeDeps({
      primary: ok(riskAnswer(0.55)),
      escalation: ok({ risk: { type: "score", score: 1 } }),
    });

    const outcome = await decide(
      "command_risk",
      { command: "dropdb test_local" },
      scope,
      {},
      deps
    );

    expect(calls.escalate).toBe(1);
    // The operator waits on this gate, so the second opinion gets 8 s, not
    // the primary call's budget and not an open-ended one.
    expect(calls.escalationTimeoutMs).toBe(8000);
    expect(outcome).toMatchObject({
      act: false,
      escalated: true,
      verdict: "level_1",
    });
    expect(recorded[0]).toMatchObject({
      escalated: true,
      escalationAnswers: { risk: { type: "score", score: 1 } },
      answers: riskAnswer(0.55),
    });
  });

  it("should keep the primary verdict when escalation fails", async () => {
    const { deps, recorded } = makeDeps({ primary: ok(riskAnswer(0.55)) });

    const outcome = await decide(
      "command_risk",
      { command: "x" },
      scope,
      {},
      deps
    );

    expect(outcome.act).toBe(false);
    expect(recorded[0]?.error).toBe("escalation error");
  });

  it("should skip evaluation entirely when the decision is off", async () => {
    const { deps, recorded, calls } = makeDeps({
      primary: ok(riskAnswer(0.95)),
      env: { DECISIONS_DISABLED: "1" },
    });

    const outcome = await decide(
      "command_risk",
      { command: "x" },
      scope,
      {},
      deps
    );

    expect(outcome.status).toBe("off");
    expect(calls.evaluate).toBe(0);
    expect(recorded).toHaveLength(0);
  });

  it("should fail open and record the outage when the evaluator is down", async () => {
    const { deps, recorded } = makeDeps({
      primary: { ok: false, reason: "timeout", latencyMs: 1500 },
    });

    const outcome = await decide(
      "command_risk",
      { command: "x" },
      scope,
      {},
      deps
    );

    expect(outcome).toMatchObject({ status: "unavailable", act: false });
    expect(recorded[0]).toMatchObject({
      status: "unavailable",
      error: "timeout",
    });
  });

  it("should stay silent when the installation has no gateway credential", async () => {
    const { deps, recorded } = makeDeps({
      primary: { ok: false, reason: "unconfigured", latencyMs: 0 },
    });

    const outcome = await decide(
      "command_risk",
      { command: "x" },
      scope,
      {},
      deps
    );

    expect(outcome.status).toBe("unavailable");
    expect(recorded).toHaveLength(0);
  });

  it("should never throw when the evaluator throws", async () => {
    const { deps } = makeDeps({
      primary: () => {
        throw new Error("boom");
      },
    });

    const outcome = await decide(
      "command_risk",
      { command: "x" },
      scope,
      {},
      deps
    );

    expect(outcome).toMatchObject({ status: "unavailable", act: false });
  });

  it("should hold a deferred event until commit and store the late baseline", async () => {
    const { deps, recorded } = makeDeps({
      primary: ok({ durable: { type: "boolean", probability: 0.8 } }),
    });

    const handle = await decide(
      "memory_promotion_gate",
      { record: "We always squash merge." },
      scope,
      { deferRecord: true },
      deps
    );
    expect(recorded).toHaveLength(0);

    await handle.commit({ promoted: 1 });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      verdict: "run_promotion",
      baseline: { promoted: 1 },
    });
  });
});

describe("commitDecisionAfter", () => {
  function makeHandle() {
    const committed: unknown[] = [];
    return {
      committed,
      handle: {
        commit: async (baseline?: unknown) => {
          committed.push(baseline);
        },
      },
    };
  }

  it("should commit the outcome as baseline when the work succeeds", async () => {
    const { handle, committed } = makeHandle();

    const result = await commitDecisionAfter(
      handle,
      async () => ({ promoted: 2 }),
      (outcome) => ({ promoted: outcome.promoted })
    );

    expect(result).toEqual({ promoted: 2 });
    expect(committed).toEqual([{ promoted: 2 }]);
  });

  it("should still commit, marked failed, and rethrow when the work throws", async () => {
    const { handle, committed } = makeHandle();

    await expect(
      commitDecisionAfter(
        handle,
        async () => {
          throw new Error("extraction failed");
        },
        () => ({})
      )
    ).rejects.toThrow("extraction failed");
    expect(committed).toEqual([{ failed: true }]);
  });

  const brokenHandle = {
    commit: async () => {
      throw new Error("insert failed");
    },
  };

  it("should surface the work error when the failure commit also throws", async () => {
    await expect(
      commitDecisionAfter(
        brokenHandle,
        async () => {
          throw new Error("extraction failed");
        },
        () => ({})
      )
    ).rejects.toThrow("extraction failed");
  });

  it("should return the work result when the success commit throws", async () => {
    const result = await commitDecisionAfter(
      brokenHandle,
      async () => ({ promoted: 2 }),
      (outcome) => ({ promoted: outcome.promoted })
    );

    expect(result).toEqual({ promoted: 2 });
  });
});
