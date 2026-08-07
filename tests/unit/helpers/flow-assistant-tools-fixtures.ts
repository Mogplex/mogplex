import type { FlowGraph } from "../../../lib/types";

export const emptyGraph: FlowGraph = {
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

export const allowedAgents = [
  { id: "agent-1", name: "Reviewer", slug: "reviewer" },
  { id: "agent-2", name: "Editor", slug: "editor" },
];

/**
 * Helper to invoke a tool's execute function.
 * The AI SDK tool object has an execute property that is a function.
 */
export async function invokeTool<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool: any,
  args: Record<string, unknown>
): Promise<T> {
  return tool.execute(args, { toolCallId: "test", messages: [] });
}

export function agentNodeModel(graph: FlowGraph) {
  const node = graph.nodes.find((n) => n.type === "agent");
  return node?.type === "agent" ? node.data.modelOverride : undefined;
}
