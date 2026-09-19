import { describe, expect, it } from "vitest";
import { toDecisionEventRow, type DecisionEventRecord } from "./record";

const event: DecisionEventRecord = {
  decisionId: "command_risk",
  questionVersion: "2026-09-19.1",
  mode: "enforce",
  status: "ok",
  scope: {
    surface: "control",
    userId: "user-1",
    repoId: "repo-1",
    aiCallId: "call-1",
  },
  state: { command: "git push --force" },
  questions: {},
  answers: { risk: { type: "score", score: 3 } },
  confidence: { risk: 0.97 },
  verdict: "remote_destructive",
  acted: true,
  baseline: { guardBlocked: false },
  usage: { latencyMs: 210, inputTokens: 250, costUsd: 0.00001, model: "m" },
  escalated: false,
  escalationAnswers: null,
  escalationUsage: null,
};

describe("toDecisionEventRow", () => {
  it("should map a decision event onto the decision_events columns", () => {
    expect(toDecisionEventRow(event)).toEqual({
      user_id: "user-1",
      team_id: null,
      repo_id: "repo-1",
      ai_call_id: "call-1",
      conversation_id: null,
      surface: "control",
      decision_id: "command_risk",
      question_version: "2026-09-19.1",
      mode: "enforce",
      status: "ok",
      model: "m",
      state: { command: "git push --force" },
      questions: {},
      answers: { risk: { type: "score", score: 3 } },
      confidence: { risk: 0.97 },
      verdict: "remote_destructive",
      acted: true,
      baseline: { guardBlocked: false },
      latency_ms: 210,
      input_tokens: 250,
      cost_usd: 0.00001,
      escalated: false,
      escalation_model: null,
      escalation_answers: null,
      escalation_latency_ms: null,
      escalation_cost_usd: null,
      error: null,
      metadata: {},
    });
  });
});
