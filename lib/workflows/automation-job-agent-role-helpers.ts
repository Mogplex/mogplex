/**
 * Agent role-specific execution helpers for flow agent nodes.
 *
 * Contains the edit-role and harness node execution logic extracted from
 * the main agent node executor.
 */

import type { HarnessId } from "@/lib/harness/config";
import type { FlowAgentNodeData } from "@/lib/types";
import type {
  AutomationAgentResult,
  JobContext,
  PullRequestDetails,
  ResolvedFlowDefinition,
} from "@/lib/workflows/automation-job-types";
import type { GatewayCallContext } from "@/lib/models/gateway-provider-routing";
import type { FlowRunState } from "@/lib/workflows/automation-job-flow-run-state";
import type {
  NodeExecutionContext,
  NodeExecutionResult,
} from "@/lib/workflows/automation-job-node-execution";

import {
  getStartConfig,
  hasUpstreamAgentRole,
  isCommentTriggerEvent,
} from "@/lib/flows/graph";
import {
  extractFlowReviewOutcome,
  synthesizeReviewOutcomeFromComment,
} from "@/lib/workflows/automation-job-review-outcome";
import {
  normalizeAutomationAssignmentType,
  readAutomationTeamId,
} from "@/lib/workflows/automation-job-utils";
import { resolvePullRequestNumber } from "@/lib/workflows/automation-job-sandbox-actions";
import { buildAutomationGatewayContext } from "@/lib/workflows/automation-job-agent-runners";
import { asAutomationModelExecutionError } from "@/lib/workflows/automation-model-execution";
import { resolveAutomationModel } from "@/lib/workflows/automation-job-model-resolution";

type FlowAgentNode = {
  id: string;
  type: "agent";
  position: { x: number; y: number };
  data: FlowAgentNodeData;
};

export type AgentRoleDeps = {
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
};

export type EditRoleInput = {
  jobRunId: string;
  resolvedFlow: ResolvedFlowDefinition;
  node: FlowAgentNode;
  execCtx: NodeExecutionContext;
  state: FlowRunState;
  deps: AgentRoleDeps;
};

async function resolveAutomationModelForPhase(input: {
  deps: AgentRoleDeps;
  userId: string;
  modelId: string;
  phase: string;
  timeoutMs?: number | null;
  gatewayContext?: GatewayCallContext;
  teamId?: string | null;
  fallbackModelId?: string | null;
}) {
  try {
    return await input.deps.resolveAutomationModel(
      input.userId,
      input.modelId,
      input.timeoutMs,
      input.gatewayContext,
      input.teamId ?? null,
      input.fallbackModelId ?? null
    );
  } catch (error) {
    throw asAutomationModelExecutionError({
      error,
      phase: input.phase,
      timeoutMs: input.timeoutMs,
    });
  }
}

/**
 * Executes an edit-role agent node.
 */
export async function executeEditRoleNode(params: {
  input: EditRoleInput;
  nodeContext: JobContext;
  harnessId: HarnessId | null;
  loadNodePullRequest: (prNumber: number) => Promise<PullRequestDetails | null>;
  label: string;
  completeSkipped: (reason: string) => Promise<NodeExecutionResult>;
  completeNodeRun: (completion: {
    status: "failed";
    error: string;
  }) => Promise<number>;
  routeFailureOrNull: (message: string) => NodeExecutionResult | null;
}): Promise<
  { result: AutomationAgentResult } | { earlyReturn: NodeExecutionResult }
