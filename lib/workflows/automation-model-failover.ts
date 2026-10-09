import { type LanguageModelMiddleware, wrapLanguageModel } from "ai";
import { AUTOMATION_MODEL_MAX_GENERATE_RETRIES } from "@/lib/workflows/automation-model-defaults";
import type {
  AutomationGenerateRetryState,
  AutomationModelFailureInfo,
  AutomationWrappableLanguageModel,
  GenerateTextRequest,
} from "./automation-model-execution-types";
import {
  isAutomationWrappableLanguageModel,
  isRecord,
} from "./automation-model-execution-types";
import {
  automationStepBudgetExhaustedError,
  classifyAutomationModelError,
} from "./automation-model-execution-errors";
import {
  logAutomationModelFailover,
  logAutomationProviderAttemptFailure,
  type AutomationModelLogContext,
  type AutomationModelLogger,
} from "./automation-model-logging";

/** A policy-approved fallback, resolved on the same transport as the primary. */
export type AutomationFallbackModel = {
  modelId: string;
  model: GenerateTextRequest["model"];
};

export type AutomationModelRecovery = "fail_over" | "retry_same" | "fail";

// The request never reached a model: the gateway itself was unreachable.
// Every model sits behind the same gateway, so switching cannot help; a second
// try on the same model can.
const GATEWAY_UNREACHABLE_CODES = new Set([
  "econnrefused",
  "enotfound",
  "eai_again",
  "und_err_connect_timeout",
]);

/**
 * Decides what a failed model request should do next, from its HTTP status
 * and transport error code.
 *
 * - `fail_over`: the request reached the model and the model side failed:
 *   5xx, 408, 429, a response that never finished (timeout), or a connection
 *   dropped mid-request (`UND_ERR_SOCKET`, `ECONNRESET`). Asking the same
 *   model again usually costs another full wait for the same failure, so the
 *   next fallback model takes the request.
 * - `retry_same`: the gateway was unreachable before any model saw the
 *   request; another model would fail the same way.
 * - `fail`: the request itself or the account is wrong (400, 401/403, 402,
 *   404, 422, unknown). No model choice fixes it.
 */
export function decideAutomationModelRecovery(
  failure: AutomationModelFailureInfo
): AutomationModelRecovery {
  if (!failure.retryable) return "fail";
  // Retryable, but raised by Mogplex's own allowlist read during model
  // resolution, never by a model; no model switch or re-send can fix it.
  if (failure.classification === "dependency_unavailable") return "fail";

  const code = failure.errorCode?.toLowerCase() ?? "";
  if (failure.statusCode == null && GATEWAY_UNREACHABLE_CODES.has(code)) {
    return "retry_same";
  }
  return "fail_over";
}

// Fallbacks are called from inside a v4 middleware with v4 call options, so
// only v4 models can take over. Gateway models are v4.
type V4LanguageModel = Extract<
  AutomationWrappableLanguageModel,
  { specificationVersion: "v4" }
>;
type CallOptions = Parameters<V4LanguageModel["doGenerate"]>[0];

function isV4LanguageModel(
  model: GenerateTextRequest["model"]
): model is V4LanguageModel {
  return (
    isAutomationWrappableLanguageModel(model) &&
    model.specificationVersion === "v4"
  );
}

/**
 * Points the gateway's own fallback list at the candidates after the active
 * model, so a failed-over request never routes back to a model this run has
 * already given up on.
 */
function withRemainingGatewayModels(
  params: CallOptions,
  remainingModelIds: string[]
): CallOptions {
  const providerOptions = params.providerOptions;
  if (!isRecord(providerOptions) || !isRecord(providerOptions.gateway)) {
    return params;
  }
  const { models: _models, ...gateway } = providerOptions.gateway;
  return {
    ...params,
    providerOptions: {
      ...providerOptions,
      gateway:
        remainingModelIds.length > 0
          ? { ...gateway, models: remainingModelIds }
          : gateway,
    },
  };
}

