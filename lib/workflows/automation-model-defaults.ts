export const AUTOMATION_MODEL_TIMEOUT_FLOOR_MS = 300_000;
export const AUTOMATION_MODEL_MAX_GENERATE_RETRIES = 1;
export const AUTOMATION_MODEL_DEFAULT_TOTAL_BUDGET_MS = 25 * 60_000;
export const AUTOMATION_GATEWAY_FALLBACK_MODELS_ENV =
  "AUTOMATION_GATEWAY_FALLBACK_MODELS";
export const AUTOMATION_MODEL_DEFAULT_FALLBACK_POOL = [
  "zai/glm-5.2-fast",
  "openai/gpt-5.4",
] as const;
// Only the first policy-approved candidate reaches AI Gateway. Keep the
// configurable preference list small as an additional guardrail.
export const AUTOMATION_MODEL_FALLBACK_POOL_MAX_SIZE = 4;

const AUTOMATION_MODEL_ID_PATTERN =
  /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/;
const AUTOMATION_MODEL_ID_MAX_LENGTH = 200;

export function resolveAutomationModelFallbackPool(
  configuredModels: string | null | undefined
) {
  const normalizedModels: string[] = [];
  const seenModelIds = new Set<string>();

  for (const value of configuredModels?.split(",") ?? []) {
    const modelId = value.trim().toLowerCase();
    if (
      modelId.length === 0 ||
      modelId.length > AUTOMATION_MODEL_ID_MAX_LENGTH ||
      !AUTOMATION_MODEL_ID_PATTERN.test(modelId) ||
      seenModelIds.has(modelId)
    ) {
      continue;
    }

    seenModelIds.add(modelId);
    normalizedModels.push(modelId);
    if (normalizedModels.length === AUTOMATION_MODEL_FALLBACK_POOL_MAX_SIZE) {
      break;
    }
  }

  return normalizedModels.length > 0
    ? normalizedModels
    : [...AUTOMATION_MODEL_DEFAULT_FALLBACK_POOL];
}

export function getAutomationModelFallbackIds(
  primaryModelId: string,
  configuredModels?: string | null
) {
  const normalizedPrimary = primaryModelId.trim().toLowerCase();
  const fallbackModelIds = resolveAutomationModelFallbackPool(
    configuredModels
  ).filter((modelId) => modelId !== normalizedPrimary);

  if (fallbackModelIds.length > 0) return fallbackModelIds;

  return AUTOMATION_MODEL_DEFAULT_FALLBACK_POOL.filter(
    (modelId) => modelId !== normalizedPrimary
  );
}

// Default timeout is per attempt; keep all retry attempts under the task cap.
export const AUTOMATION_MODEL_DEFAULT_TIMEOUT_MS = Math.floor(
  AUTOMATION_MODEL_DEFAULT_TOTAL_BUDGET_MS /
    (AUTOMATION_MODEL_MAX_GENERATE_RETRIES + 1)
);

export function getEffectiveAutomationTimeoutMs(
  value: number | null | undefined
) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return AUTOMATION_MODEL_DEFAULT_TIMEOUT_MS;
  }

  return Math.max(Math.floor(value), AUTOMATION_MODEL_TIMEOUT_FLOOR_MS);
}

export function getAutomationGenerateTimeoutMs(
  value: number | null | undefined
) {
  const effectiveTimeoutMs = getEffectiveAutomationTimeoutMs(value);

  return Math.min(
    effectiveTimeoutMs * (AUTOMATION_MODEL_MAX_GENERATE_RETRIES + 1),
    AUTOMATION_MODEL_DEFAULT_TOTAL_BUDGET_MS
  );
}
