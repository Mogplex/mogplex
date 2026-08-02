import {
  generateText,
  type LanguageModelMiddleware,
  type LanguageModelUsage,
  type ProviderMetadata,
  wrapLanguageModel,
} from "ai";
import { Agent, type Dispatcher } from "undici";
import {
  captureUsage,
  EMPTY_CAPTURED_USAGE,
  fillUsageGaps,
  hasCapturedUsage,
  mergeUsage,
  type CapturedUsage,
} from "@/lib/observability/usage";
import { MODEL_ALLOWLIST_UNAVAILABLE_CODE } from "@/lib/team-capabilities";
import {
  AUTOMATION_MODEL_MAX_GENERATE_RETRIES,
  getAutomationGenerateTimeoutMs,
  getEffectiveAutomationTimeoutMs,
} from "@/lib/workflows/automation-model-defaults";

export {
  AUTOMATION_MODEL_DEFAULT_TIMEOUT_MS,
  AUTOMATION_MODEL_DEFAULT_TOTAL_BUDGET_MS,
  AUTOMATION_MODEL_MAX_GENERATE_RETRIES,
  AUTOMATION_MODEL_TIMEOUT_FLOOR_MS,
  getAutomationGenerateTimeoutMs,
  getEffectiveAutomationTimeoutMs,
} from "@/lib/workflows/automation-model-defaults";

type GenerateTextRequest = Parameters<typeof generateText>[0];
type AutomationWrappableLanguageModel = Extract<
  GenerateTextRequest["model"],
  { specificationVersion: "v3" }
>;
type UndiciFetchInit = RequestInit & { dispatcher?: Dispatcher };

export const AUTOMATION_DISPATCHER_CACHE_MAX_ENTRIES = 32;

const automationDispatcherByTimeoutMs = new Map<number, Dispatcher>();

export type AutomationModelFailureClass =
  | "timeout"
  | "rate_limited"
  | "provider_unavailable"
  // A Mogplex-side dependency needed to authorize the run was unreachable —
  // not the model provider, which is why this is not provider_unavailable:
  // "provider was unavailable" would send an operator to the wrong dashboard.
  | "dependency_unavailable"
  | "authentication"
  | "configuration"
  | "unknown";

export type AutomationModelFailureInfo = {
  classification: AutomationModelFailureClass;
  /**
   * Describes the *failure* — transient vs permanent — not a promise that
   * anything retries it. Read this before wiring a retry loop off it.
   *
   * Only the generate-level middleware acts on it, and only for errors thrown
   * from an already-resolved model. A resolution-time failure (notably
   * `dependency_unavailable`) never reaches that middleware, and
   * trigger/automation-job.ts aborts every model failure on purpose: by then
   * the run has published a GitHub check run and PR comment and written its
   * telemetry, so a re-run duplicates all of it on a real PR.
   *
   * Generic retry driven off this flag would silently reintroduce that
   * double-comment bug. Resolution-time retry belongs at the resolution call
   * site, ahead of those side effects — tracked in #766.
   */
  retryable: boolean;
  rawMessage: string;
  message: string;
  statusCode: number | null;
  errorName: string | null;
  errorCode: string | null;
};

export type AutomationGatewayModelAttempt = {
  canonicalSlug: string;
  modelId: string | null;
  success: boolean;
  providerAttemptCount: number | null;
};

export type AutomationModelExecutionMetadata = {
  phase: string;
  attempts: number;
  retryCount: number;
  retried: boolean;
  effectiveTimeoutMs: number;
  observedInputTokens?: number | null;
  observedOutputTokens?: number | null;
  observedUsage?: CapturedUsage | null;
  recoveredFromFailureClass: AutomationModelFailureClass | null;
  recoveredFromMessage: string | null;
  finalFailureClass: AutomationModelFailureClass | null;
  finalFailureMessage: string | null;
  finalFailureStatusCode: number | null;
  requestedModelId?: string;
  // The id the automation was pinned to, when a deprecated-model upgrade
  // substituted a successor before the request. Present only when a
  // substitution happened, so its absence means "ran on what was pinned".
  // Without it, an upgraded run is indistinguishable in ai_calls from one that
  // was always pinned to the successor — and this feature changes which model
  // bills, so support needs that evidence per run.
  pinnedModelId?: string;
  gatewayModelAttempts?: AutomationGatewayModelAttempt[];
  gatewayModelAttemptCount?: number;
  effectiveModelIds?: string[];
  fallbackUsed?: boolean;
};

