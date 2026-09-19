import { describe, expect, it } from "vitest";
import type { FlowClassifyOutput } from "@/lib/types/flow-classify";
import {
  buildClassifyQuestion,
  classify,
  CLASSIFY_TIMEOUT_MS,
  toClassifyResult,
  type ClassifyDeps,
  type ClassifyRequest,
} from "./classify";
import type { EvaluateInput } from "./evaluator";
import type { DecisionEventRecord } from "./record";
import type { DecisionAnswer, EvaluationResult } from "./types";

const usage = {
  latencyMs: 210,
  inputTokens: 120,
  costUsd: 0.000004,
  model: "test-eval",
  generationId: "gen_1",
};

const triage: FlowClassifyOutput = {
  kind: "choice",
  options: [
    { id: "bug", label: "Bug report", description: "Broken behavior" },
    { id: "feature", label: "Feature request" },
  ],
};
const urgency: FlowClassifyOutput = {
  kind: "scale",
  levels: ["can wait", "this week", "drop everything"],
};

function request(overrides: Partial<ClassifyRequest> = {}): ClassifyRequest {
  return {
    question: " Is the state a bug report? ",
    output: { kind: "boolean" },
    state: "The login page crashes on submit.",
    scope: { surface: "automation", userId: "user-1", repoId: "repo-1" },
    metadata: { flow_id: "flow-1", flow_node_id: "classify-1" },
    ...overrides,
  };
}

function makeDeps(
  evaluation: EvaluationResult | (() => never),
  env: Record<string, string> = {}
) {
  const recorded: DecisionEventRecord[] = [];
  const asked: EvaluateInput[] = [];
  const deps: ClassifyDeps = {
    evaluate: async (input) => {
      asked.push(input);
      return typeof evaluation === "function" ? evaluation() : evaluation;
    },
    record: async (event) => {
      recorded.push(event);
    },
    env,
    isEnabled: async () => true,
  };
  return { deps, recorded, asked };
}

function answered(
  answer: DecisionAnswer,
  confidence?: number
): EvaluationResult {
  return {
    ok: true,
    answers: { answer },
    confidence: confidence === undefined ? {} : { answer: confidence },
    usage,
  };
}

describe("buildClassifyQuestion", () => {
  it("should ask a boolean question with trimmed wording", () => {
    expect(
      buildClassifyQuestion("  Is it a bug?  ", { kind: "boolean" })
    ).toEqual({ type: "boolean", instructions: "Is it a bug?" });
  });

  it("should offer option labels as choices with their guidance", () => {
    expect(buildClassifyQuestion("Which kind?", triage)).toEqual({
      type: "choice",
      instructions: "Which kind?",
      criteria: { "Bug report": "Broken behavior", "Feature request": null },
    });
  });

  it("should treat a blank option description as no guidance", () => {
    const question = buildClassifyQuestion("Which kind?", {
      kind: "choice",
      options: [
        { id: "a", label: "A", description: "   " },
        { id: "b", label: "B", description: "  when b  " },
      ],
    });
    expect(question).toMatchObject({ criteria: { A: null, B: "when b" } });
  });

  it("should pass scale levels through in order", () => {
    expect(buildClassifyQuestion("How urgent?", urgency)).toEqual({
      type: "score",
      instructions: "How urgent?",
      criteria: urgency.kind === "scale" ? urgency.levels : [],
    });
  });
});

