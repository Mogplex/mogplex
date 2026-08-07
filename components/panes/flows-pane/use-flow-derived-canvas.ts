import { useMemo } from "react";
import {
  draftToGraph,
  type FlowCanvasEdge,
  type FlowCanvasNode,
  type FlowDraftSnapshot,
} from "@/lib/flows/editor";
import {
  CONDITION_HANDLE_IDS,
  eventLabel,
  FAILURE_HANDLE_ID,
  getStartConfig,
} from "@/lib/flows/graph";
import type { FlowGraph, Repo } from "@/lib/types";
import type {
  Installation,
  FlowContextMenuState,
  FlowRenderableEdgeData,
} from "./types";
import { FlowSemanticEdge } from "./edge-component";
import { installationAccountLabel } from "./start-filter-fields";

export interface FlowDerivedCanvasParams {
  draft: FlowDraftSnapshot | null;
  selectedFlowInstallation: Installation | null;
  selectedStartConfig: ReturnType<typeof getStartConfig> | null;
  repos: Repo[];
  contextMenu: FlowContextMenuState | null;
  openEdgeContextMenu: (edgeId: string, x: number, y: number) => void;
}

export interface FlowDerivedCanvasResult {
  renderedCanvasNodes: FlowCanvasNode[];
  currentTriggerNode: FlowCanvasNode | null;
  currentTriggerLabel: string;
  currentTriggerProvider: string;
  sandboxTestRepos: Repo[];
  hasCanvasSelection: boolean;
  contextMenuPosition: { left: number; top: number } | null;
  edgeTypes: { semantic: typeof FlowSemanticEdge };
  renderedEdges: FlowCanvasEdge[];
  draftGraph: FlowGraph | null;
}

export function useFlowDerivedCanvas(
  params: FlowDerivedCanvasParams
): FlowDerivedCanvasResult {
  const {
    draft,
    selectedFlowInstallation,
    selectedStartConfig,
    repos,
    contextMenu,
    openEdgeContextMenu,
  } = params;

  const renderedCanvasNodes = useMemo(() => {
    if (!draft) return [];
    const accountLabel = selectedFlowInstallation
      ? installationAccountLabel(selectedFlowInstallation)
      : undefined;
    return draft.nodes.map((node: FlowCanvasNode) =>
      node.type === "start"
        ? {
            ...node,
            data: {
              ...node.data,
              accountLabel,
            },
          }
        : node
    );
  }, [draft, selectedFlowInstallation]);

  const currentTriggerNode = useMemo(
    () =>
      draft?.nodes.find((node: FlowCanvasNode) => node.type === "start") ??
      null,
    [draft]
  );

  const currentTriggerLabel = useMemo(
    () =>
      selectedStartConfig ? eventLabel(selectedStartConfig.event) : "Trigger",
    [selectedStartConfig]
  );

  const currentTriggerProvider = useMemo(() => {
    switch (selectedStartConfig?.event) {
      case "schedule":
        return "Cron";
      case "webhook":
        return "Signed webhook";
      case "slack_mention":
        return "Slack";
      default:
        return "GitHub";
    }
  }, [selectedStartConfig?.event]);

  const sandboxTestRepos = useMemo<Repo[]>(() => {
    const scopedRepoNames = new Set(
      (selectedStartConfig?.filter?.repos || []).map((repo: string) =>
        repo.toLowerCase()
      )
    );
    if (scopedRepoNames.size === 0) return repos;
    const filtered = repos.filter((repo) =>
      scopedRepoNames.has(repo.full_name.toLowerCase())
    );
    return filtered.length > 0 ? filtered : repos;
  }, [repos, selectedStartConfig?.filter?.repos]);

  const hasCanvasSelection = Boolean(
    draft?.selectedNodeId ||
    draft?.nodes.some((node: FlowCanvasNode) => node.selected) ||
    draft?.edges.some((edge: FlowCanvasEdge) => edge.selected)
  );

  const contextMenuPosition = useMemo(() => {
    if (!contextMenu) return null;
    const width = 240;
    const height =
      contextMenu.kind === "node"
        ? 220
        : contextMenu.kind === "edge"
          ? 180
          : 480;
    const padding = 12;
    const rawX = Number.isFinite(contextMenu.x) ? contextMenu.x : padding;
    const rawY = Number.isFinite(contextMenu.y) ? contextMenu.y : padding;
    const maxLeft =
      typeof window === "undefined"
        ? rawX
        : window.innerWidth - width - padding;
    const maxTop =
      typeof window === "undefined"
        ? rawY
        : window.innerHeight - height - padding;
    return {
      left: Math.max(padding, Math.min(rawX, maxLeft)),
      top: Math.max(padding, Math.min(rawY, maxTop)),
    };
  }, [contextMenu]);

  const edgeTypes = useMemo(
    () => ({
      semantic: FlowSemanticEdge,
    }),
    []
  );

  const renderedEdges = useMemo<FlowCanvasEdge[]>(() => {
    if (!draft) return [];

    return draft.edges.map((edge: FlowCanvasEdge) => {
      const sourceNode = draft.nodes.find(
        (node: FlowCanvasNode) => node.id === edge.source
      );
      const targetNode = draft.nodes.find(
        (node: FlowCanvasNode) => node.id === edge.target
      );

      let label: string | null = null;
      let tone: FlowRenderableEdgeData["tone"] = "default";

      if (edge.sourceHandle === FAILURE_HANDLE_ID) {
        label = "Error";
        tone = "danger";
      } else if (sourceNode?.type === "condition") {
        if (edge.sourceHandle === CONDITION_HANDLE_IDS.true) {
          label = "Then";
          tone = "condition";
        } else if (edge.sourceHandle === CONDITION_HANDLE_IDS.false) {
          label = "Else";
          tone = "alternate";
        }
      } else if (sourceNode?.type === "parallel") {
        label = "Branch";
        tone = "parallel";
      } else if (targetNode?.type === "join") {
        label = "Merge";
        tone = "join";
      } else if (sourceNode?.type === "delay") {
        label = "Resume";
      }

      return {
        ...edge,
        type: "semantic",
        data: {
          label,
          tone,
          edgeId: edge.id,
          onInsertMenu: openEdgeContextMenu,
        } as Record<string, unknown>,
      };
    });
  }, [draft, openEdgeContextMenu]);

  const draftGraph = useMemo(
    () => (draft ? draftToGraph(draft) : null),
    [draft]
  );

  return {
    renderedCanvasNodes,
    currentTriggerNode,
    currentTriggerLabel,
    currentTriggerProvider,
    sandboxTestRepos,
    hasCanvasSelection,
    contextMenuPosition,
    edgeTypes,
    renderedEdges,
    draftGraph,
  };
}
