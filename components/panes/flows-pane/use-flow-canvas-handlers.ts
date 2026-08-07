import { useCallback, type RefObject } from "react";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  cloneFlowDraftSnapshot,
  type FlowCanvasNode,
  type FlowDraftSnapshot,
} from "@/lib/flows/editor";
import type { Flow, FlowStartFilter } from "@/lib/types";
import type { Installation } from "./types";
import {
  FLOW_FIT_VIEW_OPTIONS,
  HISTORY_LIMIT,
  HISTORY_MERGE_WINDOW_MS,
} from "./constants";
import { buildFilter } from "./start-filter-fields";
import type { FlowDraftHistory } from "./use-flow-save-publish-state";

export type FlowCanvasHandlersDeps = {
  // History state from useFlowSavePublishState
  setHistory: React.Dispatch<React.SetStateAction<FlowDraftHistory | null>>;
  historyMergeRef: RefObject<{ mergeKey: string | null; lastAt: number }>;
  // Flow/draft state
  selectedFlow: Flow | undefined;
  // Refs
  reactFlowRef: RefObject<ReactFlowInstance<FlowCanvasNode> | null>;
  fittedFlowIdRef: RefObject<string | null>;
  hydratedFlowIdRef: RefObject<string | null>;
  // External data
  installations: Installation[] | undefined;
  effectiveInstallationId: number | null;
  // Selected nodes (for updateTriggerInstallation)
  selectedStartNode:
    | (FlowCanvasNode & {
        data: { filter?: FlowStartFilter };
      })
    | null;
};

