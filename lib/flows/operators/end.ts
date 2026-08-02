import type { FlowNode } from "@/lib/types";
import type { FlowOperatorDefinition } from "./types";

type EndNode = Extract<FlowNode, { type: "end" }>;

export const endOperator: FlowOperatorDefinition<EndNode> = {
  type: "end",
  // Structural rules for the end node (single, no outgoing) live in
  // validateFlowGraph itself.
  validate: () => [],
  coerceData: (raw) => ({
    label: typeof raw.label === "string" ? raw.label : "Done",
  }),
  defaultData: (input) => ({
    label: input.label?.trim() || "Done",
  }),
  execute: async ({
    node,
    label,
    shouldSkip,
    inboundTokens,
    outputs,
    completeNodeRun,
  }) => {
    const summary = shouldSkip ? `${label} skipped` : `${label} completed`;
    outputs.set(node.id, { label, text: summary });
    await completeNodeRun({
      status: shouldSkip ? "skipped" : "success",
      output: {
        completed: !shouldSkip,
        inbound_count: inboundTokens.length,
      },
    });
    return { ok: true, emitted: [] };
  },
};
