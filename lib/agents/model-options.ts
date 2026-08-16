import type { AIModel } from "@/lib/types";

// TEMPORARY (2026-08): glm-5.2 while Blackbox serves it free — the gateway
// soft-pins it there (see lib/models/gateway-provider-routing.ts). Revert to
// a standing default when the free window closes. Users' stored defaults
// always win over this platform fallback.
export const DEFAULT_NEW_AGENT_MODEL_ID = "zai/glm-5.2";

export type AgentModelOption = {
  id: string;
  label: string;
  provider: string;
  contextLength: number | null;
  isLegacy: boolean;
};

export type ModelSelectionOrderRow = {
  id: string;
  provider?: string | null;
  name?: string | null;
};

// Single source of truth for "first selectable model" ordering. Both fallback
// paths — getDefaultNewAgentModel (via buildAgentModelOptions, feeding
// /api/models' default_model) and the scoped resolver's usableModelIds[0] in
// lib/models/default-model.ts — must sort with this comparator: PostgreSQL
// returns rows in no guaranteed order without ORDER BY, so an unsorted catalog
// would let a persisted fork disagree with the default the UI displays, and
// vary between calls. The model ID is the final tie-breaker so the ordering is
// total even when provider and name tie.
export function compareModelsForDefaultSelection(
  left: ModelSelectionOrderRow,
  right: ModelSelectionOrderRow
) {
  const providerCompare = (left.provider ?? "").localeCompare(
    right.provider ?? ""
  );
  if (providerCompare !== 0) return providerCompare;
  const nameCompare = (left.name ?? "").localeCompare(right.name ?? "");
  if (nameCompare !== 0) return nameCompare;
  return left.id.localeCompare(right.id);
}

function formatContextLength(value: number | null | undefined) {
  if (!value) return null;
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  return `${Math.round(value / 1000)}k`;
}

function formatProviderLabel(provider: string) {
  if (provider === "openai") return "OpenAI";
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "xai") return "xAI";

  return provider
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatModelOptionLabel(
  model: Pick<AIModel, "id" | "provider" | "name" | "context_length">
) {
  const contextLabel = formatContextLength(model.context_length);
  const segments = [
    formatProviderLabel(model.provider),
    model.name || model.id,
  ];
  if (contextLabel) segments.push(`${contextLabel} ctx`);
  return segments.join(" · ");
}

export function buildAgentModelOptions(
  catalog: AIModel[],
  currentModel?: string | null
): AgentModelOption[] {
  const options = catalog
    .filter((model) => model.is_available && model.is_hidden !== true)
    .slice()
    .sort(compareModelsForDefaultSelection)
    .map((model) => ({
      id: model.id,
      label: formatModelOptionLabel(model),
      provider: model.provider,
      contextLength: model.context_length,
      isLegacy: false,
    }));

  if (currentModel && !options.some((option) => option.id === currentModel)) {
    options.unshift({
      id: currentModel,
      label: `Legacy · ${currentModel}`,
      provider: "legacy",
      contextLength: null,
      isLegacy: true,
    });
  }

  return options;
}

export function buildSelectableAgentModelCatalog(
  enabledModels: AIModel[],
  catalog: AIModel[],
  currentModel?: string | null
) {
  if (!currentModel) return enabledModels;
  if (enabledModels.some((model) => model.id === currentModel))
    return enabledModels;

  const currentCatalogModel = catalog.find(
    (model) => model.id === currentModel
  );
  if (!currentCatalogModel) return enabledModels;

  return [...enabledModels, currentCatalogModel];
}

export function getDefaultNewAgentModel(
  catalog: AIModel[],
  preferredModelId?: string | null
) {
  const isSelectable = (modelId: string) =>
    catalog.some(
      (model) =>
        model.is_available && model.is_hidden !== true && model.id === modelId
    );

  if (preferredModelId && isSelectable(preferredModelId)) {
    return preferredModelId;
  }

  if (isSelectable(DEFAULT_NEW_AGENT_MODEL_ID)) {
    return DEFAULT_NEW_AGENT_MODEL_ID;
  }

  return buildAgentModelOptions(catalog)[0]?.id ?? "";
}