export type FlowCanvasHandlers = {
  updateDraft: (
    updater: (current: FlowDraftSnapshot) => FlowDraftSnapshot,
    options?: { recordHistory?: boolean; mergeKey?: string | null }
  ) => void;
  handleFlowNameChange: (name: string) => void;
  onNodesChange: (changes: NodeChange<FlowCanvasNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  onSelectionChange: (selection: OnSelectionChangeParams) => void;
  updateNodeData: (
    nodeId: string,
    updater: (data: Record<string, unknown>) => Record<string, unknown>,
    options?: { mergeKey?: string | null }
  ) => void;
  updateTriggerInstallation: (installationId: number) => void;
};

/**
 * Core canvas handlers for React Flow events and node/edge manipulation.
 */
export function useFlowCanvasHandlers(
  deps: FlowCanvasHandlersDeps
): FlowCanvasHandlers {
  const {
    setHistory,
    historyMergeRef,
    selectedFlow,
    reactFlowRef,
    fittedFlowIdRef,
    hydratedFlowIdRef,
    installations,
    effectiveInstallationId,
    selectedStartNode,
  } = deps;

  const updateDraft = useCallback(
    (
      updater: (current: FlowDraftSnapshot) => FlowDraftSnapshot,
      options?: { recordHistory?: boolean; mergeKey?: string | null }
    ) => {
      const recordHistory = options?.recordHistory ?? true;

      setHistory((current) => {
        if (!current) return current;

        const nextPresent = updater(cloneFlowDraftSnapshot(current.present));
        if (!recordHistory) {
          return {
            ...current,
            present: nextPresent,
          };
        }

        const now = Date.now();
        const shouldMerge = Boolean(
          options?.mergeKey &&
          historyMergeRef.current?.mergeKey === options.mergeKey &&
          now - (historyMergeRef.current?.lastAt ?? 0) < HISTORY_MERGE_WINDOW_MS
        );

        if (historyMergeRef.current) {
          historyMergeRef.current = {
            mergeKey: options?.mergeKey ?? null,
            lastAt: now,
          };
        }

        return {
          past: shouldMerge
            ? current.past
            : [...current.past, cloneFlowDraftSnapshot(current.present)].slice(
                -HISTORY_LIMIT
              ),
          present: nextPresent,
          future: [],
        };
      });
    },
    [historyMergeRef, setHistory]
  );

  const handleFlowNameChange = useCallback(
    (name: string) => {
      updateDraft(
        (current) => ({
          ...current,
          name,
        }),
        { mergeKey: "flow-name" }
      );
    },
    [updateDraft]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowCanvasNode>[]) => {
      const flowId = selectedFlow?.id ?? null;
      const shouldFitMeasuredGraph =
        Boolean(flowId) &&
        fittedFlowIdRef.current !== flowId &&
        changes.some((change) => change.type === "dimensions");
      const recordHistory = changes.some(
        (change) => change.type !== "select" && change.type !== "dimensions"
      );
      const mergeKey = changes.some((change) => change.type === "position")
        ? "node-position"
        : changes.some((change) => change.type === "remove")
          ? "node-remove"
          : changes.some((change) => change.type === "add")
            ? "node-add"
            : changes.some((change) => change.type === "replace")
              ? "node-replace"
              : changes.some((change) => change.type === "dimensions")
                ? "node-dimensions"
                : null;

      updateDraft(
        (current) => ({
          ...current,
          nodes: applyNodeChanges(changes, current.nodes),
        }),
        { recordHistory, mergeKey }
      );
      if (shouldFitMeasuredGraph && flowId) {
        requestAnimationFrame(() => {
          const measuredNodes = reactFlowRef.current?.getNodes() ?? [];
          if (
            hydratedFlowIdRef.current === flowId &&
            measuredNodes.length > 0 &&
            measuredNodes.every(
              (node) => node.measured?.width && node.measured?.height
            )
          ) {
            (fittedFlowIdRef as React.MutableRefObject<string | null>).current =
              flowId;
            void reactFlowRef.current?.fitView(FLOW_FIT_VIEW_OPTIONS);
          }
        });
      }
    },
    [
      fittedFlowIdRef,
      hydratedFlowIdRef,
      reactFlowRef,
      selectedFlow?.id,
      updateDraft,
    ]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const recordHistory = changes.some((change) => change.type !== "select");
      const mergeKey = changes.some((change) => change.type === "remove")
        ? "edge-remove"
        : changes.some((change) => change.type === "add")
          ? "edge-add"
          : changes.some((change) => change.type === "replace")
            ? "edge-replace"
            : null;

      updateDraft(
        (current) => ({
          ...current,
          edges: applyEdgeChanges(changes, current.edges),
        }),
        { recordHistory, mergeKey }
      );
    },
    [updateDraft]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      updateDraft(
        (current) => ({
          ...current,
          edges: addEdge(
            {
              ...connection,
              id: `${connection.source}-${connection.target}-${crypto.randomUUID().slice(0, 6)}`,
            },
            current.edges
          ),
        }),
        { mergeKey: "edge-add" }
      );
    },
    [updateDraft]
  );

  const onSelectionChange = useCallback(
    (selection: OnSelectionChangeParams) => {
      const node = selection.nodes?.[0];
      updateDraft(
        (current) => ({
          ...current,
          selectedNodeId: node?.id ?? null,
        }),
        { recordHistory: false }
      );
    },
    [updateDraft]
  );

  const updateNodeData = useCallback(
    (
      nodeId: string,
      updater: (data: Record<string, unknown>) => Record<string, unknown>,
      options?: { mergeKey?: string | null }
    ) => {
      updateDraft(
        (current) => ({
          ...current,
          nodes: current.nodes.map((node) =>
            node.id === nodeId ? { ...node, data: updater(node.data) } : node
          ),
        }),
        { mergeKey: options?.mergeKey ?? `node-data-${nodeId}` }
      );
    },
    [updateDraft]
  );

  const updateTriggerInstallation = useCallback(
    (installationId: number) => {
      if (
        !selectedStartNode ||
        !(installations || []).some(
          (installation) => installation.installation_id === installationId
        )
      ) {
        return;
      }
      const accountChanged = effectiveInstallationId !== installationId;
      updateNodeData(
        selectedStartNode.id,
        (data) => {
          const filter = data.filter as FlowStartFilter | undefined;
          return {
            ...data,
            filter: buildFilter(
              installationId,
              accountChanged ? [] : (filter?.repos ?? []),
              filter?.authorFilter ?? "any"
            ),
          };
        },
        { mergeKey: `start-account-${selectedStartNode.id}` }
      );
    },
    [effectiveInstallationId, installations, selectedStartNode, updateNodeData]
  );

  return {
    updateDraft,
    handleFlowNameChange,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onSelectionChange,
    updateNodeData,
    updateTriggerInstallation,
  };
}
