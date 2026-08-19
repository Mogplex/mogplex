import type { ProviderMetadata } from "ai";
import type {
  AutomationGatewayModelAttempt,
  AutomationGatewayProviderAttempt,
  AutomationGatewayRoutingMetadata,
  AutomationGatewayRoutingState,
} from "./automation-model-execution-types";
import { isRecord } from "./automation-model-execution-types";

const MAX_CAPTURED_GATEWAY_MODEL_ATTEMPTS = 50;

export function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readGatewayProviderAttempts(
  value: unknown
): AutomationGatewayProviderAttempt[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((attempt) => {
    if (!isRecord(attempt)) return [];
    const provider = readOptionalString(attempt.provider);
    if (!provider || typeof attempt.success !== "boolean") return [];

    return [
      {
        provider,
        success: attempt.success,
        statusCode: readOptionalNumber(attempt.statusCode),
        providerTimeout: attempt.providerTimeout === true,
      },
    ];
  });
}

export function readGatewayModelAttempts(
  providerMetadata: ProviderMetadata | undefined
): AutomationGatewayModelAttempt[] {
  const gatewayMetadata = providerMetadata?.gateway;
  if (!isRecord(gatewayMetadata)) {
    return [];
  }

  // Current Gateway responses nest routing evidence under `routing`. Keep the
  // root fallback for older SDK responses and persisted test fixtures.
  const routing = isRecord(gatewayMetadata.routing)
    ? gatewayMetadata.routing
    : null;
  const rawModelAttempts = Array.isArray(routing?.modelAttempts)
    ? routing.modelAttempts
    : gatewayMetadata.modelAttempts;
  if (!Array.isArray(rawModelAttempts)) return [];

  return rawModelAttempts.flatMap((attempt) => {
    if (!isRecord(attempt)) return [];

    const canonicalSlug =
      typeof attempt.canonicalSlug === "string"
        ? attempt.canonicalSlug.trim()
        : "";
    if (!canonicalSlug || typeof attempt.success !== "boolean") return [];

    const modelId = readOptionalString(attempt.modelId);
    const providerAttempts = readGatewayProviderAttempts(
      attempt.providerAttempts
    );
    const providerAttemptCount =
      typeof attempt.providerAttemptCount === "number" &&
      Number.isFinite(attempt.providerAttemptCount) &&
      attempt.providerAttemptCount >= 0
        ? Math.floor(attempt.providerAttemptCount)
        : providerAttempts.length > 0
          ? providerAttempts.length
          : null;

    return [
      {
        canonicalSlug,
        modelId,
        success: attempt.success,
        providerAttemptCount,
        ...(providerAttempts.length > 0 ? { providerAttempts } : {}),
      },
    ];
  });
}

export function readBlackboxFallbackDetails(
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

export function captureGatewayModelRouting(
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

export function buildAutomationGatewayRoutingMetadata(
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