type AutomationGenerateRetryState = {
  retryCount: number;
  recoveredFromFailureClass: AutomationModelFailureClass | null;
  recoveredFromMessage: string | null;
};

type AutomationGatewayRoutingState = {
  requestedModelId: string | null;
  pinnedModelId?: string | null;
  modelAttempts: AutomationGatewayModelAttempt[];
  modelAttemptCount: number;
  effectiveModelIds: string[];
};

type AutomationGatewayRoutingMetadata = Pick<
  AutomationModelExecutionMetadata,
  | "requestedModelId"
  | "pinnedModelId"
  | "gatewayModelAttempts"
  | "gatewayModelAttemptCount"
  | "effectiveModelIds"
  | "fallbackUsed"
>;

type AutomationErrorSignals = {
  rawMessage: string;
  combinedMessage: string;
  errorName: string | null;
  lowerName: string;
  errorCode: string | null;
  lowerCode: string;
  statusCode: number | null;
};

export class AutomationModelExecutionError extends Error {
  readonly failure: AutomationModelFailureInfo;
  readonly metadata: AutomationModelExecutionMetadata;

  constructor(input: {
    failure: AutomationModelFailureInfo;
    metadata: AutomationModelExecutionMetadata;
    cause: unknown;
  }) {
    super(input.failure.message, { cause: input.cause });
    this.name = "AutomationModelExecutionError";
    this.failure = input.failure;
    this.metadata = input.metadata;
  }
}

