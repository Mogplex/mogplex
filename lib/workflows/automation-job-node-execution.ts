/**
 * Node execution context factory for executeResolvedFlow.
 *
 * Provides per-node execution scaffolding: node-run row creation/completion,
 * failure-to-error-edge routing, completeFailedNode, and operator-registry
 * adapter wrappers. Methods mutate/read the shared flow-run state object.
 */

import type { FlowGraph, FlowNode } from "@/lib/types";
import type {
  FlowNodeRunStatus,
  FlowExecutionToken,
  JobContext,
  ResolvedFlowDefinition,
} from "@/lib/workflows/automation-job-types";
import type {
  FlowOperatorActionResult,
  FlowOperatorEmission,
  FlowOperatorEmittedToken,
  FlowOperatorExecuteContext,
  FlowOperatorExecuteResult,
  FlowOperatorWaitProvider,
  FlowOperatorWaitStore,
} from "@/lib/flows/operators/types";
import {
  createFlowNodeRunBestEffort,
  completeFlowNodeRunBestEffort,
} from "@/lib/workflows/automation-job-flow-nodes";
import { FAILURE_HANDLE_ID, getFailureEdges } from "@/lib/flows/graph";
import { buildFlowConditionState } from "@/lib/workflows/automation-job-context-resolution";
import { getFlowOperator } from "@/lib/flows/operators/registry";
import {
  type FlowRunState,
  type FlowEmission,
  emitToOutgoing,
  collectPredecessorOutputs,
  noteObservabilityError,
} from "@/lib/workflows/automation-job-flow-run-state";

export type NodeExecutionDeps = {
  throwIfJobRunCancelled: (jobRunId: string) => Promise<void>;
  runFlowAction: (input: {
    jobRunId: string;
    nodeId: string;
    action: unknown;
    context: JobContext;
    githubToken: string;
    loadPullRequestDetails: unknown;
    resolveAutofixTargetRepo: unknown;
  }) => Promise<unknown>;
  waitProvider: FlowOperatorWaitProvider;
  waitStore: FlowOperatorWaitStore;
};

export type NodeExecutionInput = {
  jobRunId: string;
  context: JobContext;
  githubToken: string;
  resolvedFlow: ResolvedFlowDefinition;
  deps: NodeExecutionDeps;
  state: FlowRunState;
  loadPullRequestDetails: unknown;
  resolveAutofixTargetRepo: unknown;
};

export type NodeExecutionResult =
  | { ok: true; emitted: FlowEmission[] }
  | {
      ok: false;
      message: string;
      context: JobContext;
      observabilityError: string | null;
      execution?: unknown;
      aiCallTelemetryHandled?: boolean;
    };

export type NodeRunHandle = {
  id: string | null;
  startedAt: string;
  observabilityError: string | null;
};

export type NodeExecutionContext = {
  node: FlowNode;
  label: string;
  inboundTokens: FlowExecutionToken[];
  activeInboundTokens: FlowExecutionToken[];
  shouldSkip: boolean;
  nodeRun: NodeRunHandle;
  completeNodeRun: (completion: {
    status: FlowNodeRunStatus;
    output?: Record<string, unknown> | null;
    error?: string | null;
  }) => Promise<number>;
  completeSkipped: (reason: string) => Promise<NodeExecutionResult>;
  /**
   * Routes a node failure to a downstream "error" handle when one is wired
   * up; otherwise returns null so the caller can fail the run normally.
   * Callers must have already recorded the node-run row as `failed` before
   * invoking this - this helper only changes the outgoing-token signal.
   *
   * Mirrors how condition emits skipped tokens on the not-taken branch: the
   * success-path edges still receive a skipped token so any multi-input
   * node downstream (join, end with parallel branches) doesn't deadlock.
   */
  routeFailureOrNull: (message: string) => NodeExecutionResult | null;
  completeFailedNode: (
    message: string,
    context: JobContext
  ) => Promise<NodeExecutionResult>;
  runOperator: () => Promise<NodeExecutionResult>;
  emitToOutgoing: (
    emitLabel: string,
    text: string,
    skipped?: boolean,
    payload?: Record<string, unknown> | null,
    selector?: (edge: FlowGraph["edges"][number]) => boolean
  ) => FlowEmission[];
  collectPredecessorOutputs: () => Array<{ label: string; text: string }>;
};