function usableFallbacks(fallbackModels: readonly AutomationFallbackModel[]) {
  return fallbackModels.flatMap((fallback) =>
    isV4LanguageModel(fallback.model)
      ? [{ modelId: fallback.modelId, model: fallback.model }]
      : []
  );
}

/**
 * What this attempt's failure leads to, given what the run has left: the next
 * fallback, one more try on the same model, or giving up.
 */
function planNextAttempt(input: {
  failure: AutomationModelFailureInfo;
  retryState: AutomationGenerateRetryState;
  hasNextFallback: boolean;
  generationAborted: boolean;
  stepBudgetSpent: boolean;
}): AutomationModelRecovery {
  // The generation's own signal (its budget or a cancellation) fired. Every
  // further attempt shares that signal and would abort before sending, so
  // trying another model would only record attempts that never happened.
  if (input.generationAborted) return "fail";
  // Fail-overs and retries share the step's clock. Each attempt gets a fresh
  // per-request timeout, so without this a long fallback chain would multiply
  // a step's worst case; with it the chain ends where a step's budget did
  // before fail-over existed, while fast failures still walk the chain.
  if (input.stepBudgetSpent) return "fail";
  const recovery = decideAutomationModelRecovery(input.failure);
  if (recovery === "fail") return "fail";
  if (recovery === "fail_over" && input.hasNextFallback) return "fail_over";

  const sameModelRetries =
    input.retryState.retryCount - input.retryState.failoverModelIds.length;
  return sameModelRetries < AUTOMATION_MODEL_MAX_GENERATE_RETRIES
    ? "retry_same"
    : "fail";
}

function createRecoveryMiddleware(input: {
  primaryModelId: string;
  fallbacks: { modelId: string; model: V4LanguageModel }[];
  retryState: AutomationGenerateRetryState;
  logger: AutomationModelLogger;
  logContext: AutomationModelLogContext;
  stepBudgetMs: number | undefined;
  now: () => number;
}): LanguageModelMiddleware {
  const {
    primaryModelId,
    fallbacks,
    retryState,
    logger,
    logContext,
    stepBudgetMs,
    now,
  } = input;
  let activeFallbackIndex = -1;

  function activeModelId() {
    return activeFallbackIndex < 0
      ? primaryModelId
      : fallbacks[activeFallbackIndex].modelId;
  }

  return {
    specificationVersion: "v4",
    async wrapGenerate({ doGenerate, params }) {
      const stepStartedAt = now();
      for (;;) {
        // Compute remaining budget before each attempt so an attempt that would
        // start past the budget never runs. For fallback models, we also abort
        // in-flight attempts when the budget expires, making this a true ceiling
        // for those paths. The primary model path skips mid-request abort by
        // design: for non-review phases the SDK timeout already equals the step
        // budget, and for pr_review the per-request fetch bound (effectiveTimeoutMs
        // ~12.5m) sits under the 25m step budget. A caller with custom timeoutMs
        // above ~12.5m could see the primary outlive the step budget until its
        // fetch timeout fires; this gap was considered acceptable versus the
        // complexity of injecting an abort signal into the middleware chain.
        const remainingBudgetMs =
          stepBudgetMs === undefined
            ? undefined
            : Math.max(0, stepBudgetMs - (now() - stepStartedAt));
        const budgetSpent = remainingBudgetMs === 0;

        if (budgetSpent) {
          throw automationStepBudgetExhaustedError(
            "Step budget exhausted before starting the next attempt"
          );
        }

        // Budget abort only works for fallback models where we control the call
        let budgetTimeout: ReturnType<typeof setTimeout> | undefined;
        const budgetController =
          activeFallbackIndex >= 0 && remainingBudgetMs !== undefined
            ? new AbortController()
            : undefined;
        if (budgetController && remainingBudgetMs !== undefined) {
          budgetTimeout = setTimeout(
            () => budgetController.abort(),
            remainingBudgetMs
          );
        }

        try {
          if (activeFallbackIndex < 0) {
            return await doGenerate();
          }
          const mergedSignal =
            budgetController && params.abortSignal
              ? AbortSignal.any([params.abortSignal, budgetController.signal])
              : (budgetController?.signal ?? params.abortSignal);
          const callParams = mergedSignal
            ? { ...params, abortSignal: mergedSignal }
            : params;
          const remaining = fallbacks
            .slice(activeFallbackIndex + 1)
            .map((fallback) => fallback.modelId);
          return await fallbacks[activeFallbackIndex].model.doGenerate(
            withRemainingGatewayModels(callParams, remaining)
          );
        } catch (error) {
          // If the budget controller fired, surface it as our typed error so the
          // classification lands in `timeout` rather than whatever the provider
          // wrapped the abort as (often `provider_unavailable` via UND_ERR_SOCKET).
          const budgetAborted = budgetController?.signal.aborted === true;
          const effectiveError = budgetAborted
            ? automationStepBudgetExhaustedError(
                "Step budget exhausted during request"
              )
            : error;
          const failure = classifyAutomationModelError(effectiveError);
          const next = planNextAttempt({
            failure,
            retryState,
            hasNextFallback: activeFallbackIndex + 1 < fallbacks.length,
            generationAborted:
              params.abortSignal?.aborted === true || budgetAborted,
            stepBudgetSpent:
              stepBudgetMs !== undefined &&
              now() - stepStartedAt >= stepBudgetMs,
          });
          logAutomationProviderAttemptFailure({
            logger,
            context: logContext,
            error: effectiveError,
            failure,
            attempt: retryState.retryCount + 1,
            willRetry: next !== "fail",
          });
          if (next === "fail") throw effectiveError;

          retryState.retryCount += 1;
          retryState.recoveredFromFailureClass ??= failure.classification;
          retryState.recoveredFromMessage ??= failure.rawMessage;
          if (next === "fail_over") {
            const fromModelId = activeModelId();
            activeFallbackIndex += 1;
            const toModelId = fallbacks[activeFallbackIndex].modelId;
            retryState.failoverModelIds.push(toModelId);
            logAutomationModelFailover({
              logger,
              context: logContext,
              failure,
              fromModelId,
              toModelId,
            });
          }
        } finally {
          if (budgetTimeout !== undefined) {
            clearTimeout(budgetTimeout);
          }
        }
      }
    },
  };
}

