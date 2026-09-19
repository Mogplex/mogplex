import {
  createGateway,
  experimental_evaluate as evaluate,
  generateText,
  Output,
} from "ai";
import { z } from "zod";
import type { DecisionState } from "./state";
import type {
  DecisionAnswers,
  DecisionQuestion,
  EvaluationFailure,
  EvaluationResult,
} from "./types";

export const DEFAULT_DECISION_MODEL = "typesafe-ai/jev";
export const DEFAULT_ESCALATION_MODEL = "anthropic/claude-sonnet-5";
const ESCALATION_TIMEOUT_MS = 20_000;
const BREAKER_FAILURE_LIMIT = 5;
const BREAKER_OPEN_MS = 60_000;

export type EvaluateInput = {
  decisionId: string;
  state: DecisionState;
  questions: Readonly<Record<string, DecisionQuestion>>;
  timeoutMs: number;
  userId?: string | null;
};

export type DecisionEvaluator = (
  input: EvaluateInput
) => Promise<EvaluationResult>;

type Gateway = ReturnType<typeof createGateway>;

let breakerFailures = 0;
let breakerOpenUntil = 0;

/** Test seam: reset the process-wide circuit breaker. */
export function resetDecisionCircuitBreaker(): void {
  breakerFailures = 0;
  breakerOpenUntil = 0;
}

function noteResult(ok: boolean, now: number): void {
  if (ok) {
    breakerFailures = 0;
    return;
  }
  breakerFailures += 1;
  if (breakerFailures >= BREAKER_FAILURE_LIMIT) {
    breakerOpenUntil = now + BREAKER_OPEN_MS;
    breakerFailures = 0;
  }
}

/**
 * Decisions use the platform gateway credential. Unit tests never reach the
 * network: they inject an evaluator instead of resolving this one.
 */
function resolveGateway(): Gateway | null {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return null;
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (apiKey) return createGateway({ apiKey });
  // On Vercel the gateway authenticates with the deployment's OIDC token.
  if (process.env.VERCEL === "1" || process.env.VERCEL_OIDC_TOKEN) {
    return createGateway();
  }
  return null;
}

function gatewayOptions(input: EvaluateInput) {
  return {
    gateway: {
      ...(input.userId ? { user: input.userId } : {}),
      tags: ["surface:decisions", `decision:${input.decisionId}`],
    },
  };
}

function gatewayCost(metadata: unknown): number | null {
  const gateway = (
    metadata as { gateway?: { marketCost?: unknown } } | undefined
  )?.gateway;
  const cost = Number(gateway?.marketCost);
  return Number.isFinite(cost) ? cost : null;
}

function failure(
  reason: EvaluationFailure["reason"],
  startedAt: number,
  error?: unknown
): EvaluationFailure {
  return {
    ok: false,
    reason,
    latencyMs: Math.round(performance.now() - startedAt),
    ...(error === undefined
      ? {}
      : {
          error: (error instanceof Error ? error.message : String(error)).slice(
            0,
            500
          ),
        }),
  };
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

/** Primary path: one parallel pass over all questions, typed answers back. */
export const evaluateWithDecisionModel: DecisionEvaluator = async (input) => {
  const startedAt = performance.now();
  const gateway = resolveGateway();
  if (!gateway) return failure("unconfigured", startedAt);
  if (Date.now() < breakerOpenUntil) return failure("circuit_open", startedAt);

  const model = process.env.DECISION_MODEL?.trim() || DEFAULT_DECISION_MODEL;
  try {
    const result = await evaluate({
      model: gateway.evaluationModel(model),
      state: input.state as Parameters<typeof evaluate>[0]["state"],
      questions: input.questions as Parameters<typeof evaluate>[0]["questions"],
      providerOptions: gatewayOptions(input),
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(input.timeoutMs),
    });
    noteResult(true, Date.now());
    const confidence = (
      result.providerMetadata as
        | { typesafe?: { confidence?: Record<string, number> } }
        | undefined
    )?.typesafe?.confidence;
    return {
      ok: true,
      answers: result.answers as DecisionAnswers,
      confidence: confidence ?? {},
      usage: {
        latencyMs: Math.round(performance.now() - startedAt),
        inputTokens: result.usage?.inputTokens ?? null,
        costUsd: gatewayCost(result.providerMetadata),
        model,
      },
    };
  } catch (error) {
    noteResult(false, Date.now());
    return failure(isTimeout(error) ? "timeout" : "error", startedAt, error);
  }
};

function questionSchema(question: DecisionQuestion): z.ZodTypeAny {
  if (question.type === "boolean") return z.boolean();
  if (question.type === "score") {
    return z
      .number()
      .int()
      .min(0)
      .max(question.criteria.length - 1);
  }
  const options = Object.keys(question.criteria);
  return z.enum(options as [string, ...string[]]);
}

/** Map a language model's plain answers onto the evaluation answer shape. */
export function normalizeEscalationAnswers(
  questions: Readonly<Record<string, DecisionQuestion>>,
  raw: Record<string, unknown>
): DecisionAnswers {
  const answers: DecisionAnswers = {};
  for (const [id, question] of Object.entries(questions)) {
    const value = raw[id];
    if (question.type === "boolean" && typeof value === "boolean") {
      answers[id] = { type: "boolean", probability: value ? 1 : 0 };
    } else if (question.type === "score" && typeof value === "number") {
      answers[id] = {
        type: "score",
        score: value,
        probabilities: { [String(value)]: 1 },
      };
    } else if (question.type === "choice" && typeof value === "string") {
      answers[id] = {
        type: "choice",
        choice: value,
        probabilities: { [value]: 1 },
      };
    }
  }
  return answers;
}

/** Second opinion for the uncertain band: same questions, a language model. */
export const evaluateWithLanguageModel: DecisionEvaluator = async (input) => {
  const startedAt = performance.now();
  const gateway = resolveGateway();
  if (!gateway) return failure("unconfigured", startedAt);

  const model =
    process.env.DECISION_ESCALATION_MODEL?.trim() || DEFAULT_ESCALATION_MODEL;
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [id, question] of Object.entries(input.questions)) {
    shape[id] = questionSchema(question);
  }
  try {
    const result = await generateText({
      model: gateway(model),
      providerOptions: gatewayOptions(input),
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(ESCALATION_TIMEOUT_MS),
      output: Output.object({ schema: z.object(shape) }),
      instructions:
        "You are a careful evaluator. Answer each question strictly from the STATE. For a score question return the zero-based index of the best matching level. For a choice question return one option key.",
      prompt: `QUESTIONS:\n${JSON.stringify(input.questions, null, 1)}\n\nSTATE:\n${JSON.stringify(input.state, null, 1)}`,
    });
    return {
      ok: true,
      answers: normalizeEscalationAnswers(
        input.questions,
        result.output as Record<string, unknown>
      ),
      confidence: {},
      usage: {
        latencyMs: Math.round(performance.now() - startedAt),
        inputTokens: result.usage?.inputTokens ?? null,
        costUsd: gatewayCost(result.providerMetadata),
        model,
      },
    };
  } catch (error) {
    return failure(isTimeout(error) ? "timeout" : "error", startedAt, error);
  }
};
