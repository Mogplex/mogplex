import { DEFAULT_FLOW_VIEWPORT } from "@/lib/flows/graph";
import { FLOW_OPERATOR_REGISTRY } from "@/lib/flows/operators/registry";
import type { Edge, Node, Viewport } from "@xyflow/react";
import type {
  Flow,
  FlowActionOperation,
  FlowAgentNodeRole,
  FlowEdge,
  FlowGraph,
  FlowNode,
  FlowNodeType,
} from "@/lib/types";

export type FlowCanvasNode = Node<Record<string, unknown>, string>;
export type FlowCanvasEdge = Edge;

export type FlowDraftSnapshot = {
  name: string;
  description: string;
  notes: string;
  nodes: FlowCanvasNode[];
  edges: FlowCanvasEdge[];
  viewport: Viewport;
  selectedNodeId: string | null;
};

export type FlowDraftClipboard = {
  nodes: FlowCanvasNode[];
  edges: FlowCanvasEdge[];
};

type InsertNodeOptions = {
  position?: { x: number; y: number };
  idFactory?: () => string;
  label?: string | null;
  agentId?: string | null;
  role?: FlowAgentNodeRole;
  operation?: FlowActionOperation;
};

const STRUCTURAL_NODE_TYPES = new Set<FlowNodeType>(["start", "end"]);

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

function editableNode(node: FlowCanvasNode) {
  return !STRUCTURAL_NODE_TYPES.has(node.type as FlowNodeType);
}

function defaultPosition(snapshot: FlowDraftSnapshot, nextIndex: number) {
  return { x: 360, y: 120 + nextIndex * 120 };
}

function createNodeData(
  type: FlowNodeType,
  input: InsertNodeOptions & { nextIndex: number }
) {
  const operator = FLOW_OPERATOR_REGISTRY[type];
  return operator.defaultData({
    nextIndex: input.nextIndex,
    label: input.label,
    agentId: input.agentId,
    role: input.role,
    operation: input.operation,
  });
}

export function cloneFlowDraftSnapshot(
  snapshot: FlowDraftSnapshot
): FlowDraftSnapshot {
  return {
    name: snapshot.name,
    description: snapshot.description,
    notes: snapshot.notes,
    nodes: snapshot.nodes.map(cloneFlowCanvasNode),
    edges: snapshot.edges.map(cloneFlowCanvasEdge),
    viewport: { ...snapshot.viewport },
    selectedNodeId: snapshot.selectedNodeId,
  };
}

export function graphToCanvas(graph: FlowGraph) {
  return {
    nodes: graph.nodes.map((node) => ({ ...node })) as FlowCanvasNode[],
    edges: graph.edges.map((edge) => ({ ...edge })) as FlowCanvasEdge[],
    viewport: graph.viewport || { ...DEFAULT_FLOW_VIEWPORT },
  };
}

export function draftToGraph(snapshot: FlowDraftSnapshot): FlowGraph {
  return {
    nodes: snapshot.nodes.map((node) => {
      switch (node.type) {
        case "start":
          return {
            id: node.id,
            type: "start",
            position: node.position,
            data: node.data as Extract<FlowNode, { type: "start" }>["data"],
          };
        case "agent":
          return {
            id: node.id,
            type: "agent",
            position: node.position,
            data: node.data as Extract<FlowNode, { type: "agent" }>["data"],
          };
        case "action":
          return {
            id: node.id,
            type: "action",
            position: node.position,
            data: node.data as Extract<FlowNode, { type: "action" }>["data"],
          };
        case "condition":
          return {
            id: node.id,
            type: "condition",
            position: node.position,
            data: node.data as Extract<FlowNode, { type: "condition" }>["data"],
          };
        case "parallel":
          return {
            id: node.id,
            type: "parallel",
            position: node.position,
            data: node.data as Extract<FlowNode, { type: "parallel" }>["data"],
          };
        case "join":
          return {
            id: node.id,
            type: "join",
            position: node.position,
            data: node.data as Extract<FlowNode, { type: "join" }>["data"],
          };
        case "delay":
          return {
            id: node.id,
            type: "delay",
            position: node.position,
            data: node.data as Extract<FlowNode, { type: "delay" }>["data"],
          };
        case "await_event":
          return {
            id: node.id,
            type: "await_event",
            position: node.position,
            data: node.data as Extract<
              FlowNode,
              { type: "await_event" }
            >["data"],
          };
        case "set_variable":
          return {
            id: node.id,
            type: "set_variable",
            position: node.position,
            data: node.data as Extract<
              FlowNode,
              { type: "set_variable" }
            >["data"],
          };
        case "transform":
          return {
            id: node.id,
            type: "transform",
            position: node.position,
            data: node.data as Extract<FlowNode, { type: "transform" }>["data"],
          };
        case "end":
        default:
          return {
            id: node.id,
            type: "end",
            position: node.position,
            data: node.data as Extract<FlowNode, { type: "end" }>["data"],
          };
      }
    }),
    edges: snapshot.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
    })) as FlowEdge[],
    viewport: snapshot.viewport,
  };
}

