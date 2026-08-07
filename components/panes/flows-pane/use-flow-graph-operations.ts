import { useCallback } from "react";
import {
  graphToCanvas,
  insertFlowDraftNodeOnEdge,
  straightenSelectedFlowDraftNodes,
  tidyFlowDraftLayout,
  type FlowDraftSnapshot,
} from "@/lib/flows/editor";
import { getDefaultFlowAgentRole } from "@/lib/flows/graph";
import type {
  Agent,
  FlowActionOperation,
  FlowGraph,
  TriggerEvent,
} from "@/lib/types";

export type FlowGraphOperationsDeps = {
  // Draft state and updater
  draft: FlowDraftSnapshot | null;
  updateDraft: (
    updater: (current: FlowDraftSnapshot) => FlowDraftSnapshot,
    options?: { recordHistory?: boolean; mergeKey?: string | null }
  ) => void;
  // External data
  agents: Agent[] | undefined;
  selectedStartConfigEvent: TriggerEvent | undefined;
};

export type FlowGraphOperations = {
  insertNodeOnEdge: (
    edgeId: string,
    type:
      | "agent"
      | "action"
      | "delay"
      | "await_event"
      | "set_variable"
      | "transform",
    position?: { x: number; y: number },
    operation?: FlowActionOperation
  ) => boolean;
  tidyCanvasLayout: () => boolean;
  straightenCanvasSelection: () => boolean;
  applyAssistantGraph: (graph: FlowGraph) => void;
};

/**
 * Graph-level operations: insert on edge, tidy layout, straighten, apply assistant graph.
 */
export function useFlowGraphOperations(
  deps: FlowGraphOperationsDeps
): FlowGraphOperations {
  const { draft, updateDraft, agents, selectedStartConfigEvent } = deps;

  const insertNodeOnEdge = useCallback(
    (
      edgeId: string,
      type:
        | "agent"
        | "action"
        | "delay"
        | "await_event"
        | "set_variable"
        | "transform",
      position?: { x: number; y: number },
      operation?: FlowActionOperation
    ) => {
      if (!draft) return false;
      const fallbackAgent = agents?.[0] || null;
      const defaultAgentRole = getDefaultFlowAgentRole(
        selectedStartConfigEvent
      );
      const result = insertFlowDraftNodeOnEdge(
        draft,
        edgeId,
        type,
        type === "agent"
          ? {
              position,
              label: fallbackAgent?.name || null,
              agentId: fallbackAgent?.id ?? null,
              role: defaultAgentRole,
            }
          : { position, operation }
      );

      if (!result.changed) return false;
      updateDraft(() => result.snapshot, { mergeKey: "edge-insert-node" });
      return true;
    },
    [agents, draft, selectedStartConfigEvent, updateDraft]
  );

  const tidyCanvasLayout = useCallback(() => {
    if (!draft) return false;
    const result = tidyFlowDraftLayout(draft);
    if (!result.changed) return false;
    updateDraft(() => result.snapshot, { mergeKey: "graph-tidy" });
    return true;
  }, [draft, updateDraft]);

  const straightenCanvasSelection = useCallback(() => {
    if (!draft) return false;
    const result = straightenSelectedFlowDraftNodes(draft);
    if (!result.changed) return false;
    updateDraft(() => result.snapshot, { mergeKey: "graph-straighten" });
    return true;
  }, [draft, updateDraft]);

  const applyAssistantGraph = useCallback(
    (graph: FlowGraph) => {
      updateDraft(
        (current) => ({
          ...current,
          ...graphToCanvas(graph),
          selectedNodeId: null,
        }),
        { mergeKey: "assistant-apply" }
      );
    },
    [updateDraft]
  );

  return {
    insertNodeOnEdge,
    tidyCanvasLayout,
    straightenCanvasSelection,
    applyAssistantGraph,
  };
}
