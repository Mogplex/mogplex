/**
 * Decision layer types. A decision is a closed question about program state,
 * answered by a fast evaluation model with probabilities, optionally confirmed
 * by a language model when the answer is uncertain. Code, not the model, acts
 * on the verdict.
 */

export type DecisionMode = "off" | "shadow" | "advise" | "enforce";

export type DecisionId =
  | "command_risk"
  | "tool_result_failed"
  | "claim_verification"
  | "loop_check"
  | "memory_promotion_gate";

export type DecisionQuestion =
  | {
      type: "boolean";
      instructions: string;
      criteria?: { true?: string; false?: string };
    }
  | {
      type: "choice";
      instructions: string;
      criteria: Record<string, string | null>;
    }
  | { type: "score"; instructions: string; criteria: readonly string[] };

export type DecisionAnswer =
  | { type: "boolean"; probability: number }
  | {
      type: "choice";
      choice: string;
      probabilities?: Record<string, number>;
    }
  | { type: "score"; score: number; probabilities?: Record<string, number> };

export type DecisionAnswers = Record<string, DecisionAnswer>;

export type DecisionInterpretation = {
  /** Short machine-readable outcome, stored on the event row. */
  verdict: string;
  /** True when enforce/advise mode should act on the verdict. */
  act: boolean;
  /** True when the answer sits in the band that warrants a second opinion. */
  uncertain: boolean;
};

export type DecisionDefinition = {
  id: DecisionId;
  /** Bump whenever question wording or thresholds change. */
  version: string;
  defaultMode: DecisionMode;
  /** Per-surface defaults that override `defaultMode`. */
  surfaceModes?: Readonly<Record<string, DecisionMode>>;
  timeoutMs: number;
  /** Ask a language model the same questions when the answer is uncertain. */
  escalate: boolean;
  /**
   * Budget for that second opinion. A gate in front of a tool call must stay
   * short; a check that runs after the turn can afford to wait.
   */
  escalationTimeoutMs?: number;
  questions: Readonly<Record<string, DecisionQuestion>>;
  interpret: (answers: DecisionAnswers) => DecisionInterpretation;
};

export type DecisionScope = {
  userId?: string | null;
  teamId?: string | null;
  repoId?: string | null;
  aiCallId?: string | null;
  conversationId?: string | null;
  /** Where the decision ran: control, chat, slack, agent_tool, automation. */
  surface: string;
};

export type EvaluationUsage = {
  latencyMs: number;
  inputTokens: number | null;
  costUsd: number | null;
  model: string;
};

export type EvaluationSuccess = {
  ok: true;
  answers: DecisionAnswers;
  confidence: Record<string, number>;
  usage: EvaluationUsage;
};

export type EvaluationFailure = {
  ok: false;
  reason: "unconfigured" | "circuit_open" | "timeout" | "error";
  error?: string;
  latencyMs: number;
};

export type EvaluationResult = EvaluationSuccess | EvaluationFailure;

export type DecisionStatus = "ok" | "off" | "unavailable";

export type DecisionOutcome = {
  id: DecisionId;
  mode: DecisionMode;
  status: DecisionStatus;
  verdict: string | null;
  /** True only in advise/enforce mode with an actionable verdict. */
  act: boolean;
  escalated: boolean;
  answers: DecisionAnswers | null;
};
