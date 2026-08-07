/**
 * Agent node execution for executeResolvedFlow.
 *
 * Handles the inline `case "agent"` body as an exported function taking an
 * explicit input object. The agent node is the most complex node type,
 * supporting review, edit, and harness modes.
 */

import type { HarnessId } from "@/lib/harness/config";
import type { FlowAgentNodeData } from "@/lib/types";
import type {
  AutomationAgentResult,
  FlowAutoMergeRequest,
  JobContext,
  PullRequestDetails,
  ResolvedFlowDefinition,
} from "@/lib/workflows/automation-job-types";
import type { FlowRunState } from "@/lib/workflows/automation-job-flow-run-state";
import type {
  NodeExecutionContext,
  NodeExecutionResult,
} from "@/lib/workflows/automation-job-node-execution";

import { summarizeNodeOutput } from "@/lib/flows/graph";
import { resolveFlowAgentNodeRole } from "@/lib/workflows/automation-job-review-outcome";
import { extractPrReviewHarnessResult } from "@/lib/workflows/pr-review-harness";
import { resolvePullRequestNumber } from "@/lib/workflows/automation-job-sandbox-actions";
import { resolveFlowAgentOverrides } from "@/lib/workflows/automation-job-context-resolution";
import { extractToolCalls } from "@/lib/workflows/automation-job-metadata";
import {
  hydrateFlowPullRequestHeadContext,
  resolveAutoMergeExpectedHeadSha,
} from "@/lib/workflows/automation-job-auto-merge";
import { resolveAutomationModel } from "@/lib/workflows/automation-job-model-resolution";
import {
  emitToOutgoing,
  noteObservabilityError,
} from "@/lib/workflows/automation-job-flow-run-state";
import {
  executeEditRoleNode,
  executeHarnessNode,
  type AgentRoleDeps,
} from "@/lib/workflows/automation-job-agent-role-helpers";

type FlowAgentNode = {
  id: string;
  type: "agent";
  position: { x: number; y: number };
  data: FlowAgentNodeData;
};