/**
 * Generate-only: the middleware implements `wrapGenerate` and nothing else,
 * so a streaming call passes through with no retry or fail-over. Automation
 * generation uses `generateText` today; add a `wrapStream` counterpart before
 * any automation path streams.
 *
 * Wraps the primary model so each generation step recovers from a provider
 * failure according to {@link decideAutomationModelRecovery}. A fail-over is
 * sticky for the rest of this generation: once the primary has failed, later
 * tool-loop steps start on the fallback rather than waiting on the primary
 * again. Same-model retries share the existing per-generation budget.
 *
 * `stepBudgetMs` is how long one step may keep starting new attempts; a
 * failure after that surfaces instead of moving down the chain.
 */
export function wrapAutomationModelForRecovery(input: {
  model: GenerateTextRequest["model"];
  fallbackModels?: readonly AutomationFallbackModel[];
  retryState: AutomationGenerateRetryState;
  logger: AutomationModelLogger;
  logContext: AutomationModelLogContext;
  stepBudgetMs?: number;
  now?: () => number;
}): GenerateTextRequest["model"] {
  let wrappedModel = input.model;
  const fallbacks = usableFallbacks(input.fallbackModels ?? []);

  if (
    isAutomationWrappableLanguageModel(input.model) &&
    (AUTOMATION_MODEL_MAX_GENERATE_RETRIES > 0 || fallbacks.length > 0)
  ) {
    wrappedModel = wrapLanguageModel({
      model: input.model,
      middleware: createRecoveryMiddleware({
        ...input,
        primaryModelId: input.model.modelId,
        fallbacks,
        stepBudgetMs: input.stepBudgetMs,
        now: input.now ?? Date.now,
      }),
    });
  }

  return wrappedModel;
}
