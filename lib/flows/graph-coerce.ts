import type { FlowEdge, FlowGraph, FlowNode, FlowNodeType } from "@/lib/types";
import { FLOW_OPERATOR_REGISTRY } from "@/lib/flows/operators/registry";

const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 };

export function coerceGraph(input: unknown): FlowGraph {
  if (!input || typeof input !== "object") {
    return {
      nodes: [],
      edges: [],
      viewport: { ...DEFAULT_VIEWPORT },
    };
  }

  const record = input as Record<string, unknown>;
  const nodes = Array.isArray(record.nodes) ? record.nodes : [];
  const edges = Array.isArray(record.edges) ? record.edges : [];

  return {
    nodes: nodes.flatMap((node): FlowNode[] => {
      if (!node || typeof node !== "object") return [];
      const raw = node as Record<string, unknown>;
      const type = raw.type as FlowNodeType;
      const operator = FLOW_OPERATOR_REGISTRY[type];
      if (!operator) return [];
      const positionRecord =
        raw.position && typeof raw.position === "object"
          ? (raw.position as Record<string, unknown>)
          : {};
      const data =
        raw.data && typeof raw.data === "object"
          ? (raw.data as Record<string, unknown>)
          : {};
      return [
        {
          id: String(raw.id ?? crypto.randomUUID()),
          type,
          position: {
            x: Number(positionRecord.x ?? 0),
            y: Number(positionRecord.y ?? 0),
          },
          data: operator.coerceData(data),
        } as FlowNode,
      ];
    }),
    edges: edges.flatMap((edge): FlowEdge[] => {
      if (!edge || typeof edge !== "object") return [];
      const raw = edge as Record<string, unknown>;
      return [
        {
          id: String(raw.id ?? `${raw.source}-${raw.target}`),
          source: String(raw.source ?? ""),
          target: String(raw.target ?? ""),
          sourceHandle:
            typeof raw.sourceHandle === "string" ? raw.sourceHandle : null,
          targetHandle:
            typeof raw.targetHandle === "string" ? raw.targetHandle : null,
        },
      ];
    }),
    viewport:
      record.viewport && typeof record.viewport === "object"
        ? {
            x: Number((record.viewport as Record<string, unknown>).x ?? 0),
            y: Number((record.viewport as Record<string, unknown>).y ?? 0),
            zoom: Number(
              (record.viewport as Record<string, unknown>).zoom ?? 1
            ),
          }
        : { ...DEFAULT_VIEWPORT },
  };
}
