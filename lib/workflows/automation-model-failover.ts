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
import { classifyAutomationModelError } from "./automation-model-execution-errors";
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
}): AutomationModelRecovery {
  // The generation's own signal (its budget or a cancellation) fired. Every
  // further attempt shares that signal and would abort before sending, so
  // trying another model would only record attempts that never happened.
  if (input.generationAborted) return "fail";
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
  fallbacks: { modelId: string; model: V4LanguageModel }[];
  retryState: AutomationGenerateRetryState;
  logger: AutomationModelLogger;
  logContext: AutomationModelLogContext;
}): LanguageModelMiddleware {
  const { fallbacks, retryState, logger, logContext } = input;
  let activeFallbackIndex = -1;

  return {
    specificationVersion: "v4",
    async wrapGenerate({ doGenerate, params }) {
      for (;;) {
        try {
          if (activeFallbackIndex < 0) return await doGenerate();
          const remaining = fallbacks
            .slice(activeFallbackIndex + 1)
            .map((fallback) => fallback.modelId);
          return await fallbacks[activeFallbackIndex].model.doGenerate(
            withRemainingGatewayModels(params, remaining)
          );
        } catch (error) {
          const failure = classifyAutomationModelError(error);
          const next = planNextAttempt({
            failure,
            retryState,
            hasNextFallback: activeFallbackIndex + 1 < fallbacks.length,
            generationAborted: params.abortSignal?.aborted === true,
          });
          logAutomationProviderAttemptFailure({
            logger,
            context: logContext,
            error,
            failure,
            attempt: retryState.retryCount + 1,
            willRetry: next !== "fail",
          });
          if (next === "fail") throw error;

          retryState.retryCount += 1;
          retryState.recoveredFromFailureClass ??= failure.classification;
          retryState.recoveredFromMessage ??= failure.rawMessage;
          if (next === "fail_over") {
            activeFallbackIndex += 1;
            const toModelId = fallbacks[activeFallbackIndex].modelId;
            retryState.failoverModelIds.push(toModelId);
            logAutomationModelFailover({
              logger,
              context: logContext,
              failure,
              toModelId,
            });
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
 */
export function wrapAutomationModelForRecovery(input: {
  model: GenerateTextRequest["model"];
  fallbackModels?: readonly AutomationFallbackModel[];
  retryState: AutomationGenerateRetryState;
  logger: AutomationModelLogger;
  logContext: AutomationModelLogContext;
}): GenerateTextRequest["model"] {
  let wrappedModel = input.model;
  const fallbacks = usableFallbacks(input.fallbackModels ?? []);

  if (
    isAutomationWrappableLanguageModel(input.model) &&
    (AUTOMATION_MODEL_MAX_GENERATE_RETRIES > 0 || fallbacks.length > 0)
  ) {
    wrappedModel = wrapLanguageModel({
      model: input.model,
      middleware: createRecoveryMiddleware({ ...input, fallbacks }),
    });
  }

  return wrappedModel;
}
