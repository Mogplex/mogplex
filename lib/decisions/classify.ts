import type {
  FlowClassifyOutput,
  FlowClassifyResult,
} from "@/lib/types/flow-classify";
import {
  decisionChecksEnabled,
  type DecisionChecksGate,
} from "./account-setting";
import { evaluateWithDecisionModel, type DecisionEvaluator } from "./evaluator";
import type { DecisionModeEnv } from "./modes";
import {
  recordDecisionEvent,
  type DecisionEventRecord,
  type DecisionRecorder,
} from "./record";
import { buildDecisionState, type DecisionState } from "./state";
import type {
  DecisionAnswer,
  DecisionQuestion,
  DecisionScope,
  EvaluationFailure,
} from "./types";

/**
 * A classify node is not latency critical and its first call in a fresh
 * worker is a cold start, so it gets a longer budget than an inline gate.
 */
export const CLASSIFY_TIMEOUT_MS = 10_000;
export const CLASSIFY_QUESTION_VERSION = "authored";
const QUESTION_ID = "answer";

export type ClassifyRequest = {
  question: string;
  output: FlowClassifyOutput;
  /** The resolved input. Redacted and bounded before it leaves the process. */
  state: DecisionState;
  minConfidence?: number | null;
  scope: DecisionScope;
  /** Flow, run, and node identifiers, stored on the event row. */
  metadata?: Record<string, unknown>;
};

export type ClassifyOutcome =
  | { ok: true; result: FlowClassifyResult }
  | { ok: false; message: string };

export type ClassifyDeps = {
  evaluate: DecisionEvaluator;
  record: DecisionRecorder;
  env: DecisionModeEnv;
  /** The account's own switch. Consulted before any state is built or sent. */
  isEnabled: DecisionChecksGate;
};

/** Customer-facing: says who can change it and where. */
export const CLASSIFY_TURNED_OFF_MESSAGE =
  "Run checks are turned off for this account, so Classify cannot answer. A team owner or admin can turn them on in Settings.";

const defaultDeps: ClassifyDeps = {
  evaluate: evaluateWithDecisionModel,
  record: recordDecisionEvent,
  isEnabled: decisionChecksEnabled,
  get env() {
    return process.env;
  },
};

/** Customer-facing. Describes the finding, never the machinery behind it. */
const FAILURE_MESSAGES: Record<EvaluationFailure["reason"], string> = {
  unconfigured: "Classification is not configured on this installation.",
  circuit_open:
    "Classification is temporarily unavailable after repeated failures.",
  timeout: "Classification timed out.",
  error: "Classification failed.",
};

export function buildClassifyQuestion(
  question: string,
  output: FlowClassifyOutput
): DecisionQuestion {
  const instructions = question.trim();
  if (output.kind === "boolean") return { type: "boolean", instructions };
  if (output.kind === "scale") {
    return { type: "score", instructions, criteria: output.levels };
  }
  return {
    type: "choice",
    instructions,
    criteria: Object.fromEntries(
      output.options.map((option) => [
        option.label,
        option.description?.trim() || null,
      ])
    ),
  };
}

function highest(probabilities: Record<string, number>): number {
  const values = Object.values(probabilities);
  return values.length > 0 ? Math.max(...values) : 1;
}

type Judged = Omit<FlowClassifyResult, "uncertain">;

/** Map the evaluation answer onto the shape a flow branches on. */
export function toClassifyResult(
  output: FlowClassifyOutput,
  answer: DecisionAnswer | undefined,
  reportedConfidence: number | undefined
): Judged | null {
  if (output.kind === "boolean") {
    if (answer?.type !== "boolean") return null;
    const yes = answer.probability;
    return {
      kind: "boolean",
      answer: yes >= 0.5,
      confidence: Math.max(yes, 1 - yes),
      probabilities: { true: yes, false: 1 - yes },
    };
  }
  if (output.kind === "scale") {
    if (answer?.type !== "score") return null;
    const index = Math.round(answer.score);
    if (index < 0 || index >= output.levels.length) return null;
    const level = output.levels[index];
    // Positions are 1-based for authors; the model reports 0-based levels.
    const probabilities = Object.fromEntries(
      Object.entries(answer.probabilities ?? { [String(index)]: 1 }).map(
        ([position, value]) => [String(Number(position) + 1), value]
      )
    );
    return {
      kind: "scale",
      answer: index + 1,
      level,
      confidence: reportedConfidence ?? highest(probabilities),
      probabilities,
    };
  }
  if (answer?.type !== "choice") return null;
  const option = output.options.find((item) => item.label === answer.choice);
  if (!option) return null;
  const probabilities = answer.probabilities ?? { [option.label]: 1 };
  return {
    kind: "choice",
    answer: option.label,
    optionId: option.id,
    confidence: reportedConfidence ?? highest(probabilities),
    probabilities,
  };
}