export function createFlowDraftSnapshot(
  flow: Pick<Flow, "name" | "description" | "notes" | "draft_graph">
): FlowDraftSnapshot {
  const canvas = graphToCanvas(flow.draft_graph);
  return {
    name: flow.name,
    description: flow.description || "",
    notes: flow.notes || "",
    nodes: canvas.nodes,
    edges: canvas.edges,
    viewport: canvas.viewport,
    selectedNodeId: null,
  };
}

export function serializePersistedFlowDraft(snapshot: FlowDraftSnapshot) {
  // Build the dirty-check key directly from the snapshot, making all
  // exclusions explicit rather than inheriting them as side-effects of
  // draftToGraph:
  //   - viewport: excluded so fit-view/pan do not mark the draft dirty or
  //     trigger an autosave PUT. Viewport is still persisted on real graph
  //     saves because the PUT body is built via draftToGraph (which retains
  //     it); this serialization is used only for equality comparison.
  //   - transient React Flow node fields (measured, dragging,
  //     positionAbsolute, selected, etc.): excluded by only picking
  //     id/type/position/data per node.
  //   - edge transient fields (selected, animated, etc.): excluded by only
  //     picking id/source/target/sourceHandle/targetHandle per edge.
  //   - selectedNodeId: excluded (selection does not affect persisted state).
  return JSON.stringify({
    name: snapshot.name,
    description: snapshot.description,
    notes: snapshot.notes,
    graph: {
      nodes: snapshot.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        position: node.position,
        data: node.data,
      })),
      edges: snapshot.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
      })),
    },
  });
}

export function serializePersistedFlowGraph(graph: FlowGraph) {
  return JSON.stringify({
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: node.data,
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
    })),
  });
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

export function insertFlowDraftNode(
  snapshot: FlowDraftSnapshot,
  type: Exclude<FlowNodeType, "start" | "end">,
  options?: InsertNodeOptions
) {
  const nextNodeIndex =
    snapshot.nodes.filter((node) => node.type === type).length + 1;
  const idFactory =
    options?.idFactory ?? (() => crypto.randomUUID().slice(0, 8));
  const newNode: FlowCanvasNode = {
    id: `${type}-${idFactory()}`,
    type,
    position: options?.position ?? defaultPosition(snapshot, nextNodeIndex),
    data: createNodeData(type, {
      ...options,
      nextIndex: nextNodeIndex,
    }),
    selected: true,
  };

  return {
    changed: true,
    snapshot: {
      ...snapshot,
      nodes: [
        ...snapshot.nodes.map((node) => ({ ...node, selected: false })),
        newNode,
      ],
      edges: snapshot.edges.map((edge) => ({ ...edge, selected: false })),
      selectedNodeId: newNode.id,
    },
  };
}

export function insertFlowDraftAgent(
  snapshot: FlowDraftSnapshot,
  options?: InsertNodeOptions
) {
  return insertFlowDraftNode(snapshot, "agent", options);
}