> {
  const {
    input,
    nodeContext,
    harnessId,
    loadNodePullRequest,
    label,
    completeSkipped,
    completeNodeRun,
    routeFailureOrNull,
  } = params;
  const { node, resolvedFlow, deps, state, jobRunId } = input;
  const { inboundTokens } = input.execCtx;

  const startEvent = getStartConfig(resolvedFlow.graph)?.event ?? null;
  const commentTriggered = isCommentTriggerEvent(startEvent);
  const hasReviewUpstream = hasUpstreamAgentRole(
    resolvedFlow.graph,
    node.id,
    "review"
  );

  if (!hasReviewUpstream && !commentTriggered) {
    const message = `Fix node "${label}" must be placed after a Review node, or its flow must start from a pull request comment trigger (@mogplex mention or PR comment).`;
    await completeNodeRun({ status: "failed", error: message });
    const recovered = routeFailureOrNull(message);
    if (recovered) return { earlyReturn: recovered };
    return {
      earlyReturn: {
        ok: false as const,
        message,
        context: nodeContext,
        observabilityError: state.observabilityError,
      },
    };
  }

  // For comment-triggered flows, fall back to the trigger comment body
  // when no upstream Review-role node has produced findings.
  const review =
    extractFlowReviewOutcome(inboundTokens) ??
    (commentTriggered
      ? synthesizeReviewOutcomeFromComment(nodeContext.metadata)
      : null);

  if (!review) {
    return {
      earlyReturn: await completeSkipped(
        "Edit node skipped because no upstream review output was available"
      ),
    };
  }
  if (!review.hasIssues) {
    return {
      earlyReturn: await completeSkipped(
        "Edit node skipped because upstream reviewers reported no issues"
      ),
    };
  }

  const assignmentType = normalizeAutomationAssignmentType(
    nodeContext.assignmentType
  );
  const assignmentSupportsEdit =
    assignmentType === "pr_review" ||
    assignmentType === "mention" ||
    assignmentType === "pr_comment" ||
    // Label-triggered flows support edit nodes when the label landed
    // on a PR; the pr-number guard below rejects issue labels the
    // same way it rejects issue-comment mentions.
    assignmentType === "labeled";

  if (!assignmentSupportsEdit) {
    return {
      earlyReturn: await completeSkipped(
        "Edit node skipped because editor nodes currently support pull request, PR comment, @mogplex mention, and label triggers only"
      ),
    };
  }

  const prNumber = resolvePullRequestNumber(nodeContext.metadata);
  if (prNumber == null) {
    const message = `Edit node "${label}" is missing pull request context`;
    await completeNodeRun({ status: "failed", error: message });
    const recovered = routeFailureOrNull(message);
    if (recovered) return { earlyReturn: recovered };
    return {
      earlyReturn: {
        ok: false as const,
        message,
        context: nodeContext,
        observabilityError: state.observabilityError,
      },
    };
  }

  const pullRequest = await loadNodePullRequest(prNumber);
  if (!pullRequest) {
    const message = `Edit node "${label}" could not load pull request details`;
    await completeNodeRun({ status: "failed", error: message });
    const recovered = routeFailureOrNull(message);
    if (recovered) return { earlyReturn: recovered };
    return {
      earlyReturn: {
        ok: false as const,
        message,
        context: nodeContext,
        observabilityError: state.observabilityError,
      },
    };
  }

  const targetRepo = await deps.resolveAutofixTargetRepo({
    contextRepo: nodeContext.repo,
    headRepoFullName: pullRequest.headRepoFullName,
  });
  if (!targetRepo) {
    return {
      earlyReturn: await completeSkipped(
        "Edit node skipped because the PR head repository is unavailable"
      ),
    };
  }

  const fixContext = {
    ...nodeContext,
    metadata: {
      ...nodeContext.metadata,
      flow_review_summary: review.summary,
      flow_review_comment_body: review.commentBody,
      flow_review_affected_files: review.affectedFiles,
    },
  };

  let result: AutomationAgentResult;

  if (harnessId) {
    result = await deps.runAutomationHarnessAgent({
      jobRunId,
      context: fixContext,
      harnessId,
      review,
      pullRequest,
      targetRepo,
    });
  } else {
    const autofixGithubToken = await deps.resolveAutofixGithubToken(
      targetRepo,
      { jobRunId }
    );
    if (!autofixGithubToken) {
      return {
        earlyReturn: await completeSkipped(
          "Edit node skipped because no GitHub App autofix token was available for the PR head repository"
        ),
      };
    }

    const resolvedModel = await resolveAutomationModelForPhase({
      deps,
      userId: nodeContext.repo.user_id,
      modelId: nodeContext.agent.model,
      phase: "pr_fix:model_resolution",
      timeoutMs: nodeContext.agent.timeout_ms,
      gatewayContext: buildAutomationGatewayContext(nodeContext, "pr_fix"),
      teamId: readAutomationTeamId(nodeContext.metadata),
      fallbackModelId: nodeContext.agent.fallback_model,
    });

    const runFixAgent =
      node.data.autofixSandbox === true
        ? deps.runPRFixAgentInSandbox
        : deps.runPRFixAgent;

    result = await runFixAgent(
      { context: fixContext, review, pullRequest, targetRepo },
      autofixGithubToken,
      resolvedModel
    );
  }

  return { result };
}

/**
 * Executes a harness-based agent node.
 */
export async function executeHarnessNode(params: {
  jobRunId: string;
  nodeContext: JobContext;
  harnessId: HarnessId;
  loadNodePullRequest: (prNumber: number) => Promise<PullRequestDetails | null>;
  label: string;
  completeFailedNode: (
    message: string,
    context: JobContext
  ) => Promise<NodeExecutionResult>;
  deps: AgentRoleDeps;
}): Promise<
  { result: AutomationAgentResult } | { earlyReturn: NodeExecutionResult }
> {
  const {
    nodeContext,
    harnessId,
    loadNodePullRequest,
    label,
    completeFailedNode,
    deps,
    jobRunId,
  } = params;

  let pullRequest: PullRequestDetails | null = null;
  let targetRepo: JobContext["repo"] | null = null;
  const prNumber = resolvePullRequestNumber(nodeContext.metadata);
  const requiresPullRequest =
    normalizeAutomationAssignmentType(nodeContext.assignmentType) ===
      "pr_review" || prNumber != null;

  if (requiresPullRequest) {
    if (prNumber == null) {
      return {
        earlyReturn: await completeFailedNode(
          `Harness node "${label}" is missing pull request context`,
          nodeContext
        ),
      };
    }

    pullRequest = await loadNodePullRequest(prNumber);
    if (!pullRequest) {
      return {
        earlyReturn: await completeFailedNode(
          `Harness node "${label}" could not load pull request details`,
          nodeContext
        ),
      };
    }

    targetRepo = await deps.resolveAutofixTargetRepo({
      contextRepo: nodeContext.repo,
      headRepoFullName: pullRequest.headRepoFullName,
    });
    if (!targetRepo) {
      return {
        earlyReturn: await completeFailedNode(
          `Harness node "${label}" could not resolve the pull request head repository`,
          nodeContext
        ),
      };
    }
  }

  const result = await deps.runAutomationHarnessAgent({
    jobRunId,
    context: nodeContext,
    harnessId,
    pullRequest,
    targetRepo,
  });

  return { result };
}