describe("toClassifyResult", () => {
  it("should read a boolean from its probability, either side of one half", () => {
    const yes = toClassifyResult(
      { kind: "boolean" },
      { type: "boolean", probability: 0.92 },
      undefined
    );
    const no = toClassifyResult(
      { kind: "boolean" },
      { type: "boolean", probability: 0.2 },
      undefined
    );
    expect(yes).toMatchObject({ kind: "boolean", answer: true });
    expect(yes?.confidence).toBeCloseTo(0.92);
    expect(no).toMatchObject({ answer: false });
    expect(no?.confidence).toBeCloseTo(0.8);
    expect(no?.probabilities.false).toBeCloseTo(0.8);
  });

  it("should treat a probability of exactly one half as true", () => {
    expect(
      toClassifyResult(
        { kind: "boolean" },
        { type: "boolean", probability: 0.5 },
        undefined
      )
    ).toMatchObject({ answer: true, confidence: 0.5 });
  });

  it("should resolve a choice to its option id and reported confidence", () => {
    expect(
      toClassifyResult(
        triage,
        {
          type: "choice",
          choice: "Feature request",
          probabilities: { "Bug report": 0.1, "Feature request": 0.9 },
        },
        0.88
      )
    ).toEqual({
      kind: "choice",
      answer: "Feature request",
      optionId: "feature",
      confidence: 0.88,
      probabilities: { "Bug report": 0.1, "Feature request": 0.9 },
    });
  });

  it("should fall back to the top probability when no confidence is reported", () => {
    const result = toClassifyResult(
      triage,
      {
        type: "choice",
        choice: "Bug report",
        probabilities: { "Bug report": 0.7, "Feature request": 0.3 },
      },
      undefined
    );
    expect(result?.confidence).toBe(0.7);
  });

  it("should be fully confident in a choice that came without probabilities", () => {
    expect(
      toClassifyResult(
        triage,
        { type: "choice", choice: "Bug report" },
        undefined
      )
    ).toMatchObject({ confidence: 1, probabilities: { "Bug report": 1 } });
  });

  it("should be fully confident when the probability map is empty", () => {
    expect(
      toClassifyResult(
        triage,
        { type: "choice", choice: "Bug report", probabilities: {} },
        undefined
      )?.confidence
    ).toBe(1);
  });

  it("should reject a missing answer for every answer type", () => {
    expect(toClassifyResult(triage, undefined, 0.9)).toBeNull();
    expect(toClassifyResult(urgency, undefined, 0.9)).toBeNull();
  });

  it("should report a scale answer as a 1-based position with its level", () => {
    expect(
      toClassifyResult(
        urgency,
        { type: "score", score: 1.6, probabilities: { "1": 0.3, "2": 0.7 } },
        0.64
      )
    ).toEqual({
      kind: "scale",
      answer: 3,
      level: "drop everything",
      confidence: 0.64,
      probabilities: { "2": 0.3, "3": 0.7 },
    });
  });

  it("should accept the lowest scale level", () => {
    expect(
      toClassifyResult(urgency, { type: "score", score: 0 }, undefined)
    ).toMatchObject({
      answer: 1,
      level: "can wait",
      probabilities: { "1": 1 },
    });
  });

  it("should reject answers that do not fit the question", () => {
    expect(
      toClassifyResult(urgency, { type: "score", score: 3 }, undefined)
    ).toBeNull();
    expect(
      toClassifyResult(urgency, { type: "score", score: -1 }, undefined)
    ).toBeNull();
    expect(
      toClassifyResult(triage, { type: "choice", choice: "Spam" }, undefined)
    ).toBeNull();
    expect(
      toClassifyResult(triage, { type: "boolean", probability: 1 }, undefined)
    ).toBeNull();
    expect(
      toClassifyResult(urgency, { type: "boolean", probability: 1 }, undefined)
    ).toBeNull();
    expect(
      toClassifyResult({ kind: "boolean" }, undefined, undefined)
    ).toBeNull();
  });
});

