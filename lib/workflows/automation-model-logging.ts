import type { ProviderMetadata } from "ai";
import { sanitizeTelemetryRecord } from "@/lib/ai-telemetry";
import type {
  AutomationGatewayModelAttempt,
  AutomationModelExecutionMetadata,
  AutomationModelFailureInfo,
  GenerateTextRequest,
} from "./automation-model-execution-types";
import { isRecord } from "./automation-model-execution-types";
import { readGatewayModelAttempts } from "./automation-model-execution-gateway";

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

function readFirstOptionalString(...values: unknown[]) {
  for (const value of values) {
    const candidate = readOptionalString(value);
    if (candidate) return candidate;
  }
  return null;
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
  const modelAttempts = readGatewayModelAttempts(providerMetadata);
  const successfulProvider = modelAttempts
    .flatMap((attempt) => attempt.providerAttempts ?? [])
    .find((attempt) => attempt.success)?.provider;
  return {
    generationId: readOptionalString(gateway.generationId),
    servedProvider: readFirstOptionalString(
      successfulProvider,
      gateway.provider,
      gateway.providerName,
      routing?.finalProvider,
      routing?.resolvedProvider
    ),
    planningReasoning: readOptionalString(routing?.planningReasoning),
  };
}

function readBlackboxFallbackDetails(
  modelAttempts: AutomationGatewayModelAttempt[]
) {
  const blackboxFailures = modelAttempts.flatMap((modelAttempt) =>
    (modelAttempt.providerAttempts ?? []).flatMap((providerAttempt) => {
      if (
        providerAttempt.provider.toLowerCase() !== "blackbox" ||
        providerAttempt.success
      ) {
        return [];
      }
      return [
        {
          canonicalSlug: modelAttempt.canonicalSlug,
          statusCode: providerAttempt.statusCode,
          providerTimeout: providerAttempt.providerTimeout,
        },
      ];
    })
  );
  const fallbackProviders = [
    ...new Set(
      modelAttempts.flatMap((modelAttempt) =>
        (modelAttempt.providerAttempts ?? []).flatMap((providerAttempt) =>
          providerAttempt.success &&
          providerAttempt.provider.toLowerCase() !== "blackbox"
            ? [providerAttempt.provider]
            : []
        )
      )
    ),
  ];

  return { blackboxFailures, fallbackProviders };
}

function hasGatewayProviderFallback(
  modelAttempts: AutomationGatewayModelAttempt[]
) {
  return modelAttempts.some((attempt) => {
    const attemptCount = Math.max(
      attempt.providerAttemptCount ?? 0,
      attempt.providerAttempts?.length ?? 0
    );
    return attemptCount > 1;
  });
}

function isBlackboxFallback(input: {
  providerOrder: string[];
  servedProvider: string | null;
  blackboxFailureCount: number;
  fallbackProviderCount: number;
}) {
  const blackboxPreferred =
    input.providerOrder[0]?.toLowerCase() === "blackbox";
  const servedByAnotherProvider =
    input.servedProvider !== null &&
    input.servedProvider.toLowerCase() !== "blackbox";
  const observedBlackboxFailure =
    input.blackboxFailureCount > 0 && input.fallbackProviderCount > 0;

  return (
    observedBlackboxFailure || (blackboxPreferred && servedByAnotherProvider)
  );
}

export function logAutomationGatewayFallback(input: {
  logger: AutomationModelLogger;
  context: AutomationModelLogContext;
  metadata: AutomationModelExecutionMetadata;
  providerMetadata: ProviderMetadata | undefined;
}) {
  const modelAttempts = input.metadata.gatewayModelAttempts ?? [];
  const providerFallbackUsed = hasGatewayProviderFallback(modelAttempts);
  const providerSelection = readGatewayProviderSelection(
    input.context.providerOptions
  );
  const routing = readGatewayResponseRouting(input.providerMetadata);
  const { blackboxFailures, fallbackProviders } =
    readBlackboxFallbackDetails(modelAttempts);
  const blackboxFallbackUsed = isBlackboxFallback({
    providerOrder: providerSelection.providerOrder,
    servedProvider: routing.servedProvider,
    blackboxFailureCount: blackboxFailures.length,
    fallbackProviderCount: fallbackProviders.length,
  });

  if (blackboxFallbackUsed) {
    input.logger.warn(
      "[automation-model] Blackbox failed. AI Gateway used a fallback provider",
      sanitizeLogPayload({
        event: "automation_model_blackbox_fallback_used",
        ...buildBaseLogContext(input.context),
        preferredProvider: "blackbox",
        ...routing,
        fallbackProviders,
        blackboxFailureCount: blackboxFailures.length,
        blackboxFailures,
        gatewayModelAttemptCount:
          input.metadata.gatewayModelAttemptCount ?? modelAttempts.length,
        gatewayModelAttempts: modelAttempts,
      })
    );
    return;
  }

  if (!input.metadata.fallbackUsed && !providerFallbackUsed) return;

  input.logger.warn(
    "[automation-model] gateway fallback used",
    sanitizeLogPayload({
      event: "automation_model_gateway_fallback_used",
      ...buildBaseLogContext(input.context),
      ...routing,
      gatewayModelAttemptCount:
        input.metadata.gatewayModelAttemptCount ?? modelAttempts.length,
      gatewayModelAttempts: modelAttempts,
    })
  );
}