/**
 * Creates an execution context for a single node.
 */
export async function createNodeExecutionContext(
  input: NodeExecutionInput,
  node: FlowNode
): Promise<NodeExecutionContext> {
  const { state, resolvedFlow, deps, jobRunId, context, githubToken } = input;
  const graph = resolvedFlow.graph;

  const label = typeof node.data.label === "string" ? node.data.label : node.id;
  const inboundTokens = state.receivedTokens.get(node.id) ?? [];
  const activeInboundTokens = inboundTokens.filter((token) => !token.skipped);
  const shouldSkip =
    node.type !== "start" &&
    inboundTokens.length > 0 &&
    activeInboundTokens.length === 0;

  const nodeRun = await createFlowNodeRunBestEffort({
    userId: context.repo.user_id,
    jobRunId,
    flowId: resolvedFlow.flowId,
    flowVersionId: resolvedFlow.flowVersionId,
    nodeId: node.id,
    nodeType: node.type,
    nodeLabel: label,
  });

  noteObservabilityError(state, nodeRun.observabilityError);

  const completeNodeRun = async (completion: {
    status: FlowNodeRunStatus;
    output?: Record<string, unknown> | null;
    error?: string | null;
  }): Promise<number> => {
    const result = await completeFlowNodeRunBestEffort({
      nodeRunId: nodeRun.id,
      jobRunId,
      flowId: resolvedFlow.flowId,
      nodeId: node.id,
      status: completion.status,
      startedAt: nodeRun.startedAt,
      output: completion.output,
      error: completion.error,
    });
    noteObservabilityError(state, result.observabilityError);
    return result.durationMs;
  };

  const emitToOutgoingLocal = (
    emitLabel: string,
    text: string,
    skipped = false,
    payload?: Record<string, unknown> | null,
    selector?: (edge: FlowGraph["edges"][number]) => boolean
  ): FlowEmission[] =>
    emitToOutgoing(graph, node.id, emitLabel, text, skipped, payload, selector);

  const completeSkipped = async (
    reason: string
  ): Promise<NodeExecutionResult> => {
    await completeNodeRun({
      status: "skipped",
      output: {
        skipped: true,
        reason,
      },
    });

    return {
      ok: true as const,
      emitted: emitToOutgoingLocal(label, reason, true),
    };
  };

  const routeFailureOrNull = (message: string): NodeExecutionResult | null => {
    const failureEdges = getFailureEdges(graph, node.id);
    if (failureEdges.length === 0) return null;

    const failurePayload = {
      error: message,
      failed_node_id: node.id,
      failed_node_label: label,
      failed_node_type: node.type,
    };

    return {
      ok: true as const,
      emitted: [
        ...emitToOutgoingLocal(
          label,
          message,
          false,
          failurePayload,
          (edge) => edge.sourceHandle === FAILURE_HANDLE_ID
        ),
        ...emitToOutgoingLocal(
          label,
          `Skipped because "${label}" failed and routed to its error handle`,
          true,
          null,
          (edge) => edge.sourceHandle !== FAILURE_HANDLE_ID
        ),
      ],
    };
  };

  const completeFailedNode = async (
    message: string,
    failureContext: JobContext
  ): Promise<NodeExecutionResult> => {
    await completeNodeRun({
      status: "failed",
      error: message,
    });
    return (
      routeFailureOrNull(message) ?? {
        ok: false as const,
        message,
        context: failureContext,
        observabilityError: state.observabilityError,
      }
    );
  };

  const collectPredecessorOutputsLocal = () =>
    collectPredecessorOutputs(state, node.id);

  // Operator-flavored adapters: the operator registry's execute() takes a
  // narrower context than the executor needs end-to-end. These wrappers
  // bridge the registry shape onto the closures that already live here.
  const operatorEmit = (
    emitLabel: string,
    text: string,
    options?: {
      skipped?: boolean;
      payload?: Record<string, unknown> | null;
      selector?: (edge: FlowGraph["edges"][number]) => boolean;
    }
  ): FlowOperatorEmission[] =>
    emitToOutgoingLocal(
      emitLabel,
      text,
      options?.skipped ?? false,
      options?.payload ?? null,
      options?.selector
    );

  const operatorCompleteSkipped = async (
    reason: string
  ): Promise<FlowOperatorExecuteResult> => {
    const skipResult = await completeSkipped(reason);
    // completeSkipped always returns { ok: true, emitted: ... }
    if (!skipResult.ok) {
      // This should never happen, but satisfies TypeScript
      return { ok: false, message: skipResult.message };
    }
    return { ok: true, emitted: skipResult.emitted };
  };

  const runOperator = async (): Promise<NodeExecutionResult> => {
    const operator = getFlowOperator(node.type);
    if (!operator.execute) {
      // Defensive guard: every type in the operator-managed set should ship
      // an execute(); if one is missing it's a programmer error that would
      // silently skip the node, so fail the run loudly instead.
      return {
        ok: false as const,
        message: `Operator "${node.type}" has no execute() registered`,
        context,
        observabilityError: state.observabilityError,
      };
    }

    const operatorContext: FlowOperatorExecuteContext = {
      node,
      label,
      graph,
      inboundTokens: inboundTokens as ReadonlyArray<FlowOperatorEmittedToken>,
      activeInboundTokens:
        activeInboundTokens as ReadonlyArray<FlowOperatorEmittedToken>,
      shouldSkip,
      outputs: state.outputs,
      flowState: state.flowState,
      resolutionState: buildFlowConditionState({
        context,
        inboundTokens,
        outputs: state.outputs,
        flowState: state.flowState,
      }),
      predecessorOutputs: collectPredecessorOutputsLocal,
      emit: operatorEmit,
      completeNodeRun,
      completeSkipped: operatorCompleteSkipped,
      jobRunId,
      flowId: resolvedFlow.flowId,
      flowVersionId: resolvedFlow.flowVersionId,
      userId: context.repo.user_id,
      installationId:
        typeof context.repo.github_installation_id === "number"
          ? context.repo.github_installation_id
          : null,
      repoId: context.repo.id,
      waitProvider: deps.waitProvider,
      waitStore: deps.waitStore,
      actionRunner: ({ jobRunId: runId, nodeId, action }) =>
        deps.runFlowAction({
          jobRunId: runId,
          nodeId,
          action,
          context,
          githubToken,
          loadPullRequestDetails: input.loadPullRequestDetails,
          resolveAutofixTargetRepo: input.resolveAutofixTargetRepo,
        }) as Promise<FlowOperatorActionResult>,
    };

    const result = await operator.execute(operatorContext);
    if (result.ok) {
      return { ok: true as const, emitted: result.emitted };
    }
    const recovered = routeFailureOrNull(result.message);
    if (recovered) return recovered;
    return {
      ok: false as const,
      message: result.message,
      context,
      observabilityError: state.observabilityError,
    };
  };

  return {
    node,
    label,
    inboundTokens,
    activeInboundTokens,
    shouldSkip,
    nodeRun,
    completeNodeRun,
    completeSkipped,
    routeFailureOrNull,
    completeFailedNode,
    runOperator,
    emitToOutgoing: emitToOutgoingLocal,
    collectPredecessorOutputs: collectPredecessorOutputsLocal,
  };
}
