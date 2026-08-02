import type { AIModel } from "@/lib/types";

export type ModelRecommendationBucket = "open" | "frontier";

export type ModelRecommendationReason =
  | "frontier_latest_general"
  | "frontier_fast_general"
  | "open_best_general"
  | "open_best_economy";

type RecommendationMeta = {
  bucket: ModelRecommendationBucket;
  rank: number;
  reason: ModelRecommendationReason;
};

type RecommendationCandidate = Pick<
  AIModel,
  | "id"
  | "provider"
  | "name"
  | "context_length"
  | "pricing_input"
  | "pricing_output"
  | "capabilities"
  | "is_available"
>;

const FRONTIER_REASONS: ModelRecommendationReason[] = [
  "frontier_latest_general",
  "frontier_fast_general",
];

const OPEN_REASONS: ModelRecommendationReason[] = [
  "open_best_general",
  "open_best_economy",
];

const FRONTIER_PREFERRED_IDS = [
  "anthropic/claude-opus-4.8",
  "anthropic/claude-sonnet-5",
  "anthropic/claude-sonnet-4.6",
  "openai/gpt-5.4",
  "google/gemini-2.5-pro",
  "xai/grok-4.1-non-reasoning",
  "google/gemini-3-pro-preview",
] as const;

const OPEN_PREFERRED_IDS = [
  "minimax/minimax-m2.7",
  "minimax/minimax-m2.5",
  "openai/gpt-oss-120b",
  "deepseek/deepseek-v3.2",
  "mistral/mixtral-8x22b-instruct",
  "mistral/mistral-small",
  "mistral/ministral-8b",
  "meta/llama-4-maverick",
  "qwen/qwen3-235b-a22b-thinking-2507",
  "google/gemma-3-27b-it",
  "nvidia/nemotron-3-ultra-550b-a55b",
] as const;

// These providers are treated as the current proprietary frontier bucket unless the
// specific model matches one of the open/open-weight patterns below.
const FRONTIER_PROVIDERS = new Set(["anthropic", "google", "openai", "xai"]);

// AI Gateway does not expose a durable open/frontier taxonomy, so we classify likely
// open or open-weight models by stable ID families.
const OPEN_ID_PATTERNS = [
  /^minimax\//i,
  /\/gpt-oss-/i,
  /^deepseek\//i,
  /^meta\/llama/i,
  /^qwen\//i,
  /^mistral\/(mixtral|ministral|mistral-small|mistral-nemo)/i,
  /^google\/gemma/i,
  /^nvidia\/nemotron/i,
  /^allenai\/olmo/i,
] as const;

function hasCapability(model: RecommendationCandidate, capability: string) {
  return (model.capabilities ?? []).some(
    (value) => value.toLowerCase() === capability
  );
}

function isPreviewModel(model: RecommendationCandidate) {
  const normalized = `${model.id} ${model.name}`.toLowerCase();
  return (
    normalized.includes("preview") ||
    normalized.includes("experimental") ||
    normalized.includes("beta")
  );
}

function isLikelyOpenModel(model: RecommendationCandidate) {
  return OPEN_ID_PATTERNS.some((pattern) => pattern.test(model.id));
}

function isLikelyFrontierModel(model: RecommendationCandidate) {
  return FRONTIER_PROVIDERS.has(model.provider) && !isLikelyOpenModel(model);
}

function comparePreferredIds<T extends RecommendationCandidate>(
  orderedIds: readonly string[],
  left: T,
  right: T
) {
  const leftIndex = orderedIds.indexOf(left.id);
  const rightIndex = orderedIds.indexOf(right.id);
  const leftKnown = leftIndex !== -1;
  const rightKnown = rightIndex !== -1;

  if (leftKnown && rightKnown) return leftIndex - rightIndex;
  if (leftKnown) return -1;
  if (rightKnown) return 1;
  return 0;
}

function scoreFallbackModel(model: RecommendationCandidate) {
  return [
    hasCapability(model, "tool-use") ? 0 : 1,
    isPreviewModel(model) ? 1 : 0,
    model.pricing_input ?? Number.MAX_SAFE_INTEGER,
    -(model.context_length ?? 0),
    model.name.toLowerCase(),
  ] as const;
}

function compareFallbackModels(
  left: RecommendationCandidate,
  right: RecommendationCandidate
) {
  const [leftToolUse, leftPreview, leftPrice, leftContext, leftName] =
    scoreFallbackModel(left);
  const [rightToolUse, rightPreview, rightPrice, rightContext, rightName] =
    scoreFallbackModel(right);

  return (
    leftToolUse - rightToolUse ||
    leftPreview - rightPreview ||
    leftPrice - rightPrice ||
    leftContext - rightContext ||
    leftName.localeCompare(rightName)
  );
}

function selectBucket(
  models: RecommendationCandidate[],
  orderedIds: readonly string[],
  matcher: (model: RecommendationCandidate) => boolean,
  count: number
) {
  return models
    .filter(matcher)
    .sort((left, right) => {
      const preferred = comparePreferredIds(orderedIds, left, right);
      if (preferred !== 0) return preferred;
      return compareFallbackModels(left, right);
    })
    .slice(0, count);
}

export function computeModelRecommendations(models: RecommendationCandidate[]) {
  const available = models.filter((model) => model.is_available);

  const frontier = selectBucket(
    available,
    FRONTIER_PREFERRED_IDS,
    isLikelyFrontierModel,
    2
  );
  const open = selectBucket(
    available,
    OPEN_PREFERRED_IDS,
    isLikelyOpenModel,
    2
  );

  const selected = new Map<string, RecommendationMeta>();

  for (const [index, model] of frontier.entries()) {
    const reason = FRONTIER_REASONS[index] ?? FRONTIER_REASONS.at(-1);
    selected.set(model.id, {
      bucket: "frontier",
      rank: index + 1,
      reason,
    });
  }

  for (const [index, model] of open.entries()) {
    const reason = OPEN_REASONS[index] ?? OPEN_REASONS.at(-1);
    selected.set(model.id, {
      bucket: "open",
      rank: index + 1,
      reason,
    });
  }

  return selected;
}