describe("classify", () => {
  it("should answer, and record the judged state with the flow identifiers", async () => {
    const { deps, recorded, asked } = makeDeps(
      answered({ type: "boolean", probability: 0.95 })
    );

    const outcome = await classify(request(), deps);

    expect(outcome).toEqual({
      ok: true,
      result: {
        kind: "boolean",
        answer: true,
        confidence: 0.95,
        probabilities: { true: 0.95, false: expect.closeTo(0.05) },
        uncertain: false,
      },
    });
    expect(asked[0]).toMatchObject({
      decisionId: "flow_classify",
      timeoutMs: CLASSIFY_TIMEOUT_MS,
      userId: "user-1",
      questions: {
        answer: { type: "boolean", instructions: "Is the state a bug report?" },
      },
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      decisionId: "flow_classify",
      questionVersion: "authored",
      mode: "enforce",
      status: "ok",
      verdict: "true",
      acted: true,
      state: "The login page crashes on submit.",
      scope: { surface: "automation", userId: "user-1", repoId: "repo-1" },
      usage,
      error: null,
      escalated: false,
      escalationAnswers: null,
      metadata: {
        flow_id: "flow-1",
        flow_node_id: "classify-1",
        min_confidence: null,
      },
    });
  });

  it("should redact secrets from the state before it is judged or stored", async () => {
    const { deps, recorded, asked } = makeDeps(
      answered({ type: "boolean", probability: 0.9 })
    );

    await classify(
      request({
        state: { note: "token", authorization: "Bearer abc.def.ghi" },
      }),
      deps
    );

    expect(JSON.stringify(asked[0]?.state)).not.toContain("abc.def.ghi");
    expect(JSON.stringify(recorded[0]?.state)).not.toContain("abc.def.ghi");
  });

  it("should mark an answer below the confidence floor as uncertain", async () => {
    const { deps, recorded } = makeDeps(
      answered({ type: "choice", choice: "Bug report" }, 0.55)
    );

    const outcome = await classify(
      request({ output: triage, minConfidence: 0.7 }),
      deps
    );

    expect(outcome).toMatchObject({
      ok: true,
      result: { answer: "Bug report", optionId: "bug", uncertain: true },
    });
    expect(recorded[0]).toMatchObject({
      verdict: "uncertain",
      metadata: { min_confidence: 0.7 },
    });
  });

  it("should take an answer that sits exactly on the confidence floor", async () => {
    const { deps } = makeDeps(
      answered({ type: "choice", choice: "Bug report" }, 0.7)
    );
    const outcome = await classify(
      request({ output: triage, minConfidence: 0.7 }),
      deps
    );
    expect(outcome).toMatchObject({ ok: true, result: { uncertain: false } });
  });

  it("should fail, not guess, when the evaluation times out, and record the outage", async () => {
    const { deps, recorded } = makeDeps({
      ok: false,
      reason: "timeout",
      error: "aborted",
      latencyMs: 10_000,
    });

    const outcome = await classify(request(), deps);

    expect(outcome).toEqual({
      ok: false,
      message: "Classification timed out.",
    });
    expect(recorded[0]).toMatchObject({
      status: "unavailable",
      acted: false,
      verdict: null,
      error: "timeout: aborted",
    });
  });

  it("should record an outage that carries no detail by its reason alone", async () => {
    const { deps, recorded } = makeDeps({
      ok: false,
      reason: "circuit_open",
      latencyMs: 0,
    });
    const outcome = await classify(request(), deps);
    expect(outcome).toMatchObject({ ok: false });
    expect(recorded[0]?.error).toBe("circuit_open");
  });

  it("should fail without recording on an installation that has no gateway credential", async () => {
    const { deps, recorded } = makeDeps({
      ok: false,
      reason: "unconfigured",
      latencyMs: 0,
    });

    const outcome = await classify(request(), deps);

    expect(outcome).toEqual({
      ok: false,
      message: "Classification is not configured on this installation.",
    });
    expect(recorded).toHaveLength(0);
  });

  it("should fail when the evaluator throws instead of rejecting the node run", async () => {
    const { deps, recorded } = makeDeps(() => {
      throw new Error("socket hang up");
    });

    const outcome = await classify(request(), deps);

    expect(outcome).toEqual({ ok: false, message: "Classification failed." });
    expect(recorded[0]?.error).toBe("error: socket hang up");
  });

  it("should fail and record when the answer matches no option", async () => {
    const { deps, recorded } = makeDeps(
      answered({ type: "choice", choice: "Spam" }, 0.9)
    );

    const outcome = await classify(request({ output: triage }), deps);

    expect(outcome).toEqual({
      ok: false,
      message: "Classification returned an answer that matches no option.",
    });
    expect(recorded[0]).toMatchObject({
      status: "ok",
      acted: false,
      verdict: null,
      error: "answer did not match the question",
    });
  });

  it.each(["1", "true"])(
    "should not evaluate when decisions are disabled with %s",
    async (flag) => {
      const { deps, recorded, asked } = makeDeps(
        answered({ type: "boolean", probability: 0.9 }),
        { DECISIONS_DISABLED: flag }
      );

      const outcome = await classify(request(), deps);

      expect(outcome).toEqual({
        ok: false,
        message: "Classification is turned off on this installation.",
      });
      expect(asked).toHaveLength(0);
      expect(recorded).toHaveLength(0);
    }
  );

  it("should keep the answer when recording it fails", async () => {
    const { deps } = makeDeps(answered({ type: "boolean", probability: 0.9 }));
    deps.record = async () => {
      throw new Error("insert failed");
    };

    const outcome = await classify(request(), deps);

    expect(outcome).toMatchObject({ ok: true, result: { answer: true } });
  });

  it("should never name the evaluation provider in a customer-facing failure", async () => {
    for (const reason of [
      "unconfigured",
      "circuit_open",
      "timeout",
      "error",
    ] as const) {
      const { deps } = makeDeps({ ok: false, reason, latencyMs: 0 });
      const outcome = await classify(request(), deps);
      expect(outcome.ok ? "" : outcome.message).not.toMatch(
        /jev|typesafe|gateway|vercel/i
      );
    }
  });
});
