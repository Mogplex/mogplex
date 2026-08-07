import { useCallback, type RefObject } from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import {
  clearFlowDraftSelection,
  copySelectedFlowDraftItems,
  deleteSelectedFlowDraftItems,
  duplicateSelectedFlowDraftAgents,
  insertFlowDraftAgent,
  insertFlowDraftNode,
  pasteFlowDraftItems,
  selectAllFlowDraftAgents,
  selectFlowDraftNode,
  type FlowCanvasNode,
  type FlowDraftClipboard,
  type FlowDraftSnapshot,
} from "@/lib/flows/editor";
import { getDefaultFlowAgentRole } from "@/lib/flows/graph";
import type {
  Agent,
  FlowActionOperation,
  FlowNodeType,
  FlowStartFilter,
  TriggerEvent,
} from "@/lib/types";
import type { TriggerPreset } from "./types";
import { startDataForEvent } from "./canvas-utils";

export type FlowDraftMutationsDeps = {
  // Draft state and updater
  draft: FlowDraftSnapshot | null;
  updateDraft: (
    updater: (current: FlowDraftSnapshot) => FlowDraftSnapshot,
    options?: { recordHistory?: boolean; mergeKey?: string | null }
  ) => void;
  updateNodeData: (
    nodeId: string,
    updater: (data: Record<string, unknown>) => Record<string, unknown>,
    options?: { mergeKey?: string | null }
  ) => void;
  // External data
  agents: Agent[] | undefined;
  selectedStartConfigEvent: TriggerEvent | undefined;
  // Current trigger node
  currentTriggerNode: FlowCanvasNode | null;
  // Selected node (for deleteSelectedNode)
  selectedNode: FlowCanvasNode | null;
  // Refs
  reactFlowRef: RefObject<ReactFlowInstance<FlowCanvasNode> | null>;
  canvasClipboardRef: RefObject<FlowDraftClipboard | null>;
  canvasPasteCountRef: RefObject<number>;
};

export type FlowDraftMutations = {
  getDefaultInsertionPosition: () => { x: number; y: number };
  addNode: (
    type: Exclude<FlowNodeType, "start" | "end">,
    position?: { x: number; y: number },
    operation?: FlowActionOperation
  ) => void;
  selectCanvasNode: (nodeId: string) => void;
  applyTriggerPreset: (preset: TriggerPreset) => void;
  deleteSelectedNode: () => void;
  deleteSelectedCanvasItems: () => boolean;
  duplicateSelectedCanvasItems: () => boolean;
  duplicateContextMenuNode: (nodeId: string) => void;
  deleteContextMenuNode: (nodeId: string) => void;
  copySelectedCanvasItems: () => boolean;
  cutSelectedCanvasItems: () => boolean;
  pasteCanvasItems: () => boolean;
  clearCanvasSelection: () => boolean;
  selectAllCanvasAgents: () => boolean;
};

/**
 * Draft manipulation helpers for adding, removing, duplicating, and pasting nodes.
 */
