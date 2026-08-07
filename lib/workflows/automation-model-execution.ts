import {
  generateText,
  type LanguageModelMiddleware,
  type LanguageModelUsage,
  type ProviderMetadata,
  wrapLanguageModel,
} from "ai";
import { Agent, type Dispatcher } from "undici";
import { demoteStaleToolOutputs } from "@/lib/agents/compaction/reduce";
import {
  captureUsage,
  EMPTY_CAPTURED_USAGE,
  fillUsageGaps,
  hasCapturedUsage,
  mergeUsage,
  type CapturedUsage,
} from "@/lib/observability/usage";
import {
  AUTOMATION_MODEL_MAX_GENERATE_RETRIES,
  getAutomationGenerateTimeoutMs,
  getEffectiveAutomationTimeoutMs,
} from "@/lib/workflows/automation-model-defaults";
import type {
  AutomationGenerateRetryState,
  AutomationGatewayRoutingMetadata,
  AutomationGatewayRoutingState,
  AutomationModelFailureClass,
  AutomationModelFailureInfo,
  GenerateTextRequest,
} from "./automation-model-execution-types";
import { isAutomationWrappableLanguageModel } from "./automation-model-execution-types";
import {
  AutomationModelExecutionError,
  classifyAutomationModelError,
  isAutomationModelExecutionError,
} from "./automation-model-execution-errors";
import {
  buildAutomationGatewayRoutingMetadata,
  captureGatewayModelRouting,
} from "./automation-model-execution-gateway";

// Re-export types from split modules
export type {
  AutomationModelFailureClass,
  AutomationModelFailureInfo,
  AutomationGatewayModelAttempt,
  AutomationModelExecutionMetadata,
} from "./automation-model-execution-types";

// Re-export functions and class from split modules
export {
  AutomationModelExecutionError,
  isAutomationModelExecutionError,
  classifyAutomationModelError,
} from "./automation-model-execution-errors";

// Re-export from automation-model-defaults
export {
  AUTOMATION_MODEL_DEFAULT_TIMEOUT_MS,
  AUTOMATION_MODEL_DEFAULT_TOTAL_BUDGET_MS,
  AUTOMATION_MODEL_MAX_GENERATE_RETRIES,
  AUTOMATION_MODEL_TIMEOUT_FLOOR_MS,
  getAutomationGenerateTimeoutMs,
  getEffectiveAutomationTimeoutMs,
} from "@/lib/workflows/automation-model-defaults";

type UndiciFetchInit = RequestInit & { dispatcher?: Dispatcher };

export const AUTOMATION_DISPATCHER_CACHE_MAX_ENTRIES = 32;

const automationDispatcherByTimeoutMs = new Map<number, Dispatcher>();

function getAutomationFetchDispatcher(timeoutMs: number): Dispatcher {
  const cachedDispatcher = automationDispatcherByTimeoutMs.get(timeoutMs);
  if (cachedDispatcher) {
    automationDispatcherByTimeoutMs.delete(timeoutMs);
    automationDispatcherByTimeoutMs.set(timeoutMs, cachedDispatcher);
    return cachedDispatcher;
  }

  if (
    automationDispatcherByTimeoutMs.size >=
    AUTOMATION_DISPATCHER_CACHE_MAX_ENTRIES
  ) {
    const oldestEntry = automationDispatcherByTimeoutMs.entries().next();
    if (!oldestEntry.done) {
      automationDispatcherByTimeoutMs.delete(oldestEntry.value[0]);
      void oldestEntry.value[1].close().catch(() => {});
    }
  }

  const dispatcher = new Agent({
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    // Keep TCP connect waits below the full request budget while still
    // honoring shorter configured timeouts when the floor is overridden.
    connectTimeout: Math.min(timeoutMs, 30_000),
  });
  automationDispatcherByTimeoutMs.set(timeoutMs, dispatcher);
  return dispatcher;
}

export function buildAutomationProviderFetch(input?: {
  timeoutMs?: number | null;
}): typeof fetch {
  const effectiveTimeoutMs = getEffectiveAutomationTimeoutMs(input?.timeoutMs);
  const dispatcher = getAutomationFetchDispatcher(effectiveTimeoutMs);

  return async function automationProviderFetch(input, init) {
    const timeoutSignal = AbortSignal.timeout(effectiveTimeoutMs);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;

    return globalThis.fetch(input, {
      ...init,
      signal,
      dispatcher,
    } as UndiciFetchInit);
  };
}

