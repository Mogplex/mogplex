import { describe, expect, it } from "vitest";
import {
  COMMAND_RISK_ACT_THRESHOLD,
  COMMAND_RISK_LEVELS,
  DECISION_DEFINITIONS,
  getDecisionDefinition,
  REVIEW_FORMAT_ACT_THRESHOLD,
  REVIEW_REWRITE_DRIFT_CEILING,
  REVIEW_REWRITE_KEEPS_THRESHOLD,
  reviewFormatProblems,
} from "./definitions";
import type { DecisionAnswers } from "./types";

const risk = (probabilities: Record<string, number>, score: number) =>
  ({ risk: { type: "score", score, probabilities } }) satisfies DecisionAnswers;

const bool = (values: Record<string, number>): DecisionAnswers =>
  Object.fromEntries(
    Object.entries(values).map(([key, probability]) => [
      key,
      { type: "boolean", probability },
    ])
  );

describe("decision definitions", () => {
  it("should give every definition a version, a timeout, and a question to ask", () => {
    for (const definition of Object.values(DECISION_DEFINITIONS)) {
      expect(definition.version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
      expect(definition.timeoutMs).toBeGreaterThan(0);
      // Fixed questions, or one built per candidate at call time.
      expect(
        Object.keys(definition.questions).length +
          (definition.candidateQuestion ? 1 : 0)
      ).toBeGreaterThan(0);
    }
  });

  it("should keep the risk scale at four ordered levels ending in remote destructive", () => {
    expect(COMMAND_RISK_LEVELS).toHaveLength(4);
    expect(COMMAND_RISK_LEVELS[3]).toContain("remote destructive");
  });
});

describe("command_risk", () => {
  const { interpret, surfaceModes, defaultMode } =
    getDecisionDefinition("command_risk");

  it("should act when the remote-destructive probability reaches the threshold", () => {
    const result = interpret(
      risk({ "2": 0.3, "3": COMMAND_RISK_ACT_THRESHOLD }, 2.7)
    );
    expect(result).toEqual({
      verdict: "remote_destructive",
      act: true,
      uncertain: false,
    });
  });

  it("should not act on a remote mutation such as an ordinary push", () => {
    const result = interpret(risk({ "2": 0.97, "3": 0.02 }, 2.01));
    expect(result).toEqual({
      verdict: "level_2",
      act: false,
      uncertain: false,
    });
  });

  it("should ask for a second opinion when the destructive probability is in the middle band", () => {
    const result = interpret(risk({ "1": 0.4, "3": 0.56 }, 2));
    expect(result.act).toBe(false);
    expect(result.uncertain).toBe(true);
  });

  it("should treat a language-model answer without a distribution as certain", () => {
    expect(interpret({ risk: { type: "score", score: 3 } }).act).toBe(true);
    expect(interpret({ risk: { type: "score", score: 1 } }).act).toBe(false);
  });

  it("should enforce only where an approval path exists", () => {
    expect(defaultMode).toBe("shadow");
    expect(surfaceModes).toEqual({ control: "enforce" });
  });
});

describe("tool_result_failed", () => {
  const { interpret } = getDecisionDefinition("tool_result_failed");

  it("should flag a likely failure only at high probability", () => {
    expect(interpret(bool({ stepFailed: 0.93 })).act).toBe(true);
    expect(interpret(bool({ stepFailed: 0.6 })).act).toBe(false);
  });
});

describe("claim_verification", () => {
  const { interpret } = getDecisionDefinition("claim_verification");
  const supported = {
    claimsTestsPass: 0.98,
    testsPassed: 0.97,
    claimsPrOpened: 0.02,
    prOpened: 0.01,
    claimsPushed: 0.03,
    pushed: 0.02,
  };

  it("should accept a turn whose claims the tool log supports", () => {
    expect(interpret(bool(supported))).toEqual({
      verdict: "claims_supported",
      act: false,
      uncertain: false,
    });
  });

  it("should flag a claim the tool log contradicts", () => {
    const result = interpret(bool({ ...supported, testsPassed: 0.01 }));
    expect(result.verdict).toBe("unsupported_claim");
    expect(result.act).toBe(true);
  });

  it("should not flag missing evidence for a claim that was never made", () => {
    const result = interpret(
      bool({ ...supported, claimsTestsPass: 0.05, testsPassed: 0.01 })
    );
    expect(result.act).toBe(false);
  });

  it("should escalate a borderline contradiction instead of acting on it", () => {
    const result = interpret(
      bool({ ...supported, claimsTestsPass: 0.7, testsPassed: 0.35 })
    );
    expect(result.act).toBe(false);
    expect(result.uncertain).toBe(true);
  });
});

describe("observe-only defaults", () => {
  it("should keep the loop check in shadow so it can never steer a run by default", () => {
    expect(getDecisionDefinition("loop_check").defaultMode).toBe("shadow");
  });

  it("should keep the promotion gate in shadow and skip only on a very low durable probability", () => {
    const gate = getDecisionDefinition("memory_promotion_gate");
    expect(gate.defaultMode).toBe("shadow");
    expect(gate.interpret(bool({ durable: 0.04 })).verdict).toBe(
      "skip_promotion"
    );
    expect(gate.interpret(bool({ durable: 0.4 })).verdict).toBe(
      "run_promotion"
    );
  });
});

describe("review_format", () => {
  const definition = getDecisionDefinition("review_format");

  it("should name every problem that reaches the threshold", () => {
    const result = definition.interpret(
      bool({
        denseParagraph: 0.95,
        processTalk: 0.26,
        danglingReference: 0.65,
        bareCode: REVIEW_FORMAT_ACT_THRESHOLD,
      })
    );

    expect(result).toEqual({
      verdict: "rewrite:denseParagraph,bareCode",
      act: true,
      uncertain: false,
    });
  });

  it("should leave text alone when every problem stays under the threshold", () => {
    const result = definition.interpret(
      bool({
        denseParagraph: 0.25,
        processTalk: 0.17,
        danglingReference: 0.08,
        bareCode: 0.22,
      })
    );

    expect(result.act).toBe(false);
    expect(result.verdict).toBe("well_formatted");
    expect(reviewFormatProblems(bool({ bareCode: 0.79 }))).toEqual([]);
  });
});

describe("review_rewrite_faithful", () => {
  const definition = getDecisionDefinition("review_rewrite_faithful");

  it("should accept a rewrite that keeps every claim and adds none", () => {
    expect(
      definition.interpret(
        bool({ keepsClaims: 0.86, addsClaims: 0.06, changesMeaning: 0.08 })
      ).act
    ).toBe(true);
  });

  it("should reject a rewrite that drops, invents, or flips a claim", () => {
    const dropped = bool({
      keepsClaims: 0.16,
      addsClaims: 0.08,
      changesMeaning: 0.12,
    });
    const added = bool({
      keepsClaims: REVIEW_REWRITE_KEEPS_THRESHOLD,
      addsClaims: REVIEW_REWRITE_DRIFT_CEILING,
      changesMeaning: 0.1,
    });
    const flipped = bool({
      keepsClaims: 0.9,
      addsClaims: 0.1,
      changesMeaning: 0.98,
    });

    expect(definition.interpret(dropped).act).toBe(false);
    expect(definition.interpret(added).act).toBe(false);
    expect(definition.interpret(flipped).act).toBe(false);
  });

  it("should enforce both review checks by default", () => {
    expect(definition.defaultMode).toBe("enforce");
    expect(getDecisionDefinition("review_format").defaultMode).toBe("enforce");
  });
});
