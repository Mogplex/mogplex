/**
 * Flow graph execution engine for automation jobs.
 *
 * Contains the core executeResolvedFlow function that orchestrates node
 * execution, token passing, and result assembly using the extracted
 * flow-run-state, node-execution, agent-node, and condition-node modules.
 */

import type {
  AutomationAgentResult,
  FlowAutoMergeRequest,
  JobContext,
  PullRequestDetails,
  ResolvedFlowDefinition,
} from "@/lib/workflows/automation-job-types";
import {
  JobRunCancelledError,
  JOB_RUN_CANCELLED,
} from "@/lib/workflows/automation-job-types";
import type {
  FlowOperatorWaitProvider,
  FlowOperatorWaitStore,
} from "@/lib/flows/operators/types";

import { getNodeById } from "@/lib/flows/graph";
import { getFlowOperator } from "@/lib/flows/operators/registry";
import {
  mergeAutomationAgentResults,
  resolveAutomationAiCallUsage,
} from "@/lib/workflows/automation-job-metadata";
import { resolvePullRequestNumber } from "@/lib/workflows/automation-job-sandbox-actions";
import { resolveAutomationModel } from "@/lib/workflows/automation-job-model-resolution";
import { isAutomationModelExecutionError } from "@/lib/workflows/automation-model-execution";

import {
  createFlowRunState,
  recordReceivedToken,
  markNodeProcessed,
  isNodeProcessed,
  noteObservabilityError,
} from "@/lib/workflows/automation-job-flow-run-state";
import {
  createNodeExecutionContext,
  type NodeExecutionResult,
} from "@/lib/workflows/automation-job-node-execution";
import {
  executeFlowAgentNode,
  type AgentNodeDeps,
} from "@/lib/workflows/automation-job-agent-node";
import { executeFlowConditionNode } from "@/lib/workflows/automation-job-condition-node";

export type FlowExecutorDeps = {
  resolveAutomationModel: typeof resolveAutomationModel;
  loadPullRequestDetails: (input: {
    repoFullName: string;
    prNumber: number;
    githubToken: string;
    fallbackHeadRef?: string | null;
    fallbackHeadSha?: string | null;
    fallbackHeadRepoFullName?: string | null;
    fallbackBaseRef?: string | null;
    fallbackBaseSha?: string | null;
    fallbackBaseRepoFullName?: string | null;
  }) => Promise<PullRequestDetails | null>;
  resolveAutofixTargetRepo: (input: {
    contextRepo: JobContext["repo"];
    headRepoFullName: string;
  }) => Promise<JobContext["repo"] | null>;
  resolveAutofixGithubToken: (
    targetRepo: JobContext["repo"],
    options: { jobRunId: string }
  ) => Promise<string | null>;
  runAutomationHarnessAgent: (input: {
    jobRunId: string;
    context: JobContext;
    harnessId: unknown;
    review?: unknown;
    pullRequest?: PullRequestDetails | null;
    targetRepo?: JobContext["repo"] | null;
  }) => Promise<AutomationAgentResult>;
  runPRFixAgent: (
    input: {
      context: JobContext;
      review: unknown;
      pullRequest: PullRequestDetails;
      targetRepo: JobContext["repo"];
    },
    githubToken: string,
    resolvedModel: unknown
  ) => Promise<AutomationAgentResult>;
  runPRFixAgentInSandbox: (
    input: {
      context: JobContext;
      review: unknown;
      pullRequest: PullRequestDetails;
      targetRepo: JobContext["repo"];
    },
    githubToken: string,
    resolvedModel: unknown
  ) => Promise<AutomationAgentResult>;
  tryLogAiCall: (input: {
    context: JobContext;
    jobRunId: string;
    status: "success" | "failed";
    startedAt: string;
    durationMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    toolCalls?: unknown;
    error?: string;
    execution: unknown;
  }) => Promise<string | null>;
  isJobRunCancellationRequested: (jobRunId: string) => Promise<boolean>;
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
  executeAutomationContext: (input: {
    jobRunId: string;
    context: JobContext;
    githubToken: string;
    deps: unknown;
    allowAutofix?: boolean;
    autofixSandbox?: boolean;
    allowAutoMerge?: boolean;
  }) => Promise<
    AutomationAgentResult & {
      autoMergeRequest?: { prNumber: number; expectedHeadSha?: string | null };
    }
  >;
};

export type FlowExecutionSuccess = {
  success: true;
  result: AutomationAgentResult;
  autoMergeRequest: FlowAutoMergeRequest | null;
  observabilityError: string | null;
};

export type FlowExecutionFailure = {
  success: false;
  message: string;
  context: JobContext;
  observabilityError: string | null;
  execution?: unknown;
  aiCallTelemetryHandled?: boolean;
};