function isDisabled(env: DecisionModeEnv): boolean {
  return env.DECISIONS_DISABLED === "1" || env.DECISIONS_DISABLED === "true";
}

/**
 * Answer one authored question about a piece of run state. Unlike `decide`,
 * this does not fail open: the author chose this node to pick a branch, so an
 * outage is returned as a failure for the flow's error handling to route.
 * Every attempt is recorded, and a recording failure never changes the result.
 */
export async function classify(
  request: ClassifyRequest,
  deps: ClassifyDeps = defaultDeps
): Promise<ClassifyOutcome> {
  if (isDisabled(deps.env)) {
    return {
      ok: false,
      message: "Classification is turned off on this installation.",
    };
  }
  // Never a silent branch: the node fails so the flow's error edge, and the
  // person reading the run, can see why nothing was decided.
  if (!(await deps.isEnabled(request.scope))) {
    return { ok: false, message: CLASSIFY_TURNED_OFF_MESSAGE };
  }

  const state = buildDecisionState(request.state);
  const questions = {
    [QUESTION_ID]: buildClassifyQuestion(request.question, request.output),
  };
  const base: Omit<
    DecisionEventRecord,
    "status" | "answers" | "confidence" | "verdict" | "acted" | "usage"
  > = {
    decisionId: "flow_classify",
    questionVersion: CLASSIFY_QUESTION_VERSION,
    // A classify node always picks the branch, which is what enforce means.
    mode: "enforce",
    scope: request.scope,
    state,
    questions,
    escalated: false,
    escalationAnswers: null,
    escalationUsage: null,
    metadata: request.metadata,
  };
  const record = async (event: DecisionEventRecord) => {
    try {
      await deps.record(event);
    } catch (error) {
      console.warn("[decisions] failed to record classification", { error });
    }
  };

  const evaluation = await deps
    .evaluate({
      decisionId: "flow_classify",
      state,
      questions,
      timeoutMs: CLASSIFY_TIMEOUT_MS,
      userId: request.scope.userId ?? null,
    })
    .catch(
      (error): EvaluationFailure => ({
        ok: false,
        reason: "error",
        error: error instanceof Error ? error.message : String(error),
        latencyMs: 0,
      })
    );

  if (!evaluation.ok) {
    if (evaluation.reason !== "unconfigured") {
      await record({
        ...base,
        status: "unavailable",
        answers: null,
        confidence: {},
        verdict: null,
        acted: false,
        usage: null,
        error: `${evaluation.reason}${evaluation.error ? `: ${evaluation.error}` : ""}`,
      });
    }
    return { ok: false, message: FAILURE_MESSAGES[evaluation.reason] };
  }

  const judged = toClassifyResult(
    request.output,
    evaluation.answers[QUESTION_ID],
    evaluation.confidence[QUESTION_ID]
  );
  const floor = request.minConfidence ?? null;
  const result: FlowClassifyResult | null = judged && {
    ...judged,
    uncertain: floor !== null && judged.confidence < floor,
  };
  await record({
    ...base,
    status: "ok",
    answers: evaluation.answers,
    confidence: evaluation.confidence,
    verdict: result
      ? result.uncertain
        ? "uncertain"
        : String(result.answer)
      : null,
    acted: result !== null,
    usage: evaluation.usage,
    error: result ? null : "answer did not match the question",
    metadata: { ...request.metadata, min_confidence: floor },
  });
  if (!result) {
    return {
      ok: false,
      message: "Classification returned an answer that matches no option.",
    };
  }
  return { ok: true, result };
}
