import type { FlowCanvasNode, FlowDraftSnapshot } from "./editor";
import type { FlowNodeType } from "@/lib/types";

const STRUCTURAL_NODE_TYPES = new Set<FlowNodeType>(["start", "end"]);

function editableNode(node: FlowCanvasNode) {
  return !STRUCTURAL_NODE_TYPES.has(node.type as FlowNodeType);
}

export function clearFlowDraftSelection(
  snapshot: FlowDraftSnapshot
): FlowDraftSnapshot {
  return {
    ...snapshot,
    nodes: snapshot.nodes.map((node) =>
      node.selected ? { ...node, selected: false } : node
    ),
    edges: snapshot.edges.map((edge) =>
      edge.selected ? { ...edge, selected: false } : edge
    ),
    selectedNodeId: null,
  };
}

export function selectFlowDraftNode(
  snapshot: FlowDraftSnapshot,
  nodeId: string
): FlowDraftSnapshot {
  return {
    ...snapshot,
    nodes: snapshot.nodes.map((node) => ({
      ...node,
      selected: node.id === nodeId,
    })),
    edges: snapshot.edges.map((edge) => ({
      ...edge,
      selected: false,
    })),
    selectedNodeId: snapshot.nodes.some((node) => node.id === nodeId)
      ? nodeId
      : null,
  };
}

export function selectFlowDraftEdge(
  snapshot: FlowDraftSnapshot,
  edgeId: string
): FlowDraftSnapshot {
  return {
    ...snapshot,
    nodes: snapshot.nodes.map((node) => ({
      ...node,
      selected: false,
    })),
    edges: snapshot.edges.map((edge) => ({
      ...edge,
      selected: edge.id === edgeId,
    })),
    selectedNodeId: null,
  };
}

export function selectAllFlowDraftAgents(
  snapshot: FlowDraftSnapshot
): FlowDraftSnapshot {
  const selectedNodeIds = snapshot.nodes
    .filter((node) => editableNode(node))
    .map((node) => node.id);

  return {
    ...snapshot,
    nodes: snapshot.nodes.map((node) => ({
      ...node,
      selected: editableNode(node),
    })),
    edges: snapshot.edges.map((edge) => ({
      ...edge,
      selected: false,
    })),
    selectedNodeId: selectedNodeIds[0] ?? null,
  };
}

export function deleteSelectedFlowDraftItems(snapshot: FlowDraftSnapshot) {
  const selectedNodeIds = new Set(
    snapshot.nodes
      .filter((node) => node.selected && editableNode(node))
      .map((node) => node.id)
  );
  const selectedEdgeIds = new Set(
    snapshot.edges.filter((edge) => edge.selected).map((edge) => edge.id)
  );

  if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) {
    return { snapshot, changed: false };
  }

  return {
    changed: true,
    snapshot: {
      ...snapshot,
      nodes: snapshot.nodes
        .filter((node) => !selectedNodeIds.has(node.id))
        .map((node) => ({ ...node, selected: false })),
      edges: snapshot.edges
        .filter((edge) => !selectedEdgeIds.has(edge.id))
        .filter(
          (edge) =>
            !selectedNodeIds.has(edge.source) &&
            !selectedNodeIds.has(edge.target)
        )
        .map((edge) => ({ ...edge, selected: false })),
      selectedNodeId: selectedNodeIds.has(snapshot.selectedNodeId ?? "")
        ? null
        : snapshot.selectedNodeId,
    },
  };
}
