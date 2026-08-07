import { FlowServiceError } from "@/lib/flows/errors";
import { coerceGraph, validateFlowGraph } from "@/lib/flows/graph";
import type { FlowGraph } from "@/lib/types";
import { getState } from "./test-store-state";
import { deepClone } from "./test-store-types";
import { requireOwnedFlowRow } from "./test-store-helpers";

export async function generateFlowAssistantSuggestion(input: {
  userId: string;
  flowId: string;
  message: string;
  graph: FlowGraph;
}) {
  requireOwnedFlowRow(input.userId, input.flowId);
  const state = getState();

  if (state.assistant.nextError) {
    const error = state.assistant.nextError;
    state.assistant.nextError = null;
    throw new FlowServiceError("FLOW_STORAGE_FAILED", error);
  }

  const configured = state.assistant.nextResult;
  state.assistant.nextResult = null;

  if (configured) {
    const graph = coerceGraph(configured.graph);
    const validation = validateFlowGraph(graph, {
      requireRunnableConfig: true,
    });
    if (!validation.valid) {
      throw new FlowServiceError(
        "FLOW_ASSISTANT_INVALID_GRAPH",
        "Assistant produced an invalid flow graph",
        {
          details: validation.errors,
        }
      );
    }

    return {
      summary: configured.summary,
      graph,
    };
  }

  return {
    summary: `Updated flow for: ${input.message}`,
    graph: deepClone(input.graph),
  };
}
