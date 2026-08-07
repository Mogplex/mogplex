/**
 * Condition node execution for executeResolvedFlow.
 *
 * Handles the inline `case "condition"` body as an exported function.
 * Condition nodes evaluate rules and route execution down the true/false branch.
 */

import type { FlowConditionNodeData } from "@/lib/types";
import type {
  JobContext,
  ResolvedFlowDefinition,
} from "@/lib/workflows/automation-job-types";
import type { FlowRunState } from "@/lib/workflows/automation-job-flow-run-state";
import type {
  NodeExecutionContext,
  NodeExecutionResult,
} from "@/lib/workflows/automation-job-node-execution";

import { evaluateConditionNode } from "@/lib/flows/graph";
import { buildFlowConditionState } from "@/lib/workflows/automation-job-context-resolution";
import { emitToOutgoing } from "@/lib/workflows/automation-job-flow-run-state";

type FlowConditionNode = {
  id: string;
  type: "condition";
  position: { x: number; y: number };
  data: FlowConditionNodeData;
};

export type ConditionNodeInput = {
  context: JobContext;
  resolvedFlow: ResolvedFlowDefinition;
  node: FlowConditionNode;
  execCtx: NodeExecutionContext;
  state: FlowRunState;
};

/**
 * Executes a condition node within a flow.
 */
export async function executeFlowConditionNode(
  input: ConditionNodeInput
): Promise<NodeExecutionResult> {
  const { node, execCtx, state, resolvedFlow, context } = input;
  const { label, shouldSkip, inboundTokens, completeSkipped, completeNodeRun } =
    execCtx;

  if (shouldSkip) {
    return completeSkipped(
      "Condition skipped because every incoming branch was skipped"
    );
  }

  const conditionState = buildFlowConditionState({
    context,
    inboundTokens,
    outputs: state.outputs,
    flowState: state.flowState,
  });

  const passed = evaluateConditionNode({
    node,
    state: conditionState,
  });

  const chosenHandle = passed ? "true" : "false";
  const skippedHandle = passed ? "false" : "true";
  const summary = `${label} evaluated ${passed ? "then" : "else"}`;

  state.outputs.set(node.id, { label, text: summary });

  await completeNodeRun({
    status: "success",
    output: {
      mode: node.data.mode,
      rules: node.data.rules,
      result: passed,
      branch: passed ? "then" : "else",
    },
  });

  return {
    ok: true as const,
    emitted: [
      ...emitToOutgoing(
        resolvedFlow.graph,
        node.id,
        label,
        summary,
        false,
        null,
        (edge) => (edge.sourceHandle ?? "true") === chosenHandle
      ),
      ...emitToOutgoing(
        resolvedFlow.graph,
        node.id,
        label,
        `Condition branch ${skippedHandle} skipped`,
        true,
        null,
        (edge) => (edge.sourceHandle ?? "true") === skippedHandle
      ),
    ],
  };
}
