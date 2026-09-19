import { getDecisionDefinition } from "./definitions";
import {
  evaluateWithDecisionModel,
  evaluateWithLanguageModel,
  type DecisionEvaluator,
} from "./evaluator";
import { resolveDecisionMode, type DecisionModeEnv } from "./modes";
import {
  recordDecisionEvent,
  type DecisionEventRecord,
  type DecisionRecorder,
} from "./record";
import { buildDecisionState, type DecisionState } from "./state";
import type {
  DecisionAnswers,
  DecisionDefinition,
  DecisionId,
  DecisionOutcome,
  DecisionScope,
  EvaluationFailure,
  EvaluationResult,
} from "./types";

export type DecideDeps = {
  evaluate: DecisionEvaluator;
  escalate: DecisionEvaluator;
  record: DecisionRecorder;
  env: DecisionModeEnv;
};

const defaultDeps: DecideDeps = {
  evaluate: evaluateWithDecisionModel,
  escalate: evaluateWithLanguageModel,
  record: recordDecisionEvent,
  get env() {
    return process.env;
  },
};

export type DecideOptions = {
  /** What the system did or would do without this decision, for comparison. */
  baseline?: unknown;
  /**
   * Hold the event row until `commit` is called, for callers whose baseline
   * is only known after the guarded work finishes.
   */
  deferRecord?: boolean;
  metadata?: Record<string, unknown>;
};

export type DecisionHandle = DecisionOutcome & {
  /** Persist a deferred event. A no-op unless `deferRecord` was set. */
  commit: (baseline?: unknown) => Promise<void>;
};

const noCommit = async () => {};

function inactive(
  id: DecisionId,
  mode: DecisionOutcome["mode"],
  status: DecisionOutcome["status"]
): DecisionHandle {
  return {
    id,
    mode,
    status,
    verdict: null,
    act: false,
    escalated: false,
    answers: null,
    commit: noCommit,
  };
}

type EventBase = Omit<
  DecisionEventRecord,
  "status" | "answers" | "confidence" | "verdict" | "acted" | "usage"
>;

/** An installation without gateway credentials is not an incident. */
async function recordOutage(
  deps: DecideDeps,
  base: EventBase,
  failure: EvaluationFailure
): Promise<void> {
  if (failure.reason === "unconfigured") return;
  await deps.record({
    ...base,
    status: "unavailable",
    answers: null,
    confidence: {},
    verdict: null,
    acted: false,
    usage: null,
    error: `${failure.reason}${failure.error ? `: ${failure.error}` : ""}`,
  });
}

/** Interpret the answers, asking for a second opinion when uncertain. */
async function settle(
  definition: DecisionDefinition,
  answers: DecisionAnswers,
  escalate: () => Promise<EvaluationResult>
) {
  const first = definition.interpret(answers);
  if (!(definition.escalate && first.uncertain)) {
    return { interpretation: first, escalation: null };
  }
  const escalation = await escalate();
  return {
    interpretation: escalation.ok
      ? definition.interpret(escalation.answers)
      : first,
    escalation,
  };
}

/**
 * Ask one decision. Never throws and never blocks longer than the
 * definition's timeout plus an optional escalation: on any failure the caller
 * gets `status: "unavailable"` and proceeds exactly as it did before this
 * layer existed.
 */
export async function decide(
  id: DecisionId,
  rawState: DecisionState,
  scope: DecisionScope,
  options: DecideOptions = {},
  deps: DecideDeps = defaultDeps
): Promise<DecisionHandle> {
  const definition = getDecisionDefinition(id);
  const mode = resolveDecisionMode(definition, scope.surface, deps.env);
  if (mode === "off") return inactive(id, mode, "off");

  try {
    const state = buildDecisionState(rawState);
    const request = {
      decisionId: id,
      state,
      questions: definition.questions,
      timeoutMs: definition.timeoutMs,
      userId: scope.userId ?? null,
    };
    const base: EventBase = {
      decisionId: id,
      questionVersion: definition.version,
      mode,
      scope,
      state,
      questions: definition.questions,
      baseline: options.baseline,
      escalated: false,
      escalationAnswers: null,
      escalationUsage: null,
      metadata: options.metadata,
    };

    const primary = await deps.evaluate(request);
    if (!primary.ok) {
      await recordOutage(deps, base, primary);
      return inactive(id, mode, "unavailable");
    }

    const settled = await settle(definition, primary.answers, () =>
      deps.escalate(request)
    );
    const { interpretation, escalation } = settled;
    const act = interpretation.act && (mode === "advise" || mode === "enforce");
    const event: DecisionEventRecord = {
      ...base,
      status: "ok",
      answers: primary.answers,
      confidence: primary.confidence,
      verdict: interpretation.verdict,
      acted: act,
      usage: primary.usage,
      escalated: escalation !== null,
      escalationAnswers: escalation?.ok ? escalation.answers : null,
      escalationUsage: escalation?.ok ? escalation.usage : null,
      error:
        escalation && !escalation.ok ? `escalation ${escalation.reason}` : null,
    };

    const outcome: DecisionOutcome = {
      id,
      mode,
      status: "ok",
      verdict: interpretation.verdict,
      act,
      escalated: escalation !== null,
      answers: primary.answers,
    };
    if (options.deferRecord) {
      return {
        ...outcome,
        commit: (baseline) =>
          deps.record({ ...event, baseline: baseline ?? event.baseline }),
      };
    }
    await deps.record(event);
    return { ...outcome, commit: noCommit };
  } catch (error) {
    console.warn("[decisions] decide failed open", { decision: id, error });
    return inactive(id, mode, "unavailable");
  }
}
