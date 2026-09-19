import { describe, expect, it } from "vitest";
import {
  evaluateWithDecisionModel,
  gatewayGenerationId,
  normalizeEscalationAnswers,
} from "./evaluator";
import type { DecisionQuestion } from "./types";

const questions: Record<string, DecisionQuestion> = {
  failed: { type: "boolean", instructions: "Did it fail?" },
  risk: {
    type: "score",
    instructions: "How risky?",
    criteria: ["low", "high"],
  },
  route: {
    type: "choice",
    instructions: "Who handles it?",
    criteria: { human: null, agent: null },
  },
};

describe("normalizeEscalationAnswers", () => {
  it("should map plain language-model answers onto certain typed answers", () => {
    expect(
      normalizeEscalationAnswers(questions, {
        failed: true,
        risk: 1,
        route: "human",
      })
    ).toEqual({
      failed: { type: "boolean", probability: 1 },
      risk: { type: "score", score: 1, probabilities: { "1": 1 } },
      route: { type: "choice", choice: "human", probabilities: { human: 1 } },
    });
  });

  it("should drop answers whose type does not match the question", () => {
    expect(
      normalizeEscalationAnswers(questions, { failed: "yes", risk: "1" })
    ).toEqual({});
  });
});

describe("evaluateWithDecisionModel", () => {
  it("should report unconfigured instead of reaching the network under test", async () => {
    const result = await evaluateWithDecisionModel({
      decisionId: "command_risk",
      state: { command: "ls" },
      questions,
      timeoutMs: 100,
    });
    expect(result).toMatchObject({ ok: false, reason: "unconfigured" });
  });
});

describe("gatewayGenerationId", () => {
  it("should read the generation id from gateway metadata", () => {
    expect(
      gatewayGenerationId({ gateway: { generationId: "gen_1", cost: "0" } })
    ).toBe("gen_1");
  });

  it("should return null when the metadata carries no usable id", () => {
    expect(gatewayGenerationId(undefined)).toBeNull();
    expect(gatewayGenerationId({ typesafe: {} })).toBeNull();
    expect(gatewayGenerationId({ gateway: { generationId: 42 } })).toBeNull();
  });
});