export type FlowExecutionResult = FlowExecutionSuccess | FlowExecutionFailure;

/**
 * Executes a resolved flow definition, processing nodes in topological order
 * and passing tokens between them.
 */
export async function executeResolvedFlow(input: {
  jobRunId: string;
  context: JobContext;
  githubToken: string;
  resolvedFlow: ResolvedFlowDefinition;
  deps: FlowExecutorDeps;
}): Promise<FlowExecutionResult> {
  const initialHeadSha =
    typeof input.context.metadata.head_sha === "string"
      ? input.context.metadata.head_sha.trim() || null
      : null;

  const state = createFlowRunState({
    graph: input.resolvedFlow.graph,
    initialHeadSha,
  });

  const triggerPrNumber = resolvePullRequestNumber(input.context.metadata);

  const startNode = input.resolvedFlow.graph.nodes.find(
    (node) => node.type === "start"
  );
  if (!startNode) {
    return {
      success: false as const,
      message: "Flow is missing a start node",
      context: input.context,
      observabilityError: state.observabilityError,
    };
  }

  const executeNode = async (nodeId: string): Promise<NodeExecutionResult> => {
    await input.deps.throwIfJobRunCancelled(input.jobRunId);

    const node = getNodeById(input.resolvedFlow.graph, nodeId);
    if (!node) {
      return {
        ok: false as const,
        message: `Missing flow node "${nodeId}"`,
        context: input.context,
        observabilityError: state.observabilityError,
      };
    }

    // Create execution context for this node
    const execCtx = await createNodeExecutionContext(
      {
        jobRunId: input.jobRunId,
        context: input.context,
        githubToken: input.githubToken,
        resolvedFlow: input.resolvedFlow,
        deps: {
          throwIfJobRunCancelled: input.deps.throwIfJobRunCancelled,
          runFlowAction: input.deps.runFlowAction,
          waitProvider: input.deps.waitProvider,
          waitStore: input.deps.waitStore,
        },
        state,
        loadPullRequestDetails: input.deps.loadPullRequestDetails,
        resolveAutofixTargetRepo: input.deps.resolveAutofixTargetRepo,
      },
      node
    );

    let failureContext: JobContext | null = null;

    try {
      switch (node.type) {
        case "start":
        case "parallel":
        case "join":
        case "delay":
        case "await_event":
        case "set_variable":
        case "transform":
        case "end": {
          return await execCtx.runOperator();
        }
        case "action": {
          const actionResult = await execCtx.runOperator();
          // Capture auto-merge requests from merge actions so the job success
          // path can defer the actual merge until after the review check is
          // completed.
          if (
            actionResult.ok &&
            node.data.operation === "github.merge_pull_request"
          ) {
            const payload = actionResult.emitted.find(
              (emission) =>
                emission.token.payload?.auto_merge_requested === true
            )?.token.payload as Record<string, unknown> | undefined;
            const prNumber =
              typeof payload?.pull_request_number === "number" &&
              payload.pull_request_number > 0
                ? payload.pull_request_number
                : null;
            if (prNumber != null) {
              const expectedSha =
                triggerPrNumber === prNumber
                  ? state.expectedTriggerHeadSha
                  : null;
              state.autoMergeRequest = {
                prNumber,
                expectedHeadSha: expectedSha,
                commitTitle:
                  typeof payload?.commit_title === "string"
                    ? payload.commit_title
                    : null,
              };
            }
          }
          return actionResult;
        }
        case "agent": {
          const agentResult = await executeFlowAgentNode({
            jobRunId: input.jobRunId,
            context: input.context,
            githubToken: input.githubToken,
            resolvedFlow: input.resolvedFlow,
            node: node as Parameters<typeof executeFlowAgentNode>[0]["node"],
            execCtx,
            state,
            deps: input.deps as AgentNodeDeps,
            executorDeps: input.deps,
            triggerPrNumber,
          });
          if ("failureContext" in agentResult && agentResult.failureContext) {
            failureContext = agentResult.failureContext;
          }
          return agentResult;
        }
        case "condition": {
          return await executeFlowConditionNode({
            context: input.context,
            resolvedFlow: input.resolvedFlow,
            node: node as Parameters<
              typeof executeFlowConditionNode
            >[0]["node"],
            execCtx,
            state,
          });
        }
      }
    } catch (error) {
      const isCancellation = error instanceof JobRunCancelledError;
      const message =
        error instanceof Error
          ? error.message
          : `Failed to execute node "${execCtx.label}"`;
      const execution = isAutomationModelExecutionError(error)
        ? error.metadata
        : null;
      // Check if the error has a failureContext attached (from agent node errors)
      const errorFailureContext =
        error &&
        typeof error === "object" &&
        "failureContext" in error &&
        error.failureContext
          ? (error.failureContext as JobContext)
          : null;
      const nodeContext =
        failureContext ??
        errorFailureContext ??
        (node.type === "agent"
          ? {
              ...input.context,
              metadata: {
                ...input.context.metadata,
                flow_id: input.resolvedFlow.flowId,
                flow_version_id: input.resolvedFlow.flowVersionId,
                flow_node_id: node.id,
                flow_node_label: execCtx.label,
              },
            }
          : input.context);

      const nodeDurationMs = await execCtx.completeNodeRun({
        status: "failed",
        error: message,
      });

      const loggedUsage = resolveAutomationAiCallUsage({
        inputTokens: null,
        outputTokens: null,
        execution,
      });

      const aiCallObservabilityError = await input.deps.tryLogAiCall({
        context: nodeContext,
        jobRunId: input.jobRunId,
        status: "failed",
        startedAt: execCtx.nodeRun.startedAt,
        durationMs: nodeDurationMs,
        inputTokens: loggedUsage.inputTokens,
        outputTokens: loggedUsage.outputTokens,
        error: message,
        execution,
      });

      noteObservabilityError(state, aiCallObservabilityError);

      // Cancellation is non-recoverable. The outer loop relies on the
      // JOB_RUN_CANCELLED message to terminate the run, so error edges must
      // not catch it.
      if (!isCancellation) {
        const recovered = execCtx.routeFailureOrNull(message);
        if (recovered) return recovered;
      }

      return {
        ok: false as const,
        message,
        context: nodeContext,
        observabilityError: state.observabilityError,
        execution,
        aiCallTelemetryHandled: true as const,
      };
    }
  };

  // Scheduling loop
  let ready = [startNode.id];

  while (ready.length > 0) {
    if (await input.deps.isJobRunCancellationRequested(input.jobRunId)) {
      return {
        success: false as const,
        message: JOB_RUN_CANCELLED,
        context: input.context,
        observabilityError: state.observabilityError,
      };
    }

    const currentBatch = ready.filter(
      (nodeId) => !isNodeProcessed(state, nodeId)
    );
    if (currentBatch.length === 0) {
      break;
    }

    const settled = await Promise.all(
      currentBatch.map((nodeId) => executeNode(nodeId))
    );
    const nextReady = new Set<string>();

    for (const nodeId of currentBatch) {
      markNodeProcessed(state, nodeId);
    }

    if (await input.deps.isJobRunCancellationRequested(input.jobRunId)) {
      return {
        success: false as const,
        message: JOB_RUN_CANCELLED,
        context: input.context,
        observabilityError: state.observabilityError,
      };
    }

    for (const item of settled) {
      if (!item.ok) {
        return {
          success: false as const,
          message: item.message,
          context: item.context,
          observabilityError:
            item.observabilityError ?? state.observabilityError,
          execution: "execution" in item ? item.execution : null,
          aiCallTelemetryHandled:
            "aiCallTelemetryHandled" in item && item.aiCallTelemetryHandled,
        };
      }

      for (const emitted of item.emitted) {
        recordReceivedToken(state, emitted.targetId, emitted.token);

        if (isNodeProcessed(state, emitted.targetId)) continue;

        const targetNode = getNodeById(
          input.resolvedFlow.graph,
          emitted.targetId
        );
        if (!targetNode) continue;

        const targetReceived = state.receivedTokens.get(emitted.targetId) ?? [];
        const targetIncoming = state.incomingCounts.get(emitted.targetId) ?? 0;
        const operator = getFlowOperator(targetNode.type);

        const isReady = operator.isReady
          ? operator.isReady({
              node: targetNode,
              incomingCount: targetIncoming,
              receivedTokens: targetReceived,
            })
          : targetReceived.length === targetIncoming;

        if (isReady) {
          nextReady.add(emitted.targetId);
        }
      }
    }

    ready = Array.from(nextReady);
  }

  // End node check
  const endNode = input.resolvedFlow.graph.nodes.find(
    (node) => node.type === "end"
  );
  if (endNode && !isNodeProcessed(state, endNode.id)) {
    return {
      success: false as const,
      message: "Flow execution ended before reaching the end node",
      context: input.context,
      observabilityError: state.observabilityError,
    };
  }

  return {
    success: true as const,
    result: mergeAutomationAgentResults(
      state.results as AutomationAgentResult[]
    ),
    autoMergeRequest: state.autoMergeRequest,
    observabilityError: state.observabilityError,
  };
}
