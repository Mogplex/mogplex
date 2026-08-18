import type { ProviderMetadata } from "ai";
import { sanitizeTelemetryRecord } from "@/lib/ai-telemetry";
import type {
  AutomationModelExecutionMetadata,
  AutomationModelFailureInfo,
  GenerateTextRequest,
} from "./automation-model-execution-types";
import { isRecord } from "./automation-model-execution-types";

const MAX_ERROR_MESSAGE_LENGTH = 2_000;

export type AutomationModelLogger = Pick<Console, "error" | "warn">;

export type AutomationModelLogContext = {
  phase: string;
  requestedModelId?: string | null;
  pinnedModelId?: string | null;
  providerOptions?: GenerateTextRequest["providerOptions"];
};

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "string") return [];
    const normalized = entry.trim();
    return normalized ? [normalized] : [];
  });
}

function readGatewayProviderSelection(
  providerOptions: GenerateTextRequest["providerOptions"] | undefined
) {
  if (!isRecord(providerOptions) || !isRecord(providerOptions.gateway)) {
    return { providerOnly: [], providerOrder: [] };
  }

  return {
    providerOnly: readStringArray(providerOptions.gateway.only),
    providerOrder: readStringArray(providerOptions.gateway.order),
  };
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildBaseLogContext(input: AutomationModelLogContext) {
  return {
    phase: input.phase,
    requestedModelId: input.requestedModelId?.trim() || null,
    pinnedModelId: input.pinnedModelId?.trim() || null,
    ...readGatewayProviderSelection(input.providerOptions),
  };
}

function buildErrorDetails(
  error: unknown,
  failure: AutomationModelFailureInfo
) {
  const errorRecord = isRecord(error) ? error : null;
  return {
    classification: failure.classification,
    errorName: failure.errorName,
    errorCode: failure.errorCode,
    errorType: readOptionalString(errorRecord?.type),
    statusCode: failure.statusCode,
    retryable:
      typeof errorRecord?.isRetryable === "boolean"
        ? errorRecord.isRetryable
        : failure.retryable,
    generationId: readOptionalString(errorRecord?.generationId),
    message: failure.rawMessage,
  };
}

function sanitizeLogPayload(payload: Record<string, unknown>) {
  return sanitizeTelemetryRecord(payload, {
    maxStringLength: MAX_ERROR_MESSAGE_LENGTH,
    maxItems: 50,
    maxDepth: 5,
  });
}

export function logAutomationProviderAttemptFailure(input: {
  logger: AutomationModelLogger;
  context: AutomationModelLogContext;
  error: unknown;
  failure: AutomationModelFailureInfo;
  attempt: number;
  willRetry: boolean;
}) {
  input.logger.warn(
    "[automation-model] provider attempt failed",
    sanitizeLogPayload({
      event: "automation_model_provider_attempt_failed",
      ...buildBaseLogContext(input.context),
      attempt: input.attempt,
      willRetry: input.willRetry,
      ...buildErrorDetails(input.error, input.failure),
    })
  );
}

export function logAutomationGenerationFailure(input: {
  logger: AutomationModelLogger;
  context: AutomationModelLogContext;
  error: unknown;
  failure: AutomationModelFailureInfo;
  attempts: number;
  retryCount: number;
}) {
  input.logger.error(
    "[automation-model] generation failed",
    sanitizeLogPayload({
      event: "automation_model_generation_failed",
      ...buildBaseLogContext(input.context),
      attempts: input.attempts,
      retryCount: input.retryCount,
      ...buildErrorDetails(input.error, input.failure),
    })
  );
}

function readGatewayResponseRouting(
  providerMetadata: ProviderMetadata | undefined
) {
  const gateway = providerMetadata?.gateway;
  if (!isRecord(gateway)) {
    return {
      generationId: null,
      servedProvider: null,
      planningReasoning: null,
    };
  }
  const routing = isRecord(gateway.routing) ? gateway.routing : null;
  return {
    generationId: readOptionalString(gateway.generationId),
    servedProvider:
      readOptionalString(gateway.provider) ??
      readOptionalString(gateway.providerName),
    planningReasoning: readOptionalString(routing?.planningReasoning),
  };
}

export function logAutomationGatewayFallback(input: {
  logger: AutomationModelLogger;
  context: AutomationModelLogContext;
  metadata: AutomationModelExecutionMetadata;
  providerMetadata: ProviderMetadata | undefined;
}) {
  const modelAttempts = input.metadata.gatewayModelAttempts ?? [];
  const providerFallbackUsed = modelAttempts.some(
    (attempt) => (attempt.providerAttemptCount ?? 0) > 1
  );
  if (!input.metadata.fallbackUsed && !providerFallbackUsed) return;

  input.logger.warn(
    "[automation-model] gateway fallback used",
    sanitizeLogPayload({
      event: "automation_model_gateway_fallback_used",
      ...buildBaseLogContext(input.context),
      ...readGatewayResponseRouting(input.providerMetadata),
      gatewayModelAttemptCount:
        input.metadata.gatewayModelAttemptCount ?? modelAttempts.length,
      gatewayModelAttempts: modelAttempts,
    })
  );
}
