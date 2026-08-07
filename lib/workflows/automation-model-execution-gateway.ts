import type { ProviderMetadata } from "ai";
import type {
  AutomationGatewayModelAttempt,
  AutomationGatewayRoutingMetadata,
  AutomationGatewayRoutingState,
} from "./automation-model-execution-types";
import { isRecord } from "./automation-model-execution-types";

const MAX_CAPTURED_GATEWAY_MODEL_ATTEMPTS = 50;

export function readGatewayModelAttempts(
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
