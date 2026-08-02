import type { FlowNode } from "@/lib/types";
import type { FlowOperatorDefinition } from "./types";

type ParallelNode = Extract<FlowNode, { type: "parallel" }>;

export const parallelOperator: FlowOperatorDefinition<ParallelNode> = {
  type: "parallel",
  validate: ({ node, inbound, outbound }) => {
    const errors: string[] = [];
    if (inbound.length !== 1)
      errors.push(
        `Parallel node "${node.data.label}" must have exactly one incoming edge.`
      );
    if (outbound.length < 2)
      errors.push(
        `Parallel node "${node.data.label}" must have at least two outgoing edges.`
      );
    return errors;
  },
  coerceData: (raw) => ({
    label: typeof raw.label === "string" ? raw.label : "Parallel split",
  }),
  defaultData: (input) => ({
    label: input.label?.trim() || `Parallel ${input.nextIndex}`,
  }),
  execute: async ({
    node,
    label,
    graph,
    shouldSkip,
    outputs,
    completeNodeRun,
    completeSkipped,
    emit,
  }) => {
    if (shouldSkip) {
      return completeSkipped(
        "Parallel split skipped because every incoming branch was skipped"
      );
    }
    const branchCount = graph.edges.filter(
      (edge) => edge.source === node.id
    ).length;
    const summary = `${label} fan-out to ${branchCount} branch(es)`;
    outputs.set(node.id, { label, text: summary });
    await completeNodeRun({
      status: "success",
      output: { branch_count: branchCount },
    });
    return { ok: true, emitted: emit(label, summary) };
  },
};