export function useFlowDraftMutations(
  deps: FlowDraftMutationsDeps
): FlowDraftMutations {
  const {
    draft,
    updateDraft,
    updateNodeData,
    agents,
    selectedStartConfigEvent,
    currentTriggerNode,
    selectedNode,
    reactFlowRef,
    canvasClipboardRef,
    canvasPasteCountRef,
  } = deps;

  const getDefaultInsertionPosition = useCallback(() => {
    const instance = reactFlowRef.current;
    if (!instance) {
      return { x: 320, y: 200 };
    }
    const bounds = instance.getViewport();
    return (
      instance.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: Math.max(200, window.innerHeight / 2),
      }) ?? { x: -bounds.x + 240, y: -bounds.y + 180 }
    );
  }, [reactFlowRef]);

  const addNode = useCallback(
    (
      type: Exclude<FlowNodeType, "start" | "end">,
      position?: { x: number; y: number },
      operation?: FlowActionOperation
    ) => {
      const fallbackAgent = agents?.[0] || null;
      const insertionPosition = position ?? getDefaultInsertionPosition();
      const defaultAgentRole = getDefaultFlowAgentRole(
        selectedStartConfigEvent
      );

      updateDraft(
        (current) => {
          const result =
            type === "agent"
              ? insertFlowDraftAgent(current, {
                  position: insertionPosition,
                  label: fallbackAgent?.name || null,
                  agentId: fallbackAgent?.id ?? null,
                  role: defaultAgentRole,
                })
              : insertFlowDraftNode(current, type, {
                  position: insertionPosition,
                  operation,
                });
          return result.snapshot;
        },
        { mergeKey: "node-add" }
      );
    },
    [agents, getDefaultInsertionPosition, selectedStartConfigEvent, updateDraft]
  );

  const selectCanvasNode = useCallback(
    (nodeId: string) => {
      updateDraft((current) => selectFlowDraftNode(current, nodeId), {
        recordHistory: false,
      });
    },
    [updateDraft]
  );

  const applyTriggerPreset = useCallback(
    (preset: TriggerPreset) => {
      if (!currentTriggerNode) return;
      updateNodeData(
        currentTriggerNode.id,
        (data) => {
          const eventData = startDataForEvent(data, preset.event);
          const next = preset.canvasLabel
            ? { ...eventData, label: preset.canvasLabel }
            : eventData;
          if (!preset.authorFilter) return next;
          const filter = (next.filter as FlowStartFilter | undefined) ?? {
            scope: "all",
          };
          return {
            ...next,
            filter: { ...filter, authorFilter: preset.authorFilter },
          };
        },
        { mergeKey: `trigger-preset-${preset.id}` }
      );
      selectCanvasNode(currentTriggerNode.id);
    },
    [currentTriggerNode, selectCanvasNode, updateNodeData]
  );

  const deleteSelectedNode = useCallback(() => {
    if (
      !selectedNode ||
      selectedNode.type === "start" ||
      selectedNode.type === "end"
    )
      return;
    const result = draft ? deleteSelectedFlowDraftItems(draft) : null;
    if (!result?.changed) return;
    updateDraft(() => result.snapshot, { mergeKey: "node-remove" });
  }, [draft, selectedNode, updateDraft]);

  const deleteSelectedCanvasItems = useCallback(() => {
    if (!draft) return false;
    const result = deleteSelectedFlowDraftItems(draft);
    if (!result.changed) return false;
    updateDraft(() => result.snapshot, { mergeKey: "graph-delete" });
    return true;
  }, [draft, updateDraft]);

  const duplicateSelectedCanvasItems = useCallback(() => {
    if (!draft) return false;
    const result = duplicateSelectedFlowDraftAgents(draft);
    if (!result.changed) return false;
    updateDraft(() => result.snapshot, { mergeKey: "graph-duplicate" });
    return true;
  }, [draft, updateDraft]);

  const duplicateContextMenuNode = useCallback(
    (nodeId: string) => {
      updateDraft(
        (current) => {
          const selected = selectFlowDraftNode(current, nodeId);
          return duplicateSelectedFlowDraftAgents(selected).snapshot;
        },
        { mergeKey: "graph-duplicate" }
      );
    },
    [updateDraft]
  );

  const deleteContextMenuNode = useCallback(
    (nodeId: string) => {
      updateDraft(
        (current) => {
          const selected = selectFlowDraftNode(current, nodeId);
          return deleteSelectedFlowDraftItems(selected).snapshot;
        },
        { mergeKey: "graph-delete" }
      );
    },
    [updateDraft]
  );

  const copySelectedCanvasItems = useCallback(() => {
    if (!draft) return false;
    const clipboard = copySelectedFlowDraftItems(draft);
    if (!clipboard) return false;
    (
      canvasClipboardRef as React.MutableRefObject<FlowDraftClipboard | null>
    ).current = clipboard;
    (canvasPasteCountRef as React.MutableRefObject<number>).current = 0;
    return true;
  }, [canvasClipboardRef, canvasPasteCountRef, draft]);

  const cutSelectedCanvasItems = useCallback(() => {
    if (!draft) return false;
    const clipboard = copySelectedFlowDraftItems(draft);
    if (!clipboard) return false;
    const result = deleteSelectedFlowDraftItems(draft);
    if (!result.changed) return false;
    (
      canvasClipboardRef as React.MutableRefObject<FlowDraftClipboard | null>
    ).current = clipboard;
    (canvasPasteCountRef as React.MutableRefObject<number>).current = 0;
    updateDraft(() => result.snapshot);
    return true;
  }, [canvasClipboardRef, canvasPasteCountRef, draft, updateDraft]);

  const pasteCanvasItems = useCallback(() => {
    const clipboard = canvasClipboardRef.current;
    if (!draft || !clipboard) return false;
    const pasteCount = (canvasPasteCountRef.current ?? 0) + 1;
    const result = pasteFlowDraftItems(draft, clipboard, {
      offset: { x: 48 * pasteCount, y: 48 * pasteCount },
    });
    if (!result.changed) return false;
    (canvasPasteCountRef as React.MutableRefObject<number>).current =
      pasteCount;
    updateDraft(() => result.snapshot);
    return true;
  }, [canvasClipboardRef, canvasPasteCountRef, draft, updateDraft]);

  const clearCanvasSelection = useCallback(() => {
    if (!draft) return false;
    const hasSelection = Boolean(
      draft.selectedNodeId ||
      draft.nodes.some((node) => node.selected) ||
      draft.edges.some((edge) => edge.selected)
    );
    if (!hasSelection) return false;
    updateDraft(() => clearFlowDraftSelection(draft), { recordHistory: false });
    return true;
  }, [draft, updateDraft]);

  const selectAllCanvasAgents = useCallback(() => {
    if (
      !draft?.nodes.some((node) => node.type !== "start" && node.type !== "end")
    )
      return false;
    updateDraft(() => selectAllFlowDraftAgents(draft), {
      recordHistory: false,
    });
    return true;
  }, [draft, updateDraft]);

  return {
    getDefaultInsertionPosition,
    addNode,
    selectCanvasNode,
    applyTriggerPreset,
    deleteSelectedNode,
    deleteSelectedCanvasItems,
    duplicateSelectedCanvasItems,
    duplicateContextMenuNode,
    deleteContextMenuNode,
    copySelectedCanvasItems,
    cutSelectedCanvasItems,
    pasteCanvasItems,
    clearCanvasSelection,
    selectAllCanvasAgents,
  };
}
