import type {
  FlowCanvasEdge,
  FlowCanvasNode,
  FlowDraftSnapshot,
} from "./editor";
import type { FlowNodeType } from "@/lib/types";

export type FlowDraftClipboard = {
  nodes: FlowCanvasNode[];
  edges: FlowCanvasEdge[];
};

const STRUCTURAL_NODE_TYPES = new Set<FlowNodeType>(["start", "end"]);

function editableNode(node: FlowCanvasNode) {
  return !STRUCTURAL_NODE_TYPES.has(node.type as FlowNodeType);
}

function cloneFlowCanvasNode(node: FlowCanvasNode): FlowCanvasNode {
  return {
    ...node,
    position: { ...node.position },
    data: { ...node.data },
  };
}

function cloneFlowCanvasEdge(edge: FlowCanvasEdge): FlowCanvasEdge {
  return {
    ...edge,
  };
}

export function copySelectedFlowDraftItems(
  snapshot: FlowDraftSnapshot
): FlowDraftClipboard | null {
  const nodes = snapshot.nodes
    .filter((node) => node.selected && editableNode(node))
    .map(cloneFlowCanvasNode);
  if (nodes.length === 0) {
    return null;
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: snapshot.edges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map(cloneFlowCanvasEdge),
  };
}

export function pasteFlowDraftItems(
  snapshot: FlowDraftSnapshot,
  clipboard: FlowDraftClipboard,
  options?: { offset?: { x: number; y: number }; idFactory?: () => string }
) {
  if (clipboard.nodes.length === 0) {
    return { snapshot, changed: false };
  }

  const offset = options?.offset ?? { x: 48, y: 48 };
  const idFactory =
    options?.idFactory ?? (() => crypto.randomUUID().slice(0, 8));
  const nodeIdMap = new Map<string, string>();
  const nodes = clipboard.nodes.map((node) => {
    const id = `${node.type}-${idFactory()}`;
    nodeIdMap.set(node.id, id);
    return {
      ...cloneFlowCanvasNode(node),
      id,
      position: {
        x: node.position.x + offset.x,
        y: node.position.y + offset.y,
      },
      selected: true,
    };
  });
  const edges = clipboard.edges.flatMap((edge) => {
    const source = nodeIdMap.get(edge.source);
    const target = nodeIdMap.get(edge.target);
    if (!source || !target) return [];
    return [
      {
        ...cloneFlowCanvasEdge(edge),
        id: `edge-${idFactory()}`,
        source,
        target,
        selected: false,
      },
    ];
  });

  return {
    changed: true,
    snapshot: {
      ...snapshot,
      nodes: [
        ...snapshot.nodes.map((node) => ({ ...node, selected: false })),
        ...nodes,
      ],
      edges: [
        ...snapshot.edges.map((edge) => ({ ...edge, selected: false })),
        ...edges,
      ],
      selectedNodeId: nodes[0]?.id ?? null,
    },
  };
}

export function duplicateSelectedFlowDraftAgents(
  snapshot: FlowDraftSnapshot,
  options?: { offset?: { x: number; y: number }; idFactory?: () => string }
) {
  const selectedNodes = snapshot.nodes.filter(
    (node) => editableNode(node) && node.selected
  );
  if (selectedNodes.length === 0) {
    return { snapshot, changed: false };
  }

  const offset = options?.offset ?? { x: 48, y: 48 };
  const idFactory =
    options?.idFactory ?? (() => crypto.randomUUID().slice(0, 8));
  const duplicates = selectedNodes.map((node) => ({
    ...cloneFlowCanvasNode(node),
    id: `${node.type}-${idFactory()}`,
    position: {
      x: node.position.x + offset.x,
      y: node.position.y + offset.y,
    },
    selected: true,
  }));

  return {
    changed: true,
    snapshot: {
      ...snapshot,
      nodes: [
        ...snapshot.nodes.map((node) => ({ ...node, selected: false })),
        ...duplicates,
      ],
      edges: snapshot.edges.map((edge) => ({ ...edge, selected: false })),
      selectedNodeId: duplicates[0]?.id ?? null,
    },
  };
}