export type AgentNodeDeps = {
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
  resolveAutomationModel: typeof resolveAutomationModel;
  runAutomationHarnessAgent: (input: {
    jobRunId: string;
    context: JobContext;
    harnessId: HarnessId;
    review?: {
      summary: string;
      commentBody: string | null;
      hasIssues: boolean;
      affectedFiles: string[] | null;
    } | null;
    pullRequest: PullRequestDetails | null;
    targetRepo: JobContext["repo"] | null;
  }) => Promise<AutomationAgentResult>;
  runPRFixAgent: (
    input: {
      context: JobContext;
      review: {
        summary: string;
        commentBody: string | null;
        hasIssues: boolean;
        affectedFiles: string[] | null;
      };
      pullRequest: PullRequestDetails;
      targetRepo: JobContext["repo"];
    },
    githubToken: string,
    resolvedModel: unknown
  ) => Promise<AutomationAgentResult>;
  runPRFixAgentInSandbox: (
    input: {
      context: JobContext;
      review: {
        summary: string;
        commentBody: string | null;
        hasIssues: boolean;
        affectedFiles: string[] | null;
      };
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
    execution: unknown;
  }) => Promise<string | null>;
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

export type AgentNodeInput = {
  jobRunId: string;
  context: JobContext;
  githubToken: string;
  resolvedFlow: ResolvedFlowDefinition;
  node: FlowAgentNode;
  execCtx: NodeExecutionContext;
  state: FlowRunState;
  deps: AgentNodeDeps;
  executorDeps: unknown; // The full deps object for executeAutomationContext
  triggerPrNumber: number | null;
};

/**
 * Executes an agent node within a flow.
 */
export async function executeFlowAgentNode(
  input: AgentNodeInput
): Promise<NodeExecutionResult & { failureContext?: JobContext }> {
  const {
    node,
    execCtx,
    state,
    resolvedFlow,
    deps,
    context,
    jobRunId,
    githubToken,
    triggerPrNumber,
  } = input;
  const {
    label,
    shouldSkip,
    completeSkipped,
    routeFailureOrNull,
    completeNodeRun,
    completeFailedNode,
    collectPredecessorOutputs,
  } = execCtx;

  if (shouldSkip) {
    return completeSkipped("Skipped because every incoming branch was skipped");
  }

  const agentId =
    typeof node.data.agentId === "string" ? node.data.agentId : null;
  const baseAgent = agentId ? resolvedFlow.agentsById.get(agentId) : null;
  const nodeHarness = node.data.harness ?? "mogplex";
  const harnessId: HarnessId | null =
    nodeHarness === "claude-code" || nodeHarness === "codex"
      ? nodeHarness
      : null;
  const nodeRole = resolveFlowAgentNodeRole(node);

  // Harness nodes run an external CLI that picks its own model, so a
  // model selection is meaningless for them and the editor hides it.
  // Every other agent node must carry one: the node is the only source
  // of truth, so "no model" is a config error, not a fallback.
  const nodeModelId = harnessId
    ? null
    : node.data.modelOverride?.trim() || null;

  if (!harnessId && !nodeModelId) {
    const message = `No model selected for node "${label}". Open the automation and choose a model for this step.`;
    await completeNodeRun({ status: "failed", error: message });
    const recovered = routeFailureOrNull(message);
    if (recovered) return recovered;
    return {
      ok: false as const,
      message,
      context,
      observabilityError: state.observabilityError,
    };
  }

  if (!baseAgent && !harnessId) {
    const message = `Missing agent for node "${label}"`;
    await completeNodeRun({ status: "failed", error: message });
    const recovered = routeFailureOrNull(message);
    if (recovered) return recovered;
    return {
      ok: false as const,
      message,
      context,
      observabilityError: state.observabilityError,
    };
  }

  const predecessorOutputs = collectPredecessorOutputs();
  const nodeContext: JobContext = {
    ...context,
    agent: harnessId
      ? {
          name: label,
          slug: harnessId,
          model: `harness:${harnessId}`,
          system_prompt: node.data.systemPromptOverride ?? null,
          max_steps: null,
          timeout_ms: null,
        }
      : resolveFlowAgentOverrides(baseAgent!, node, nodeModelId!),
    metadata: {
      ...context.metadata,
      flow_id: resolvedFlow.flowId,
      flow_version_id: resolvedFlow.flowVersionId,
      flow_node_id: node.id,
      flow_node_label: label,
      flow_node_role: nodeRole,
      flow_node_harness: nodeHarness,
      ...(node.data.autoRevert === true ? { flow_auto_revert: true } : {}),
      // The agent runner needs the job run id to persist approval
      // waits; it is only stamped when the node opted into gating.
      ...(node.data.requireApproval === true
        ? { flow_require_approval: true, flow_job_run_id: jobRunId }
        : {}),
      flow_previous_outputs: predecessorOutputs.map((entry) => ({
        label: entry.label,
        output: entry.text,
      })),
    },
  };

  const loadNodePullRequest = (prNumber: number) =>
    deps.loadPullRequestDetails({
      repoFullName: nodeContext.repo.full_name,
      prNumber,
      githubToken,
      fallbackHeadRef:
        typeof nodeContext.metadata.head_ref === "string"
          ? nodeContext.metadata.head_ref
          : null,
      fallbackHeadSha:
        typeof nodeContext.metadata.head_sha === "string"
          ? nodeContext.metadata.head_sha
          : null,
      fallbackHeadRepoFullName:
        typeof nodeContext.metadata.head_repo_full_name === "string"
          ? nodeContext.metadata.head_repo_full_name
          : null,
      fallbackBaseRef:
        typeof nodeContext.metadata.base_ref === "string"
          ? nodeContext.metadata.base_ref
          : (nodeContext.repo.default_branch ?? null),
      fallbackBaseSha:
        typeof nodeContext.metadata.base_sha === "string"
          ? nodeContext.metadata.base_sha
          : null,
      fallbackBaseRepoFullName:
        typeof nodeContext.metadata.base_repo_full_name === "string"
          ? nodeContext.metadata.base_repo_full_name
          : nodeContext.repo.full_name,
    });

  let result: AutomationAgentResult;

  // Helper for expectedHeadSha calculation
  const expectedHeadShaFor = (prNumber: number) =>
    triggerPrNumber === prNumber ? state.expectedTriggerHeadSha : null;

  if (nodeRole === "edit") {
    const editResult = await executeEditRoleNode({
      input: {
        jobRunId,
        resolvedFlow,
        node,
        execCtx,
        state,
        deps: deps as AgentRoleDeps,
      },
      nodeContext,
      harnessId,
      loadNodePullRequest,
      label,
      completeSkipped,
      completeNodeRun,
      routeFailureOrNull,
    });
    if ("earlyReturn" in editResult) {
      return { ...editResult.earlyReturn, failureContext: nodeContext };
    }
    result = editResult.result;

    // Update expected head SHA after edit
    const refreshedContext = await hydrateFlowPullRequestHeadContext({
      context,
      githubToken,
      loadPullRequestDetails: deps.loadPullRequestDetails,
      refresh: true,
    });
    const prNumber = resolvePullRequestNumber(refreshedContext.metadata);
    state.expectedTriggerHeadSha =
      prNumber == null
        ? null
        : resolveAutoMergeExpectedHeadSha(refreshedContext.metadata, prNumber);
  } else if (harnessId) {
    const harnessResult = await executeHarnessNode({
      jobRunId,
      nodeContext,
      harnessId,
      loadNodePullRequest,
      label,
      completeFailedNode,
      deps: deps as AgentRoleDeps,
    });
    if ("earlyReturn" in harnessResult) {
      return { ...harnessResult.earlyReturn, failureContext: nodeContext };
    }
    result = harnessResult.result;
  } else {
    try {
      result = await deps.executeAutomationContext({
        jobRunId,
        context: nodeContext,
        githubToken,
        deps: input.executorDeps,
        allowAutofix: nodeRole === "review" && node.data.autofix === true,
        autofixSandbox:
          nodeRole === "review" &&
          node.data.autofix === true &&
          node.data.autofixSandbox === true,
        allowAutoMerge: nodeRole === "review" && node.data.autoMerge === true,
      });
    } catch (error) {
      // Re-throw with failureContext so the flow executor can log with the correct model
      throw Object.assign(error as Error, { failureContext: nodeContext });
    }
  }

  // Process result
  const toolCalls = extractToolCalls(result);
  const inputTokens = result.usage?.inputTokens ?? null;
  const outputTokens = result.usage?.outputTokens ?? null;
  const reviewOutcome =
    nodeRole === "review"
      ? extractPrReviewHarnessResult(result).reviewOutcome
      : null;

  let nodeAutoMergeRequest =
    (result as { autoMergeRequest?: FlowAutoMergeRequest }).autoMergeRequest ??
    null;

  if (
    !nodeAutoMergeRequest &&
    harnessId &&
    nodeRole === "review" &&
    node.data.autoMerge === true &&
    reviewOutcome?.hasIssues === false
  ) {
    const prNumber = resolvePullRequestNumber(nodeContext.metadata);
    if (prNumber != null) {
      nodeAutoMergeRequest = {
        prNumber,
        expectedHeadSha: expectedHeadShaFor(prNumber),
      };
    }
  }

  if (nodeAutoMergeRequest) {
    state.autoMergeRequest = {
      ...nodeAutoMergeRequest,
      expectedHeadSha: expectedHeadShaFor(nodeAutoMergeRequest.prNumber),
    };
  }

  const nodeDurationMs = await completeNodeRun({
    status: "success",
    output: {
      role: nodeRole,
      harness: nodeHarness,
      text: summarizeNodeOutput(result.text),
      review: reviewOutcome,
      tool_calls: toolCalls,
      // The merge itself runs after the review check run is
      // completed; the outcome lands on the dispatch event.
      ...(nodeAutoMergeRequest ? { auto_merge_requested: true } : {}),
    },
  });

  if (!result.aiCallId) {
    noteObservabilityError(
      state,
      await deps.tryLogAiCall({
        context: nodeContext,
        jobRunId,
        status: "success",
        startedAt: execCtx.nodeRun.startedAt,
        durationMs: nodeDurationMs,
        inputTokens,
        outputTokens,
        toolCalls,
        execution: result.execution ?? null,
      })
    );
  }

  const summary = summarizeNodeOutput(result.text);
  state.outputs.set(node.id, { label, text: summary });
  state.results.push(result);

  return {
    ok: true as const,
    emitted: emitToOutgoing(
      resolvedFlow.graph,
      node.id,
      label,
      summary,
      false,
      {
        role: nodeRole,
        review: reviewOutcome,
      }
    ),
    failureContext: nodeContext,
  };
}
