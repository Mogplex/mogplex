/**
 * Flow-run state container for executeResolvedFlow.
 *
 * Holds the per-run mutable state: node outputs, flow variables (set by
 * set_variable/transform), received tokens per node, processed tracking,
 * and incoming-edge counts. This module provides pure state accessors that
 * do not depend on node execution logic.
 */

import type { FlowGraph } from "@/lib/types";
import type { FlowExecutionToken } from "@/lib/workflows/automation-job-types";
import { getOutgoingEdges } from "@/lib/flows/graph";

export type FlowRunOutput = { label: string; text: string };

export type FlowEmission = {
  targetId: string;
  token: FlowExecutionToken;
};

/**
 * Encapsulates the per-run state for a flow execution.
 */
export type FlowRunState = {
  /** Node id -> final output text */
  outputs: Map<string, FlowRunOutput>;

  /**
   * Per-run mutable state. Written by `set_variable` and `transform`, read by
   * downstream conditions under `state.<key>`. Lives only for the duration of
   * this job execution - never persisted to the published graph.
   */
  flowState: Map<string, unknown>;

  /** Node id -> tokens received from predecessors */
  receivedTokens: Map<string, FlowExecutionToken[]>;

  /** Count of incoming edges per node (for readiness calculation) */
  incomingCounts: Map<string, number>;

  /** Node ids that have been processed */
  processed: Set<string>;

  /** Aggregated agent results */
  results: unknown[];

  /** First observability error encountered */
  observabilityError: string | null;

  /** Auto-merge request from a review node */
  autoMergeRequest: {
    prNumber: number;
    expectedHeadSha: string | null;
    commitTitle?: string | null;
  } | null;

  /** Expected head SHA for the trigger PR (updated by edit nodes) */
  expectedTriggerHeadSha: string | null;
};

/**
 * Creates an initialized flow-run state container.
 */
export function createFlowRunState(input: {
  graph: FlowGraph;
  initialHeadSha: string | null;
}): FlowRunState {
  const incomingCounts = new Map<string, number>();

  for (const node of input.graph.nodes) {
    incomingCounts.set(
      node.id,
      input.graph.edges.filter((edge) => edge.target === node.id).length
    );
  }

  return {
    outputs: new Map(),
    flowState: new Map(),
    receivedTokens: new Map(),
    incomingCounts,
    processed: new Set(),
    results: [],
    observabilityError: null,
    autoMergeRequest: null,
    expectedTriggerHeadSha: input.initialHeadSha,
  };
}

/**
 * Collects non-skipped outputs from predecessor nodes.
 */
export function collectPredecessorOutputs(
  state: FlowRunState,
  nodeId: string
): Array<{ label: string; text: string }> {
  const inboundTokens = state.receivedTokens.get(nodeId) ?? [];
  return inboundTokens
    .filter((token) => !token.skipped && token.text.trim().length > 0)
    .map((token) => ({
      label: token.label,
      text: token.text,
    }));
}

/**
 * Emits tokens to all outgoing edges of a node, optionally filtered by selector.
 */
export function emitToOutgoing(
  graph: FlowGraph,
  nodeId: string,
  label: string,
  text: string,
  skipped = false,
  payload?: Record<string, unknown> | null,
  selector?: (edge: FlowGraph["edges"][number]) => boolean
): FlowEmission[] {
  return getOutgoingEdges(graph, nodeId)
    .filter((edge) => (selector ? selector(edge) : true))
    .map((edge) => ({
      targetId: edge.target,
      token: {
        fromNodeId: nodeId,
        label,
        text,
        skipped,
        payload: payload ?? null,
      } satisfies FlowExecutionToken,
    }));
}

/**
 * Records a token received by a target node.
 */
export function recordReceivedToken(
  state: FlowRunState,
  targetId: string,
  token: FlowExecutionToken
): void {
  const existing = state.receivedTokens.get(targetId) ?? [];
  state.receivedTokens.set(targetId, [...existing, token]);
}

/**
 * Marks a node as processed.
 */
export function markNodeProcessed(state: FlowRunState, nodeId: string): void {
  state.processed.add(nodeId);
}

/**
 * Checks if a node has been processed.
 */
export function isNodeProcessed(state: FlowRunState, nodeId: string): boolean {
  return state.processed.has(nodeId);
}

/**
 * Notes an observability error, keeping only the first one encountered.
 */
export function noteObservabilityError(
  state: FlowRunState,
  value: string | null
): void {
  if (value && !state.observabilityError) {
    state.observabilityError = value;
  }
}

/**
 * Returns the expected head SHA for a given PR number.
 * Only returns a value if the PR matches the trigger PR.
 */
export function expectedHeadShaFor(
  state: FlowRunState,
  prNumber: number,
  triggerPrNumber: number | null
): string | null {
  return triggerPrNumber === prNumber ? state.expectedTriggerHeadSha : null;
}
