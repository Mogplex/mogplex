import { useMemo } from "react";
import {
  buildAgentModelOptions,
  getDefaultNewAgentModel,
} from "@/lib/agents/model-options";
import { isHiddenCatalogModelId } from "@/lib/models/catalog-visibility";
import type { FlowDraftSnapshot, FlowCanvasNode } from "@/lib/flows/editor";
import type { FlowNode, AIModel } from "@/lib/types";

export interface FlowDerivedOptionsParams {
  draft: FlowDraftSnapshot | null;
  models: AIModel[];
  defaultModelId: string | null;
  hiddenModelIds: Set<string>;
  modelsLoading: boolean;
  selectedAgentModelOverride: string | null | undefined;
}

export interface FlowDerivedOptionsResult {
  availableModelOptions: Array<{ id: string; label: string }>;
  enabledModelIds: Set<string>;
  quickReplaceFlowModelId: string;
  quickReplaceFlowModelName: string;
  canQuickReplaceFlowModel: boolean;
  effectiveLegacyAgentNodes: Array<{
    nodeId: string;
    label: string;
    modelId: string;
    source: "override" | "missing";
  }>;
}

export function useFlowDerivedOptions(
  params: FlowDerivedOptionsParams
): FlowDerivedOptionsResult {
  const {
    draft,
    models,
    defaultModelId,
    hiddenModelIds,
    modelsLoading,
    selectedAgentModelOverride,
  } = params;

  // Pass the node's current model so a since-retired pin still renders as a
  // "Legacy · <id>" option. Without it the select has no matching option and
  // silently shows blank while the node keeps running the retired model.
  const availableModelOptions = useMemo(
    () =>
      buildAgentModelOptions(models, selectedAgentModelOverride).map(
        (option) => ({
          id: option.id,
          label: option.label,
        })
      ),
    [models, selectedAgentModelOverride]
  );

  const enabledModelIds = useMemo(
    () => new Set(models.map((model) => model.id)),
    [models]
  );

  const quickReplaceFlowModelId = useMemo(
    () => getDefaultNewAgentModel(models, defaultModelId),
    [defaultModelId, models]
  );

  const quickReplaceFlowModelName = useMemo(
    () =>
      models.find((model) => model.id === quickReplaceFlowModelId)?.name ??
      quickReplaceFlowModelId,
    [models, quickReplaceFlowModelId]
  );

  const canQuickReplaceFlowModel = quickReplaceFlowModelId.length > 0;

  // Flag any agent node whose effective model isn't in the enabled set (covers both
  // hidden-from-catalog and disabled-but-visible models). Mirrors the per-node
  // `selectedAgentOverrideUsesUnavailableModel` / `selectedAgentBaseUsesUnavailableModel`
  // criterion so the top-of-page banner count stays consistent with per-node warnings.
  // While `/api/models` is still loading we fall back to the legacy hidden-only check
  // to avoid flagging every node as unavailable on initial render.
  const effectiveLegacyAgentNodes = useMemo(() => {
    if (!draft) return [];

    const isUnavailableModelId = (
      modelId: string | null | undefined
    ): modelId is string => {
      if (typeof modelId !== "string" || modelId.length === 0) return false;
      if (modelsLoading) {
        return isHiddenCatalogModelId(modelId, hiddenModelIds);
      }
      return !enabledModelIds.has(modelId);
    };

    return draft.nodes.reduce<
      Array<{
        nodeId: string;
        label: string;
        modelId: string;
        source: "override" | "missing";
      }>
    >((issues, node: FlowCanvasNode) => {
      if (node.type !== "agent") return issues;
      const agentNode = node as FlowCanvasNode & {
        data: Extract<FlowNode, { type: "agent" }>["data"];
      };
      if ((agentNode.data.harness ?? "mogplex") !== "mogplex") return issues;
      const label =
        typeof agentNode.data.label === "string" &&
        agentNode.data.label.length > 0
          ? agentNode.data.label
          : agentNode.id;
      // Checked before the availability guard: that guard reports false for an
      // empty id, which would otherwise let a model-less node pass. There is no
      // agent fallback to consider any more — publish rejects this outright.
      const nodeModelId = agentNode.data.modelOverride?.trim() ?? "";
      if (!nodeModelId) {
        issues.push({
          nodeId: agentNode.id,
          label,
          modelId: "",
          source: "missing",
        });
        return issues;
      }
      if (isUnavailableModelId(nodeModelId)) {
        issues.push({
          nodeId: agentNode.id,
          label,
          modelId: nodeModelId,
          source: "override",
        });
      }
      return issues;
    }, []);
  }, [draft, enabledModelIds, hiddenModelIds, modelsLoading]);

  return {
    availableModelOptions,
    enabledModelIds,
    quickReplaceFlowModelId,
    quickReplaceFlowModelName,
    canQuickReplaceFlowModel,
    effectiveLegacyAgentNodes,
  };
}
