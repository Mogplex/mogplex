import type { FlowGraph } from "@/lib/types";
import type { FlowRunOutput } from "./automation-job-flow-run-state";
import type { FlowReport } from "./flow-report-handoff";

export function collectAncestorReports(
  graph: FlowGraph,
  nodeId: string,
  outputs: Map<string, FlowRunOutput>
): FlowReport[] {
  const ancestors = new Set<string>();
  const pending = [nodeId];
  while (pending.length > 0) {
    const id = pending.pop()!;
    for (const edge of graph.edges) {
      if (edge.target !== id || ancestors.has(edge.source)) continue;
      ancestors.add(edge.source);
      pending.push(edge.source);
    }
  }
  return [...outputs].flatMap(([id, output]) =>
    ancestors.has(id) && output.handoff
      ? [{ nodeId: id, label: output.label.slice(0, 200), ...output.handoff }]
      : []
  );
}
