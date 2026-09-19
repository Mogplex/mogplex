import type { DecisionState } from "./state";
import type {
  DecisionAnswers,
  DecisionMode,
  DecisionQuestion,
  DecisionScope,
  EvaluationUsage,
  RecordedDecisionId,
} from "./types";

/**
 * One row per decision. The judged state is stored with the answer on
 * purpose: run telemetry omits most tool inputs and outputs, so without the
 * state an answer could never be audited or re-scored later.
 */
export type DecisionEventRecord = {
  decisionId: RecordedDecisionId;
  questionVersion: string;
  mode: DecisionMode;
  status: "ok" | "unavailable";
  scope: DecisionScope;
  state: DecisionState;
  questions: Readonly<Record<string, DecisionQuestion>>;
  answers: DecisionAnswers | null;
  confidence: Record<string, number>;
  verdict: string | null;
  acted: boolean;
  baseline?: unknown;
  usage: EvaluationUsage | null;
  escalated: boolean;
  escalationAnswers: DecisionAnswers | null;
  escalationUsage: EvaluationUsage | null;
  error?: string | null;
  metadata?: Record<string, unknown>;
};

export type DecisionRecorder = (event: DecisionEventRecord) => Promise<void>;

export function toDecisionEventRow(event: DecisionEventRecord) {
  return {
    user_id: event.scope.userId,
    team_id: event.scope.teamId ?? null,
    repo_id: event.scope.repoId ?? null,
    ai_call_id: event.scope.aiCallId ?? null,
    conversation_id: event.scope.conversationId ?? null,
    surface: event.scope.surface,
    decision_id: event.decisionId,
    question_version: event.questionVersion,
    mode: event.mode,
    status: event.status,
    model: event.usage?.model ?? null,
    state: event.state,
    questions: event.questions,
    answers: event.answers,
    confidence: event.confidence,
    verdict: event.verdict,
    acted: event.acted,
    baseline: event.baseline ?? null,
    latency_ms: event.usage?.latencyMs ?? null,
    input_tokens: event.usage?.inputTokens ?? null,
    cost_usd: event.usage?.costUsd ?? null,
    escalated: event.escalated,
    escalation_model: event.escalationUsage?.model ?? null,
    escalation_answers: event.escalationAnswers,
    escalation_latency_ms: event.escalationUsage?.latencyMs ?? null,
    escalation_cost_usd: event.escalationUsage?.costUsd ?? null,
    error: event.error ?? null,
    metadata: {
      ...event.metadata,
      ...(event.usage?.generationId
        ? { generation_id: event.usage.generationId }
        : {}),
    },
  };
}

/**
 * Best-effort by contract: a logging failure must never affect the tool call
 * or turn that asked for the decision.
 */
export const recordDecisionEvent: DecisionRecorder = async (event) => {
  console.info(
    "[decisions]",
    JSON.stringify({
      decision: event.decisionId,
      version: event.questionVersion,
      surface: event.scope.surface,
      mode: event.mode,
      status: event.status,
      verdict: event.verdict,
      acted: event.acted,
      escalated: event.escalated,
      answers: event.answers,
      confidence: event.confidence,
      escalationAnswers: event.escalationAnswers,
      latencyMs: event.usage?.latencyMs ?? null,
      escalationLatencyMs: event.escalationUsage?.latencyMs ?? null,
      costUsd: event.usage?.costUsd ?? null,
      aiCallId: event.scope.aiCallId ?? null,
      conversationId: event.scope.conversationId ?? null,
      error: event.error ?? null,
    })
  );
  // Rows are owned by a user; ownerless tool instances log to stdout only.
  if (!event.scope.userId) return;
  try {
    const mod = await import("@/lib/supabase/admin");
    const { error } = await mod.supabaseAdmin
      .from("decision_events")
      .insert(toDecisionEventRow(event));
    if (error) {
      console.warn("[decisions] failed to persist event", {
        decision: event.decisionId,
        error: error.message,
      });
    }
  } catch (error) {
    console.warn("[decisions] failed to persist event", {
      decision: event.decisionId,
      error,
    });
  }
};
