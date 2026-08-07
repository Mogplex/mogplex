import { MODEL_ALLOWLIST_UNAVAILABLE_CODE } from "@/lib/team-capabilities";
import type {
  AutomationErrorSignals,
  AutomationModelExecutionMetadata,
  AutomationModelFailureClass,
  AutomationModelFailureInfo,
} from "./automation-model-execution-types";
import { isRecord } from "./automation-model-execution-types";

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

function isAutomationGatewayModelAttempt(value: unknown): value is {
  canonicalSlug: string;
  modelId: string | null;
  success: boolean;
  providerAttemptCount: number | null;
} {
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

export function buildAutomationErrorSignals(
  error: unknown
): AutomationErrorSignals {
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