export function isAutomationModelExecutionError(
  error: unknown
): error is AutomationModelExecutionError {
  if (error instanceof AutomationModelExecutionError) {
    return true;
  }

  if (!isRecord(error) || error.name !== "AutomationModelExecutionError") {
    return false;
  }

  const { metadata, failure } = error;

  return (
    isAutomationExecutionMetadata(metadata) &&
    isAutomationFailureRecord(failure)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAutomationGatewayModelAttempt(
  value: unknown
): value is AutomationGatewayModelAttempt {
  return (
    isRecord(value) &&
    typeof value.canonicalSlug === "string" &&
    (value.modelId === null || typeof value.modelId === "string") &&
    typeof value.success === "boolean" &&
    (value.providerAttemptCount === null ||
      typeof value.providerAttemptCount === "number")
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function hasOptionalField(
  value: Record<string, unknown>,
  key: string,
  isValid: (field: unknown) => boolean
) {
  return !(key in value) || isValid(value[key]);
}

function hasValidAutomationExecutionCore(value: Record<string, unknown>) {
  return (
    typeof value.phase === "string" &&
    typeof value.attempts === "number" &&
    typeof value.retryCount === "number" &&
    typeof value.retried === "boolean" &&
    typeof value.effectiveTimeoutMs === "number"
  );
}

function hasValidAutomationExecutionUsage(value: Record<string, unknown>) {
  const isNullableNumber = (field: unknown) =>
    field == null || typeof field === "number";
  return (
    hasOptionalField(value, "observedInputTokens", isNullableNumber) &&
    hasOptionalField(value, "observedOutputTokens", isNullableNumber)
  );
}

function hasValidAutomationGatewayRouting(value: Record<string, unknown>) {
  return (
    hasOptionalField(
      value,
      "requestedModelId",
      (field) => typeof field === "string"
    ) &&
    hasOptionalField(
      value,
      "pinnedModelId",
      (field) => typeof field === "string"
    ) &&
    hasOptionalField(
      value,
      "gatewayModelAttempts",
      (field) =>
        Array.isArray(field) && field.every(isAutomationGatewayModelAttempt)
    ) &&
    hasOptionalField(
      value,
      "gatewayModelAttemptCount",
      (field) => typeof field === "number"
    ) &&
    hasOptionalField(value, "effectiveModelIds", isStringArray) &&
    hasOptionalField(
      value,
      "fallbackUsed",
      (field) => typeof field === "boolean"
    )
  );
}

function isAutomationExecutionMetadata(
  value: unknown
): value is AutomationModelExecutionMetadata {
  if (!isRecord(value)) return false;
  return (
    hasValidAutomationExecutionCore(value) &&
    hasValidAutomationExecutionUsage(value) &&
    hasValidAutomationGatewayRouting(value)
  );
}

function isAutomationFailureRecord(
  value: unknown
): value is AutomationModelFailureInfo {
  return (
    isRecord(value) &&
    typeof value.classification === "string" &&
    typeof value.retryable === "boolean"
  );
}

function isAutomationWrappableLanguageModel(
  model: GenerateTextRequest["model"]
): model is AutomationWrappableLanguageModel {
  return (
    isRecord(model) &&
    model.specificationVersion === "v3" &&
    typeof model.provider === "string" &&
    typeof model.modelId === "string" &&
    typeof model.doGenerate === "function" &&
    typeof model.doStream === "function"
  );
}

const MAX_CAPTURED_GATEWAY_MODEL_ATTEMPTS = 50;

function readGatewayModelAttempts(
  providerMetadata: ProviderMetadata | undefined
): AutomationGatewayModelAttempt[] {
  const gatewayMetadata = providerMetadata?.gateway;
  if (
    !isRecord(gatewayMetadata) ||
    !Array.isArray(gatewayMetadata.modelAttempts)
  ) {
    return [];
  }

  return gatewayMetadata.modelAttempts.flatMap((attempt) => {
    if (!isRecord(attempt)) return [];

    const canonicalSlug =
      typeof attempt.canonicalSlug === "string"
        ? attempt.canonicalSlug.trim()
        : "";
    if (!canonicalSlug || typeof attempt.success !== "boolean") return [];

    const modelId =
      typeof attempt.modelId === "string" && attempt.modelId.trim().length > 0
        ? attempt.modelId.trim()
        : null;
    const providerAttemptCount =
      typeof attempt.providerAttemptCount === "number" &&
      Number.isFinite(attempt.providerAttemptCount) &&
      attempt.providerAttemptCount >= 0
        ? Math.floor(attempt.providerAttemptCount)
        : null;

    return [
      {
        canonicalSlug,
        modelId,
        success: attempt.success,
        providerAttemptCount,
      },
    ];
  });
}

function captureGatewayModelRouting(
  state: AutomationGatewayRoutingState,
  providerMetadata: ProviderMetadata | undefined
) {
  const attempts = readGatewayModelAttempts(providerMetadata);
  if (attempts.length === 0) return;

  state.modelAttemptCount += attempts.length;
  const remainingCapacity = Math.max(
    MAX_CAPTURED_GATEWAY_MODEL_ATTEMPTS - state.modelAttempts.length,
    0
  );
  state.modelAttempts.push(...attempts.slice(0, remainingCapacity));

  for (const attempt of attempts) {
    if (!attempt.success) continue;
    const normalized = attempt.canonicalSlug.toLowerCase();
    if (
      !state.effectiveModelIds.some(
        (modelId) => modelId.toLowerCase() === normalized
      )
    ) {
      state.effectiveModelIds.push(attempt.canonicalSlug);
    }
  }
}

function buildAutomationGatewayRoutingMetadata(
  state: AutomationGatewayRoutingState
): Partial<AutomationGatewayRoutingMetadata> {
  const requestedModelId = state.requestedModelId?.trim() || null;
  const pinnedModelId = state.pinnedModelId?.trim() || null;
  const requestedModelFields = {
    ...(requestedModelId ? { requestedModelId } : {}),
    // Only recorded when it actually differs, so the field's presence is itself
    // the signal that a substitution occurred.
    ...(pinnedModelId && pinnedModelId !== requestedModelId
      ? { pinnedModelId }
      : {}),
  };
  if (state.modelAttemptCount === 0) return requestedModelFields;

  return {
    ...requestedModelFields,
    gatewayModelAttempts: state.modelAttempts,
    gatewayModelAttemptCount: state.modelAttemptCount,
    effectiveModelIds: state.effectiveModelIds,
    ...(requestedModelId
      ? {
          fallbackUsed: state.effectiveModelIds.some(
            (modelId) =>
              modelId.toLowerCase() !== requestedModelId.toLowerCase()
          ),
        }
      : {}),
  };
}

function readErrorChain(error: unknown) {
  const chain: unknown[] = [];
  let current: unknown = error;

  while (current && chain.length < 8) {
    chain.push(current);
    if (!isRecord(current) || !("cause" in current)) {
      break;
    }
    current = current.cause;
  }

  return chain;
}

function readErrorMessages(chain: unknown[]) {
  return chain
    .map((entry) => {
      if (entry instanceof Error) return entry.message;
      if (isRecord(entry) && typeof entry.message === "string") {
        return entry.message;
      }
      return null;
    })
    .filter((value): value is string => typeof value === "string")
    .filter((value) => value.trim().length > 0);
}

function readErrorName(chain: unknown[]) {
  for (const entry of chain) {
    if (entry instanceof Error && entry.name.trim().length > 0) {
      return entry.name;
    }
    if (isRecord(entry) && typeof entry.name === "string") {
      const trimmed = entry.name.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }

  return null;
}

function readErrorCode(chain: unknown[]) {
  for (const entry of chain) {
    if (isRecord(entry) && typeof entry.code === "string") {
      const trimmed = entry.code.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }

  return null;
}

function readStatusCode(chain: unknown[]) {
  for (const entry of chain) {
    if (isRecord(entry) && typeof entry.statusCode === "number") {
      return Number.isFinite(entry.statusCode) ? entry.statusCode : null;
    }
    if (isRecord(entry) && typeof entry.status === "number") {
      return Number.isFinite(entry.status) ? entry.status : null;
    }
  }

  return null;
}

function buildFailureMessage(
  classification: AutomationModelFailureClass,
  rawMessage: string
) {
  switch (classification) {
    case "timeout":
      return `Automation model request timed out: ${rawMessage}`;
    case "rate_limited":
      return `Automation model request was rate limited: ${rawMessage}`;
    case "provider_unavailable":
      return `Automation model provider was unavailable: ${rawMessage}`;
    case "dependency_unavailable":
      return `Automation could not verify run policy: ${rawMessage}`;
    case "authentication":
      return `Automation model authentication failed: ${rawMessage}`;
    case "configuration":
      return `Automation model configuration failed: ${rawMessage}`;
    default:
      return `Automation model request failed: ${rawMessage}`;
  }
}

function stripKnownAutomationErrorWrappers(message: string) {
  let normalized = message.trim();

  while (normalized.length > 0) {
    const unwrapped = normalized
      .replace(/^Invalid error response format:\s*/i, "")
      .trim();

    if (unwrapped === normalized) {
      break;
    }

    normalized = unwrapped;
  }

  return normalized.length > 0 ? normalized : message.trim();
}

function normalizeAutomationTimeoutMessage(message: string) {
  const normalized = stripKnownAutomationErrorWrappers(message);

  if (
    /^Gateway request failed:/i.test(normalized) &&
    /(timeout|timed out|aborted due to timeout)/i.test(normalized)
  ) {
    return normalized.replace(
      /^Gateway request failed:/i,
      "Gateway request timed out:"
    );
  }

  return normalized;
}

function buildAutomationErrorSignals(error: unknown): AutomationErrorSignals {
  const chain = readErrorChain(error);
  const messages = readErrorMessages(chain);
  const rawMessage = stripKnownAutomationErrorWrappers(
    messages[0] ?? "Unknown automation model error"
  );
  const combinedMessage = messages.join(" | ").toLowerCase();
  const errorName = readErrorName(chain);
  const errorCode = readErrorCode(chain);

  return {
    rawMessage,
    combinedMessage,
    errorName,
    lowerName: errorName?.toLowerCase() ?? "",
    errorCode,
    lowerCode: errorCode?.toLowerCase() ?? "",
    statusCode: readStatusCode(chain),
  };
}

function buildAutomationFailure(
  signals: AutomationErrorSignals,
  classification: AutomationModelFailureClass,
  retryable: boolean,
  rawMessage = signals.rawMessage
): AutomationModelFailureInfo {
  return {
    classification,
    retryable,
    rawMessage,
    message: buildFailureMessage(classification, rawMessage),
    statusCode: signals.statusCode,
    errorName: signals.errorName,
    errorCode: signals.errorCode,
  };
}

function isTimeoutAutomationFailure(signals: AutomationErrorSignals) {
  return (
    signals.statusCode === 408 ||
    signals.lowerCode.includes("timeout") ||
    signals.combinedMessage.includes("timeout") ||
    signals.combinedMessage.includes("timed out") ||
    signals.combinedMessage.includes("headers timeout") ||
    signals.combinedMessage.includes("body timeout") ||
    signals.combinedMessage.includes("connect timeout")
  );
}

function isRateLimitedAutomationFailure(signals: AutomationErrorSignals) {
  return signals.statusCode === 429 || signals.lowerName.includes("ratelimit");
}

function isConnectionCodeFailure(signals: AutomationErrorSignals) {
  return (
    signals.lowerCode === "econnreset" ||
    signals.lowerCode === "econnrefused" ||
    signals.lowerCode === "eai_again" ||
    signals.lowerCode === "enotfound" ||
    signals.lowerCode === "und_err_socket" ||
    signals.lowerCode === "und_err_connect_timeout"
  );
}

function isConnectionMessageFailure(signals: AutomationErrorSignals) {
  return (
    signals.combinedMessage.includes("cannot connect to api") ||
    signals.combinedMessage.includes("connection reset") ||
    signals.combinedMessage.includes("socket hang up") ||
    signals.combinedMessage.includes("network error") ||
    signals.combinedMessage.includes("fetch failed")
  );
}

function isProviderUnavailableAutomationFailure(
  signals: AutomationErrorSignals
) {
  return (
    (typeof signals.statusCode === "number" && signals.statusCode >= 500) ||
    isConnectionCodeFailure(signals) ||
    isConnectionMessageFailure(signals)
  );
}

function isDependencyUnavailableAutomationFailure(
  signals: AutomationErrorSignals
) {
  // Matches the code, not the message. The message is end-user copy
  // ("Please try again."), and rewording it must not silently drop these back
  // into "unknown" — which is the misclassification this check exists to fix.
  // readErrorCode walks the cause chain, so a wrapped throw still matches.
  return signals.errorCode === MODEL_ALLOWLIST_UNAVAILABLE_CODE;
}

function isAuthenticationAutomationFailure(signals: AutomationErrorSignals) {
  return (
    signals.statusCode === 401 ||
    signals.statusCode === 403 ||
    signals.lowerName.includes("authentication") ||
    signals.combinedMessage.includes("unauthenticated") ||
    signals.combinedMessage.includes("forbidden") ||
    signals.combinedMessage.includes("invalid api key")
  );
}

function isConfigurationAutomationFailure(signals: AutomationErrorSignals) {
  return (
    signals.statusCode === 400 ||
    signals.statusCode === 404 ||
    signals.statusCode === 422 ||
    signals.lowerName.includes("invalidrequest") ||
    signals.lowerName.includes("modelnotfound") ||
    signals.combinedMessage.includes("no openai api key configured") ||
    signals.combinedMessage.includes("no anthropic api key configured") ||
    signals.combinedMessage.includes("settings > api keys") ||
    signals.combinedMessage.includes("not supported without ai gateway") ||
    signals.combinedMessage.includes("platform ai access is not enabled") ||
    signals.combinedMessage.includes("add your own ai gateway key") ||
    signals.combinedMessage.includes("model not found") ||
    signals.combinedMessage.includes("unsupported") ||
    signals.combinedMessage.includes("invalid argument")
  );
}

export function classifyAutomationModelError(
  error: unknown
): AutomationModelFailureInfo {
  const signals = buildAutomationErrorSignals(error);

  // First, because this is the only exact-match signal here: an allowlist that
  // could not be read is identified by a code we set, while every check below
  // matches status codes or message substrings. Ordering it ahead of them means
  // a heuristic widening later cannot silently steal the classification back —
  // which is the failure this code-not-message match exists to prevent.
  //
  // Without it the failure landed in "unknown": wrong label, and the wrong
  // message ("provider was unavailable" would point at Anthropic for a Supabase
  // problem).
  //
  // `retryable: true` describes the failure; it does not mean anything retries
  // it here. The generate-retry middleware wraps doGenerate() on an
  // already-resolved model and this is thrown during *resolution*, and
  // trigger/automation-job.ts aborts every model failure because by then the run
  // has already published a GitHub check run and comment and written its
  // telemetry — re-running the job would duplicate all of it.
  //
  // Recovery for this class sits earlier instead, where it is free: loadTeam-
  // AllowlistState retries the read once before a blip can become a failure at
  // all. Retrying the other resolution-time classes needs the same placement —
  // at the resolution call site, ahead of the side effects — which is #766.
  if (isDependencyUnavailableAutomationFailure(signals)) {
    return buildAutomationFailure(signals, "dependency_unavailable", true);
  }

  if (isTimeoutAutomationFailure(signals)) {
    return buildAutomationFailure(
      signals,
      "timeout",
      true,
      normalizeAutomationTimeoutMessage(signals.rawMessage)
    );
  }

  if (isRateLimitedAutomationFailure(signals)) {
    return buildAutomationFailure(signals, "rate_limited", true);
  }

  if (isProviderUnavailableAutomationFailure(signals)) {
    return buildAutomationFailure(signals, "provider_unavailable", true);
  }

  if (isAuthenticationAutomationFailure(signals)) {
    return buildAutomationFailure(signals, "authentication", false);
  }

  if (isConfigurationAutomationFailure(signals)) {
    return buildAutomationFailure(signals, "configuration", false);
  }

  return buildAutomationFailure(signals, "unknown", false);
}

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
}): AutomationModelExecutionMetadata {
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