export function resetAutomationDispatcherCacheForTests() {
  const dispatchers = [...automationDispatcherByTimeoutMs.values()];
  automationDispatcherByTimeoutMs.clear();
  for (const dispatcher of dispatchers) {
    void dispatcher.close().catch(() => {});
  }
}

function wrapAutomationModelForGenerateRetries(
  model: GenerateTextRequest["model"],
  retryState: AutomationGenerateRetryState
): GenerateTextRequest["model"] {
  let wrappedModel = model;

  if (
    AUTOMATION_MODEL_MAX_GENERATE_RETRIES > 0 &&
    isAutomationWrappableLanguageModel(model)
  ) {
    const middleware: LanguageModelMiddleware = {
      specificationVersion: "v3",
      async wrapGenerate({ doGenerate }) {
        try {
          return await doGenerate();
        } catch (error) {
          const failure = classifyAutomationModelError(error);
          if (
            retryState.retryCount >= AUTOMATION_MODEL_MAX_GENERATE_RETRIES ||
            !failure.retryable
          ) {
            throw error;
          }

          retryState.retryCount += 1;
          retryState.recoveredFromFailureClass ??= failure.classification;
          retryState.recoveredFromMessage ??= failure.rawMessage;

          return await doGenerate();
        }
      },
    };

    wrappedModel = wrapLanguageModel({ model, middleware });
  }

  return wrappedModel;
}

function buildAutomationExecutionMetadata(input: {
  phase: string;
  effectiveTimeoutMs: number;
  retryState: AutomationGenerateRetryState;
  gatewayRoutingState: AutomationGatewayRoutingState;
  finalFailure: AutomationModelFailureInfo | null;
}) {
  return {
    phase: input.phase,
    attempts: input.retryState.retryCount + 1,
    retryCount: input.retryState.retryCount,
    retried: input.retryState.retryCount > 0,
    effectiveTimeoutMs: input.effectiveTimeoutMs,
    recoveredFromFailureClass: input.retryState.recoveredFromFailureClass,
    recoveredFromMessage: input.retryState.recoveredFromMessage,
    finalFailureClass: input.finalFailure?.classification ?? null,
    finalFailureMessage: input.finalFailure?.rawMessage ?? null,
    finalFailureStatusCode: input.finalFailure?.statusCode ?? null,
    ...buildAutomationGatewayRoutingMetadata(input.gatewayRoutingState),
  };
}

export function asAutomationModelExecutionError(input: {
  error: unknown;
  phase: string;
  timeoutMs?: number | null;
  attempts?: number;
  retryCount?: number;
  retried?: boolean;
  observedInputTokens?: number | null;
  observedOutputTokens?: number | null;
  observedUsage?: CapturedUsage | null;
  recoveredFromFailureClass?: AutomationModelFailureClass | null;
  recoveredFromMessage?: string | null;
  gatewayRoutingMetadata?: Partial<AutomationGatewayRoutingMetadata>;
}) {
  if (isAutomationModelExecutionError(input.error)) {
    return input.error;
  }

  const failure = classifyAutomationModelError(input.error);
  const retryCount = input.retryCount ?? 0;
  const retried = input.retried ?? retryCount > 0;
  const observedUsage = input.observedUsage ?? null;
  const hasObservedUsage =
    input.observedInputTokens != null ||
    input.observedOutputTokens != null ||
    (observedUsage != null && hasCapturedUsage(observedUsage));

  return new AutomationModelExecutionError({
    failure,
    metadata: {
      phase: input.phase,
      attempts: input.attempts ?? 0,
      retryCount,
      retried,
      effectiveTimeoutMs: getEffectiveAutomationTimeoutMs(input.timeoutMs),
      ...(hasObservedUsage
        ? {
            observedInputTokens: input.observedInputTokens ?? null,
            observedOutputTokens: input.observedOutputTokens ?? null,
            observedUsage,
          }
        : {}),
      recoveredFromFailureClass: input.recoveredFromFailureClass ?? null,
      recoveredFromMessage: input.recoveredFromMessage ?? null,
      finalFailureClass: failure.classification,
      finalFailureMessage: failure.rawMessage,
      finalFailureStatusCode: failure.statusCode,
      ...input.gatewayRoutingMetadata,
    },
    cause: input.error,
  });
}

