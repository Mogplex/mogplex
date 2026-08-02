import type { LanguageModelUsage, ProviderMetadata } from "ai";

export type CapturedUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  reasoningTokens: number | null;
  /**
   * @deprecated Use generationIds instead. Kept for backward compatibility with
   * existing code that reads the first generation ID.
   */
  generationId: string | null;
  /**
   * All Vercel AI Gateway generation IDs captured across tool-loop steps. Used by
   * W7/W11 reconciliation to sum cost across all steps. Marked readonly to prevent
   * accidental mutation — all existing usage spreads into new arrays.
   */
  generationIds: readonly string[];
};

// Outer freeze prevents mutation of the sentinel object. Inner array is also
// frozen to prevent runtime mutation (e.g. EMPTY_CAPTURED_USAGE.generationIds.push).
export const EMPTY_CAPTURED_USAGE: CapturedUsage = Object.freeze({
  inputTokens: null,
  outputTokens: null,
  cacheReadInputTokens: null,
  cacheCreationInputTokens: null,
  reasoningTokens: null,
  generationId: null,
  generationIds: Object.freeze([]) as readonly string[],
});

function readProviderNumber(
  providerMetadata: ProviderMetadata | undefined,
  provider: string,
  key: string
) {
  const value = providerMetadata?.[provider]?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readGenerationId(providerMetadata: ProviderMetadata | undefined) {
  const value = providerMetadata?.gateway?.generationId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function hasCapturedUsage(usage: CapturedUsage) {
  return (
    usage.inputTokens != null ||
    usage.outputTokens != null ||
    usage.cacheReadInputTokens != null ||
    usage.cacheCreationInputTokens != null ||
    usage.reasoningTokens != null ||
    usage.generationId != null ||
    usage.generationIds.length > 0
  );
}

export function captureUsage(
  usage: LanguageModelUsage | undefined,
  providerMetadata: ProviderMetadata | undefined
): CapturedUsage {
  const generationId = readGenerationId(providerMetadata);
  return {
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    cacheReadInputTokens:
      usage?.inputTokenDetails?.cacheReadTokens ??
      usage?.cachedInputTokens ??
      null,
    cacheCreationInputTokens:
      usage?.inputTokenDetails?.cacheWriteTokens ??
      readProviderNumber(
        providerMetadata,
        "anthropic",
        "cacheCreationInputTokens"
      ) ??
      null,
    reasoningTokens:
      usage?.outputTokenDetails?.reasoningTokens ??
      usage?.reasoningTokens ??
      null,
    generationId,
    generationIds: generationId ? [generationId] : [],
  };
}

export function mergeUsage(a: CapturedUsage, b: CapturedUsage): CapturedUsage {
  const add = (x: number | null, y: number | null) =>
    x == null && y == null ? null : (x ?? 0) + (y ?? 0);

  // Concatenate generation IDs, preserving order (a's IDs first, then b's).
  // Deduplicate to avoid counting the same step twice if caller merges overlapping data.
  const mergedIds = [...a.generationIds, ...b.generationIds];
  const uniqueIds = [...new Set(mergedIds)];

  return {
    inputTokens: add(a.inputTokens, b.inputTokens),
    outputTokens: add(a.outputTokens, b.outputTokens),
    cacheReadInputTokens: add(a.cacheReadInputTokens, b.cacheReadInputTokens),
    cacheCreationInputTokens: add(
      a.cacheCreationInputTokens,
      b.cacheCreationInputTokens
    ),
    reasoningTokens: add(a.reasoningTokens, b.reasoningTokens),
    generationId: a.generationId ?? b.generationId,
    generationIds: uniqueIds,
  };
}

export function fillUsageGaps(
  primary: CapturedUsage,
  fallback: CapturedUsage
): CapturedUsage {
  // Union generation IDs from primary and fallback, preserving primary's order first.
  // Use primary's IDs if available, otherwise fall back to fallback's, then union both.
  // Always copy the array to avoid returning a shared reference to fallback.generationIds.
  const primaryIds = primary.generationIds;
  const fallbackIds = fallback.generationIds;
  const mergedIds =
    primaryIds.length > 0
      ? [...new Set([...primaryIds, ...fallbackIds])]
      : [...fallbackIds];

  // Keep singleton generationId consistent with the first ID in the effective array.
  // This prevents disagreement when primary.generationId is null but primary.generationIds
  // is non-empty: use the first merged ID instead of falling back to fallback.generationId.
  const effectiveGenerationId =
    primary.generationId ?? mergedIds[0] ?? fallback.generationId ?? null;

  return {
    inputTokens: primary.inputTokens ?? fallback.inputTokens,
    outputTokens: primary.outputTokens ?? fallback.outputTokens,
    cacheReadInputTokens:
      primary.cacheReadInputTokens ?? fallback.cacheReadInputTokens,
    cacheCreationInputTokens:
      primary.cacheCreationInputTokens ?? fallback.cacheCreationInputTokens,
    reasoningTokens: primary.reasoningTokens ?? fallback.reasoningTokens,
    generationId: effectiveGenerationId,
    generationIds: mergedIds,
  };
}

export function capturedUsageAiCallColumns(usage: CapturedUsage) {
  return {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cache_read_input_tokens: usage.cacheReadInputTokens,
    cache_creation_input_tokens: usage.cacheCreationInputTokens,
    reasoning_tokens: usage.reasoningTokens,
    // Keep the singleton column populated with the first ID for backward compatibility
    gateway_generation_id: usage.generationId ?? usage.generationIds[0] ?? null,
    // New array column for multi-step reconciliation (W11)
    gateway_generation_ids:
      usage.generationIds.length > 0 ? usage.generationIds : null,
  };
}
