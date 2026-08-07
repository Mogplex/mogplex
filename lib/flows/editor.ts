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

// Re-export selection operations from the selection module.
export {
  clearFlowDraftSelection,
  selectFlowDraftNode,
  selectFlowDraftEdge,
  selectAllFlowDraftAgents,
  deleteSelectedFlowDraftItems,
} from "./editor-selection";

// Re-export clipboard operations from the clipboard module.
export type { FlowDraftClipboard } from "./editor-clipboard";
export {
  copySelectedFlowDraftItems,
  pasteFlowDraftItems,
  duplicateSelectedFlowDraftAgents,
} from "./editor-clipboard";

// Re-export layout operations from the layout module.
export {
  straightenSelectedFlowDraftNodes,
  tidyFlowDraftLayout,
} from "./editor-layout";

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

type InsertNodeOptions = {
  position?: { x: number; y: number };
  idFactory?: () => string;
  label?: string | null;
  agentId?: string | null;
  role?: FlowAgentNodeRole;
  operation?: FlowActionOperation;
};

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