export async function executeAutomationTextGeneration(input: {
  phase: string;
  requestedModelId?: string | null;
  /** The pinned id, when a deprecated-model upgrade substituted a successor. */
  pinnedModelId?: string | null;
  generateText: typeof generateText;
  request: Omit<GenerateTextRequest, "maxRetries" | "timeout">;
  timeoutMs?: number | null;
}) {
  const effectiveTimeoutMs = getEffectiveAutomationTimeoutMs(input.timeoutMs);
  const generateTimeoutMs = getAutomationGenerateTimeoutMs(input.timeoutMs);
  const requestOnStepFinish = input.request.onStepFinish;
  const retryState: AutomationGenerateRetryState = {
    retryCount: 0,
    recoveredFromFailureClass: null,
    recoveredFromMessage: null,
  };
  const gatewayRoutingState: AutomationGatewayRoutingState = {
    requestedModelId: input.requestedModelId?.trim() || null,
    pinnedModelId: input.pinnedModelId?.trim() || null,
    modelAttempts: [],
    modelAttemptCount: 0,
    effectiveModelIds: [],
  };
  const observedStepUsages: CapturedUsage[] = [];
  const readObservedUsage = () =>
    observedStepUsages.reduce(
      (usage, stepUsage) => mergeUsage(usage, stepUsage),
      EMPTY_CAPTURED_USAGE
    );
  const model = wrapAutomationModelForGenerateRetries(
    input.request.model,
    retryState
  );
  const onStepFinish: NonNullable<GenerateTextRequest["onStepFinish"]> = async (
    event
  ) => {
    observedStepUsages.push(captureUsage(event.usage, event.providerMetadata));
    captureGatewayModelRouting(gatewayRoutingState, event.providerMetadata);
    await requestOnStepFinish?.(event);
  };

  // Keep AI SDK generateText retries disabled so we can retry a single
  // model-generation step without replaying the full tool loop.
  const buildRequest = () =>
    ({
      ...input.request,
      model,
      onStepFinish,
      // Step-level context reduction: demote stale oversized tool outputs to
      // typed references so a long automation tool loop cannot outgrow the
      // window on dead payloads. Deterministic — no model call.
      prepareStep:
        input.request.prepareStep ??
        (({ messages }) => {
          const reduced = demoteStaleToolOutputs(messages);
          return reduced === messages ? undefined : { messages: reduced };
        }),
      maxRetries: 0,
      timeout: generateTimeoutMs,
    }) as GenerateTextRequest;

  try {
    const result = await input.generateText(buildRequest());
    if (gatewayRoutingState.modelAttemptCount === 0) {
      captureGatewayModelRouting(
        gatewayRoutingState,
        result.providerMetadata as ProviderMetadata | undefined
      );
    }
    const totalCapturedUsage = captureUsage(
      result.totalUsage as LanguageModelUsage | undefined,
      result.providerMetadata as ProviderMetadata | undefined
    );
    const observedUsage = readObservedUsage();
    // Union generation IDs from both sources to capture any ID that the SDK
    // surfaces only on the final aggregate (not per-step).
    const finalUsage = fillUsageGaps(
      {
        ...totalCapturedUsage,
        generationId:
          observedUsage.generationId ?? totalCapturedUsage.generationId,
        generationIds: [
          ...new Set([
            ...observedUsage.generationIds,
            ...totalCapturedUsage.generationIds,
          ]),
        ],
      },
      observedUsage
    );
    return {
      result,
      metadata: {
        ...buildAutomationExecutionMetadata({
          phase: input.phase,
          effectiveTimeoutMs,
          retryState,
          gatewayRoutingState,
          finalFailure: null,
        }),
        ...(hasCapturedUsage(finalUsage)
          ? {
              observedInputTokens: finalUsage.inputTokens,
              observedOutputTokens: finalUsage.outputTokens,
              observedUsage: finalUsage,
            }
          : {}),
      },
    };
  } catch (error) {
    const observedUsage = readObservedUsage();
    const observedInputTokens = observedUsage.inputTokens;
    const observedOutputTokens = observedUsage.outputTokens;
    throw asAutomationModelExecutionError({
      error,
      phase: input.phase,
      timeoutMs: input.timeoutMs,
      attempts: retryState.retryCount + 1,
      retryCount: retryState.retryCount,
      retried: retryState.retryCount > 0,
      observedInputTokens,
      observedOutputTokens,
      observedUsage,
      recoveredFromFailureClass: retryState.recoveredFromFailureClass,
      recoveredFromMessage: retryState.recoveredFromMessage,
      gatewayRoutingMetadata:
        buildAutomationGatewayRoutingMetadata(gatewayRoutingState),
    });
  }
}