export function insertFlowDraftNodeOnEdge(
  snapshot: FlowDraftSnapshot,
  edgeId: string,
  type:
    | "agent"
    | "action"
    | "delay"
    | "await_event"
    | "set_variable"
    | "transform",
  options?: InsertNodeOptions
) {
  const edge = snapshot.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) {
    return { snapshot, changed: false };
  }

  const sourceNode = snapshot.nodes.find((node) => node.id === edge.source);
  const targetNode = snapshot.nodes.find((node) => node.id === edge.target);
  const midpoint = options?.position ?? {
    x: ((sourceNode?.position.x ?? 0) + (targetNode?.position.x ?? 0)) / 2,
    y: ((sourceNode?.position.y ?? 0) + (targetNode?.position.y ?? 0)) / 2,
  };

  const inserted = insertFlowDraftNode(
    {
      ...snapshot,
      edges: snapshot.edges.filter((candidate) => candidate.id !== edgeId),
    },
    type,
    {
      ...options,
      position: midpoint,
    }
  );

  if (!inserted.changed || !inserted.snapshot.selectedNodeId) {
    return { snapshot, changed: false };
  }

  const insertedNodeId = inserted.snapshot.selectedNodeId;
  const edgeSuffix = (
    options?.idFactory ?? (() => crypto.randomUUID().slice(0, 8))
  )();

  return {
    changed: true,
    snapshot: {
      ...inserted.snapshot,
      edges: [
        ...inserted.snapshot.edges,
        {
          id: `${edge.source}-${insertedNodeId}-${edgeSuffix}-a`,
          source: edge.source,
          sourceHandle: edge.sourceHandle ?? undefined,
          target: insertedNodeId,
          selected: false,
        },
        {
          id: `${insertedNodeId}-${edge.target}-${edgeSuffix}-b`,
          source: insertedNodeId,
          target: edge.target,
          targetHandle: edge.targetHandle ?? undefined,
          selected: false,
        },
      ],
    },
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

export function straightenSelectedFlowDraftNodes(snapshot: FlowDraftSnapshot) {
  const selectedNodes = snapshot.nodes.filter(
    (node) => editableNode(node) && node.selected
  );
  const targetNodes =
    selectedNodes.length > 1
      ? selectedNodes
      : snapshot.nodes.filter((node) => editableNode(node));

  if (targetNodes.length <= 1) {
    return { snapshot, changed: false };
  }

  const targetIds = new Set(targetNodes.map((node) => node.id));
  const baselineY = Math.round(
    targetNodes.reduce((sum, node) => sum + node.position.y, 0) /
      targetNodes.length
  );

  return {
    changed: true,
    snapshot: {
      ...snapshot,
      nodes: snapshot.nodes.map((node) =>
        targetIds.has(node.id)
          ? { ...node, position: { ...node.position, y: baselineY } }
          : node
      ),
    },
  };
}

export function tidyFlowDraftLayout(snapshot: FlowDraftSnapshot) {
  const startNode = snapshot.nodes.find((node) => node.type === "start");
  if (!startNode) {
    return { snapshot, changed: false };
  }

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const node of snapshot.nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }
  for (const edge of snapshot.edges) {
    outgoing.get(edge.source)?.push(edge.target);
    incoming.get(edge.target)?.push(edge.source);
  }

  const depth = new Map<string, number>([[startNode.id, 0]]);
  const queue = [startNode.id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const nextDepth = (depth.get(current) ?? 0) + 1;
    for (const nextId of outgoing.get(current) || []) {
      const existing = depth.get(nextId);
      if (existing == null || nextDepth > existing) {
        depth.set(nextId, nextDepth);
      }
      if (!queue.includes(nextId)) {
        queue.push(nextId);
      }
    }
  }

  const grouped = new Map<number, FlowCanvasNode[]>();
  for (const node of snapshot.nodes) {
    const nodeDepth = depth.get(node.id) ?? 0;
    const list = grouped.get(nodeDepth) || [];
    list.push(node);
    grouped.set(nodeDepth, list);
  }

  const positioned = new Map<string, { x: number; y: number }>();
  const sortedDepths = [...grouped.keys()].sort((a, b) => a - b);
  for (const level of sortedDepths) {
    const nodesAtLevel = (grouped.get(level) || [])
      .slice()
      .sort((left, right) => left.position.y - right.position.y);
    const center = 240;
    const gap = 180;
    const totalHeight = Math.max(0, (nodesAtLevel.length - 1) * gap);
    const startY = center - totalHeight / 2;

    for (const [index, node] of nodesAtLevel.entries()) {
      positioned.set(node.id, {
        x: 180 + level * 280,
        y: Math.round(startY + index * gap),
      });
    }
  }

  return {
    changed: true,
    snapshot: {
      ...snapshot,
      nodes: snapshot.nodes.map((node) => ({
        ...node,
        position: positioned.get(node.id) ?? node.position,
      })),
    },
  };
}
