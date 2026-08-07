import type { FlowCanvasNode, FlowDraftSnapshot } from "./editor";
import type { FlowNodeType } from "@/lib/types";

const STRUCTURAL_NODE_TYPES = new Set<FlowNodeType>(["start", "end"]);

function editableNode(node: FlowCanvasNode) {
  return !STRUCTURAL_NODE_TYPES.has(node.type as FlowNodeType);
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
