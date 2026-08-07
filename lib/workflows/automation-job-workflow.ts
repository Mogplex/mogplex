import { generateText, type ToolSet } from "ai";
import {
  mergePullRequestIfSafe,
  type AutoMergeOutcome,
} from "@/lib/github-merge";
import {
  clearPrReviewTimelineComment,
  completePrReviewCheckRun,
  createPrReviewGithubReview,
  createPrReviewCheckRun,
  upsertPrReviewTimelineComment,
} from "@/lib/github-check-runs";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { HarnessId } from "@/lib/harness/config";
import {
  supabaseWaitStore,
  triggerWaitProvider,
} from "@/lib/flows/wait-service";
import { getFlowOperator } from "@/lib/flows/operators/registry";
import type {
  FlowOperatorEmission,
  FlowOperatorEmittedToken,
  FlowOperatorExecuteContext,
  FlowOperatorExecuteResult,
  FlowOperatorWaitProvider,
  FlowOperatorWaitStore,
} from "@/lib/flows/operators/types";
import {
  AUTOMATION_REASON_CODES,
  PR_REVIEW_REASON_CODES,
  classifyAutomationFailureReason,
  formatAutomationReasonLabel,
  isPrReviewSourceType,
} from "@/lib/automation-review";
import { resolveUserLanguageModel } from "@/lib/ai-model-resolver";
import type { GatewayCallContext } from "@/lib/models/gateway-provider-routing";
import { resolveRuntimeModelId } from "@/lib/models/supersession-runtime";
import {
  loadTeamAllowlistState,
  type TeamAllowlistState,
} from "@/lib/team-capabilities";

import {
  coerceGraph,
  evaluateConditionNode,
  FAILURE_HANDLE_ID,
  hasUpstreamAgentRole,
  isCommentTriggerEvent,
  isFlowAgentNodeRole,
  getFailureEdges,
  getNodeById,
  getOutgoingEdges,
  getStartConfig,
  summarizeNodeOutput,
} from "@/lib/flows/graph";

import {
  buildPrReviewCheckText,
  buildPrReviewCheckSummary,
  buildPrReviewCheckTitle,
  buildPrReviewGithubReviewBody,
  buildPrReviewInlineComments,
  buildPrReviewTimelineCommentBody,
  extractPrReviewHarnessResult,
  shouldRetryPrReviewWithoutInlineComments,
  type PrReviewConclusion,
  type PrReviewFailureDetails,
  type PrReviewHarnessResult,
  type ReviewOutcome,
} from "@/lib/workflows/pr-review-harness";
import { classifyAutomationInfrastructureFailure } from "@/lib/workflows/automation-infra-failures";
import {
  asAutomationModelExecutionError,
  buildAutomationProviderFetch,
  executeAutomationTextGeneration,
  isAutomationModelExecutionError,
  type AutomationModelExecutionMetadata,
} from "@/lib/workflows/automation-model-execution";
import {
  AUTOMATION_GATEWAY_FALLBACK_MODELS_ENV,
  getAutomationGenerateTimeoutMs,
  getAutomationModelFallbackIds,
} from "@/lib/workflows/automation-model-defaults";
import type { FlowAgentNodeRole, FlowGraph, FlowNode } from "@/lib/types";
import {
  AUTOMATION_GATEWAY_CACHING_ENV,
  GITHUB_PR_ACCESS_FAILURE_PREFIX,
  INVALID_PR_REVIEW_CONTEXT,
  JOB_RUN_CANCELLED,
  JobRunCancelledError,
  type AutofixSandboxRecord,
  type AutomationAgentResult,
  type AutomationJobInput,
  type AutomationJobRunResult,
  type AutomationLanguageModel,
  type FlowAgentConfig,
  type FlowAutoMergeRequest,
  type FlowExecutionToken,
  type FlowNodeRunStatus,
  type JobContext,
  type JobRunRuntimeDetails,
  type PullRequestDetails,
  type ReleasedAutomationScope,
  type ResolvedFlowDefinition,
  type ResolvedJobContext,
} from "@/lib/workflows/automation-job-types";
import {
  coercePositivePrNumber,
  formatAutomationStateScopeLabel,
  formatAutomationTimeoutScopeLabel,
  formatFailureDurationLabel,
  hasToolCall,
  isRecord,
  normalizeAutomationAssignmentType,
  readAutomationTeamId,
  readTextResponse,
  splitRepoFullName,
  toOptionalString,
  toReviewFindings,
  toStringArray,
} from "@/lib/workflows/automation-job-utils";
import {
  buildAutomationExecutionMetadataFields,
  buildAutomationJobModelFailureDiagnostics,
  buildAutomationRuntimeMetadataFields,
  extractToolCalls,
  mergeAutomationAgentResults,
  normalizeAutomationAgentResult,
  resolveAutomationAiCallUsage,
  resolveJobRunRuntimeDetails,
} from "@/lib/workflows/automation-job-metadata";
import {
  buildAutomationHarnessPrompt,
  buildPromptForJob,
  buildPromptForPRFix,
  parseAutomationHarnessReviewResult,
  stripAutomationHarnessReviewMarker,
} from "@/lib/workflows/automation-job-prompts";
import {
  assertPullRequestGithubAccess,
  loadPullRequestDetails,
  resolveAutofixGithubToken,
  resolveAutofixTargetRepo,
  resolveGithubToken,
} from "@/lib/workflows/automation-job-github";
import {
  buildDispatchLogContext,
  recordControlDispatchEvent,
} from "@/lib/workflows/automation-job-dispatch";
import {
  completeFlowNodeRunBestEffort,
  createFlowNodeRunBestEffort,
  isJobRunCancellationRequested,
  throwIfJobRunCancelled,
} from "@/lib/workflows/automation-job-flow-nodes";
import {
  getDurationMs,
  persistAutomationOutcomeMemory,
  persistJobFailure,
  persistJobReviewFindings,
  persistJobSuccess,
  releaseQueuedJobs as releaseQueuedJobsBase,
  tryLogAiCall,
} from "@/lib/workflows/automation-job-persistence";
import {
  buildAutofixSandboxInternalApiHeaders,
  launchAutofixSandbox,
  launchAutomationHarnessSandbox,
} from "@/lib/workflows/automation-job-sandbox-setup";
import {
  resolvePullRequestNumber,
  runFlowAction,
} from "@/lib/workflows/automation-job-sandbox-actions";
import { startAutomationJobRun } from "@/lib/workflows/automation-job-start";
import {
  buildAutomationGatewayContext,
  buildAutomationSystem,
  createAutomationAgentRunner,
  createPRFixAgentRunner,
  createSandboxPRFixAgentRunner,
  fallbackAutomationModel,
  type AutomationAgentDeps,
} from "@/lib/workflows/automation-job-agent-runners";
import { runAutomationHarnessAgent } from "@/lib/workflows/automation-job-harness";

// Re-export types from automation-job-types for external consumers
export {
  AUTOMATION_JOB_TRIGGER_MAX_ATTEMPTS,
  JOB_RUN_CANCELLED,
  JobRunCancelledError,
  type AutomationJobInput,
  type AutomationJobModelFailureDiagnostics,
  type AutomationJobRunResult,
  type ReleasedAutomationScope,
} from "@/lib/workflows/automation-job-types";

// Re-export functions from modules for external consumers
export { resolveAutomationAiCallModel } from "@/lib/workflows/automation-job-metadata";
export {
  buildAutomationHarnessPrompt,
  parseAutomationHarnessReviewResult,
} from "@/lib/workflows/automation-job-prompts";
export { buildAutofixSandboxInternalApiHeaders } from "@/lib/workflows/automation-job-sandbox-setup";
export {
  resolvePullRequestNumber,
  resolveSlackTriggerDestination,
  runFlowAction,
} from "@/lib/workflows/automation-job-sandbox-actions";
export {
  serializeAutomationJobStart,
  startAutomationJobRun,
} from "@/lib/workflows/automation-job-start";
export {
  buildAutomationGatewayContext,
  createAutomationAgentRunner,
  createPRFixAgentRunner,
  createSandboxPRFixAgentRunner,
} from "@/lib/workflows/automation-job-agent-runners";

function buildAutomationFailureDisplayMessage(input: {
  message: string;
  assignmentType: string;
  execution?: AutomationModelExecutionMetadata | null;
  runtime?: JobRunRuntimeDetails | null;
}) {
  const infraFailure = classifyAutomationInfrastructureFailure(input.message);
  if (infraFailure?.failureClass === "supabase_unavailable") {
    const subject = formatAutomationStateScopeLabel(input.assignmentType);
    return `Supabase was unavailable while recording ${subject} workflow state.`;
  }

  if (infraFailure?.failureClass === "html_error_page") {
    return infraFailure.sanitizedText;
  }

  if (input.execution?.finalFailureClass !== "timeout") {
    return input.message;
  }

  const timeoutBudget =
    typeof input.execution.effectiveTimeoutMs === "number" &&
    Number.isFinite(input.execution.effectiveTimeoutMs) &&
    input.execution.effectiveTimeoutMs > 0
      ? formatFailureDurationLabel(input.execution.effectiveTimeoutMs)
      : null;
  const subject = formatAutomationTimeoutScopeLabel(input.assignmentType);
  return timeoutBudget
    ? `AI provider timed out during ${subject} after ${timeoutBudget}.`
    : `AI provider timed out during ${subject}.`;
}

function buildPrReviewFailureDetails(input: {
  reason: string | null;
  message: string;
  rawMessage?: string | null;
  execution?: AutomationModelExecutionMetadata | null;
  runtime?: JobRunRuntimeDetails | null;
}): PrReviewFailureDetails | null {
  const infraFailure = classifyAutomationInfrastructureFailure(
    input.rawMessage ?? input.message
  );
  const details: PrReviewFailureDetails = {
    reasonLabel: input.reason
      ? formatAutomationReasonLabel(input.reason)
      : null,
    error: input.message,
    infraFailureClass: infraFailure?.failureClass ?? null,
    infraFailureMessage: infraFailure?.detail ?? null,
    modelFailureClass: input.execution?.finalFailureClass ?? null,
    modelFailureMessage: input.execution?.finalFailureMessage ?? null,
    modelFailureStatusCode: input.execution?.finalFailureStatusCode ?? null,
    modelEffectiveTimeoutMs: input.execution?.effectiveTimeoutMs ?? null,
    modelAttempts: input.execution?.attempts ?? null,
    modelRetryAttempted: input.execution?.retried ?? null,
    modelRetryCount: input.execution?.retryCount ?? null,
    runtimeProvider: input.runtime?.provider ?? null,
    runtimeRunId: input.runtime?.runId ?? null,
  };

  return Object.values(details).some((value) => value != null) ? details : null;
}

function classifyPrReviewFailureReason(
  message: string,
  execution?: AutomationModelExecutionMetadata | null
) {
  if (message === "NO_GITHUB_CONNECTION") {
    return PR_REVIEW_REASON_CODES.githubAuthFailed;
  }

  if (classifyAutomationInfrastructureFailure(message)) {
    return PR_REVIEW_REASON_CODES.infraFailed;
  }

  if (
    execution?.finalFailureClass === "timeout" ||
    execution?.finalFailureClass === "rate_limited" ||
    execution?.finalFailureClass === "provider_unavailable" ||
    execution?.finalFailureClass === "dependency_unavailable" ||
    execution?.finalFailureClass === "authentication" ||
    execution?.finalFailureClass === "configuration"
  ) {
    return PR_REVIEW_REASON_CODES.infraFailed;
  }

  if (message.startsWith("GitHub check run")) {
    return PR_REVIEW_REASON_CODES.checkRunFailed;
  }

  if (message.startsWith("GitHub timeline comment")) {
    return PR_REVIEW_REASON_CODES.timelineCommentFailed;
  }

  if (message.startsWith("GitHub comment post failed")) {
    return PR_REVIEW_REASON_CODES.commentPostFailed;
  }

  if (message.startsWith(GITHUB_PR_ACCESS_FAILURE_PREFIX)) {
    return PR_REVIEW_REASON_CODES.githubAuthFailed;
  }

  return null;
}

function buildPrReviewCheckDetailsUrl() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl) return null;

  return `${appUrl.replace(/\/+$/, "")}/observability`;
}

export function resolveFlowAgentNodeRole(
  node: Extract<FlowNode, { type: "agent" }>
): FlowAgentNodeRole {
  return isFlowAgentNodeRole(node.data.role) ? node.data.role : "review";
}

export function synthesizeReviewOutcomeFromComment(
  metadata: Record<string, unknown>
): ReviewOutcome | null {
  const body = toOptionalString(metadata.comment_body)?.trim();
  if (!body) return null;

  // The comment body IS the user-supplied "finding" for comment-triggered fix
  // flows. Materialize it as a single-summary ReviewOutcome so the downstream
  // PR fix harness sees the same shape it would from an in-flow Review node.
  return {
    hasIssues: true,
    summary: body,
    commentBody: body,
    affectedFiles: [],
    findings: [],
  } satisfies ReviewOutcome;
}

export function extractFlowReviewOutcome(
  tokens: FlowExecutionToken[]
): ReviewOutcome | null {
  const activeTokens = tokens.filter((token) => !token.skipped);
  const reviewTokens = activeTokens.filter((token) => {
    const role = token.payload?.role;
    return role === undefined || role === "review";
  });
  const structuredReviews = reviewTokens
    .map((token) => token.payload?.review)
    .flatMap((review) => {
      if (
        !isRecord(review) ||
        typeof review.hasIssues !== "boolean" ||
        typeof review.summary !== "string"
      ) {
        return [];
      }

      return [
        {
          hasIssues: review.hasIssues,
          summary: review.summary,
          commentBody: toOptionalString(review.commentBody),
          affectedFiles: toStringArray(review.affectedFiles),
          findings: toReviewFindings(review.findings),
        } satisfies ReviewOutcome,
      ];
    });

  if (structuredReviews.length > 0) {
    return {
      hasIssues: structuredReviews.some((review) => review.hasIssues),
      summary: structuredReviews
        .map((review) => review.summary.trim())
        .filter(Boolean)
        .join("\n\n")
        .trim(),
      commentBody:
        structuredReviews
          .map((review) => review.commentBody?.trim())
          .find(Boolean) ?? null,
      affectedFiles: Array.from(
        new Set(structuredReviews.flatMap((review) => review.affectedFiles))
      ),
      findings: Array.from(
        new Map(
          structuredReviews
            .flatMap((review) => review.findings)
            .map((finding) => [
              [
                finding.severity,
                finding.title,
                finding.body,
                finding.path ?? "",
                finding.line ?? "",
              ].join("::"),
              finding,
            ])
        ).values()
      ),
    };
  }

  const combinedSummary = reviewTokens
    .map((token) => token.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (!combinedSummary) {
    return null;
  }

  return {
    hasIssues: true,
    summary: combinedSummary,
    commentBody: null,
    affectedFiles: [],
    findings: [],
  };
}

async function resolveAutomationModel(
  userId: string,
  modelId: string,
  timeoutMs?: number | null,
  gatewayContext?: GatewayCallContext,
  teamId?: string | null
): Promise<AutomationLanguageModel> {
  // Published flow versions are immutable snapshots, so a graph published
  // before a model was retired still pins the retired id. Upgrade it to the
  // recorded successor here rather than rewriting version history; the
  // reconciler handles the mutable pins (draft graphs, agents.model). No-op
  // for any model that has not been superseded.
  //
  // The upgrade applies the same guards as the SQL reconciler — the owner's
  // auto_enable_new_models opt-out, an explicitly disabled successor, successor
  // availability, and the team allowlist — so published automations honour the
  // opt-out exactly as draft graphs do. The allowlist is read once and handed to
  // both steps, so passing it on to resolveUserLanguageModel avoids re-reading
  // it there.
  //
  // Both steps now consume the same closed union, so an unreadable allowlist
  // fails closed in both: the upgrade is withheld and the invocation is refused
  // (#764). Previously only the upgrade fought that case, and the null the gate
  // received was indistinguishable from "unrestricted".
  const allowlistState: TeamAllowlistState = teamId
    ? await loadTeamAllowlistState(teamId)
    : { status: "unrestricted" };
  const effectiveModelId = await resolveRuntimeModelId(
    userId,
    modelId,
    allowlistState
  );

  const resolved = await resolveUserLanguageModel(userId, effectiveModelId, {
    providerFetch: buildAutomationProviderFetch({ timeoutMs }),
    preferGatewayProviderObject: true,
    gatewayContext: gatewayContext ?? { userId },
    gatewayFallbackModelIds: getAutomationModelFallbackIds(
      effectiveModelId,
      process.env[AUTOMATION_GATEWAY_FALLBACK_MODELS_ENV]
    ),
    teamId: teamId ?? null,
    allowlistState,
  });

  return { ...resolved, effectiveModelId };
}

async function resolveAutomationModelForPhase(input: {
  deps: AutomationJobExecutorDeps;
  userId: string;
  modelId: string;
  phase: string;
  timeoutMs?: number | null;
  gatewayContext?: GatewayCallContext;
  teamId?: string | null;
}) {
  try {
    return await input.deps.resolveAutomationModel(
      input.userId,
      input.modelId,
      input.timeoutMs,
      input.gatewayContext,
      input.teamId ?? null
    );
  } catch (error) {
    throw asAutomationModelExecutionError({
      error,
      phase: input.phase,
      timeoutMs: input.timeoutMs,
    });
  }
}

export function getPrReviewAutoMergeBlockReason(input: {
  reviewOutcome: Pick<ReviewOutcome, "hasIssues"> | null;
  requestedPrNumber: number;
  reviewedPrNumber: number | null;
}) {
  if (input.requestedPrNumber !== input.reviewedPrNumber) {
    return "Safe merge target does not match the reviewed pull request";
  }
  if (input.reviewOutcome?.hasIssues === false) return null;
  return input.reviewOutcome?.hasIssues === true
    ? "Mogplex review reported issues"
    : "Mogplex review did not produce a no-issues verdict";
}

export function resolveAutoMergeExpectedHeadSha(
  metadata: Record<string, unknown>,
  requestedPrNumber: number
) {
  if (resolvePullRequestNumber(metadata) !== requestedPrNumber) return null;
  return typeof metadata.head_sha === "string"
    ? metadata.head_sha.trim() || null
    : null;
}

export function getAutoMergeHeadBlockReason(
  metadata: Record<string, unknown>,
  requestedPrNumber: number,
  expectedHeadSha = resolveAutoMergeExpectedHeadSha(metadata, requestedPrNumber)
) {
  if (resolvePullRequestNumber(metadata) !== requestedPrNumber) return null;
  return expectedHeadSha
    ? null
    : "Triggering pull request head SHA is unavailable";
}

async function loadFlowDefinition(
  flowVersionId: string,
  fallbackFlowId?: string | null
): Promise<ResolvedFlowDefinition | null> {
  const { data: version, error: versionError } = await supabaseAdmin
    .from("flow_versions")
    .select("*")
    .eq("id", flowVersionId)
    .maybeSingle();

  if (versionError) {
    throw new Error(`Failed to load flow version: ${versionError.message}`);
  }
  if (!version) return null;

  const graph = coerceGraph(version.graph);
  const agentIds = Array.from(
    new Set(
      graph.nodes
        .filter((node) => node.type === "agent")
        .map((node) =>
          typeof node.data.agentId === "string" ? node.data.agentId : null
        )
        .filter(Boolean) as string[]
    )
  );

  const { data: agents, error: agentsError } =
    agentIds.length > 0
      ? await supabaseAdmin
          .from("agents")
          .select("id, name, slug, model, system_prompt")
          .in("id", agentIds)
      : { data: [], error: null };

  if (agentsError) {
    throw new Error(`Failed to load flow agents: ${agentsError.message}`);
  }

  return {
    flowId: fallbackFlowId || version.flow_id,
    flowVersionId: version.id,
    graph,
    agentsById: new Map(
      (agents || []).map((agent) => [
        agent.id,
        {
          id: agent.id,
          name: agent.name ?? null,
          slug: agent.slug ?? null,
          system_prompt: agent.system_prompt ?? null,
          max_steps: null,
          timeout_ms: null,
        } satisfies FlowAgentConfig,
      ])
    ),
  };
}

// The node owns the model. `agents.model` is deliberately NOT a fallback here:
// an agent is a reusable definition (prompt, role), and the model is a property
// of where that definition is *used*. Two sources of truth let the automations
// tab show one model while a run used another — see the caller, which rejects a
// node with no model rather than quietly substituting one.
function resolveFlowAgentOverrides(
  agent: FlowAgentConfig,
  node: Extract<FlowNode, { type: "agent" }>,
  modelId: string
): JobContext["agent"] {
  return {
    id: agent.id,
    name: agent.name,
    slug: agent.slug,
    model: modelId,
    system_prompt: node.data.systemPromptOverride ?? agent.system_prompt,
    max_steps:
      typeof node.data.maxStepsOverride === "number"
        ? node.data.maxStepsOverride
        : agent.max_steps,
    timeout_ms:
      typeof node.data.timeoutMsOverride === "number"
        ? node.data.timeoutMsOverride
        : agent.timeout_ms,
  };
}

function buildFlowConditionState(input: {
  context: JobContext;
  inboundTokens: FlowExecutionToken[];
  outputs: Map<string, { label: string; text: string }>;
  flowState: Map<string, unknown>;
}) {
  const outputsByNodeId = Object.fromEntries(
    Array.from(input.outputs.entries()).map(([nodeId, output]) => [
      nodeId,
      output.text,
    ])
  );
  const outputsByLabel = Object.fromEntries(
    Array.from(input.outputs.values()).map((output) => [
      output.label,
      output.text,
    ])
  );

  return {
    metadata: input.context.metadata,
    repo: {
      id: input.context.repo.id,
      full_name: input.context.repo.full_name,
      default_branch: input.context.repo.default_branch ?? null,
    },
    outputs: outputsByNodeId,
    outputs_by_label: outputsByLabel,
    previous_outputs: input.inboundTokens
      .filter((token) => !token.skipped && token.text.trim().length > 0)
      .map((token) => ({
        label: token.label,
        output: token.text,
      })),
    state: Object.fromEntries(input.flowState.entries()),
  };
}

async function resolveJobContext(
  jobRunId: string
): Promise<ResolvedJobContext> {
  "use step";

  const { data: job, error } = await supabaseAdmin
    .from("job_runs")
    .select("*, assignments(*, agents(*), repos(*))")
    .eq("id", jobRunId)
    .single();

  if (error || !job) {
    return { error: "JOB_NOT_FOUND" as const };
  }

  const runtime = resolveJobRunRuntimeDetails(job);

  // Legacy trigger dispatch removed: it built JobContext straight from the
  // agent row, so a run took `agents.model` with no way for the automation to
  // override it — the second source of truth this refactor exists to delete.
  // Every automation now runs as a flow, where the node owns the model.
  // Fail loudly rather than silently rerouting: a trigger-dispatched job means
  // something upstream still enqueues one, and that should be visible.
  if (job.trigger_id) {
    return { error: "MISSING_CONFIG" as const };
  }

  if (job.flow_id || job.flow_version_id) {
    const metadata = (job.metadata ?? {}) as Record<string, unknown>;
    const flowId =
      typeof job.flow_id === "string"
        ? job.flow_id
        : typeof metadata.flow_id === "string"
          ? metadata.flow_id
          : null;
    const flowVersionId =
      typeof job.flow_version_id === "string"
        ? job.flow_version_id
        : typeof metadata.flow_version_id === "string"
          ? metadata.flow_version_id
          : null;

    if (!flowId || !flowVersionId) {
      return { error: "MISSING_CONFIG" as const };
    }

    const { data: flow, error: flowError } = await supabaseAdmin
      .from("flows")
      .select("id, user_id, installation_id")
      .eq("id", flowId)
      .maybeSingle();

    if (flowError) {
      throw new Error(`Failed to load flow context: ${flowError.message}`);
    }

    const resolvedFlow = await loadFlowDefinition(flowVersionId, flowId);
    if (!flow || !resolvedFlow) {
      return { error: "MISSING_CONFIG" as const };
    }

    const repoId =
      typeof metadata.repo_id === "string" ? metadata.repo_id : null;
    let repo: JobContext["repo"] | null = null;

    if (repoId) {
      const { data: repoData, error: repoError } = await supabaseAdmin
        .from("repos")
        .select("*")
        .eq("id", repoId)
        .maybeSingle();

      if (repoError) {
        throw new Error(
          `Failed to load flow repo context: ${repoError.message}`
        );
      }

      repo = repoData;
    }

    if (!repo && typeof metadata.repo_full_name === "string") {
      repo = {
        id: repoId || "",
        user_id: flow.user_id,
        full_name: metadata.repo_full_name,
        github_installation_id:
          typeof metadata.installation_id === "number"
            ? metadata.installation_id
            : flow.installation_id,
      };
    }

    // Job-level placeholder only: every agent node rebuilds `context.agent`
    // from its own node before running (see resolveFlowAgentOverrides), so this
    // never selects the model a step actually executes on. Take the model from
    // the first agent node rather than the agent row so the job-level metadata
    // agrees with what the automation is configured to run.
    const firstAgentNode = resolvedFlow.graph.nodes.find(
      (node): node is Extract<FlowNode, { type: "agent" }> =>
        node.type === "agent"
    );
    const fallbackAgentConfig =
      Array.from(resolvedFlow.agentsById.values())[0] ?? null;
    const fallbackAgent = fallbackAgentConfig
      ? {
          ...fallbackAgentConfig,
          model:
            firstAgentNode?.data.modelOverride?.trim() ||
            `harness:${firstAgentNode?.data.harness ?? "mogplex"}`,
        }
      : null;
    const assignmentType =
      typeof metadata.source_type === "string"
        ? normalizeAutomationAssignmentType(metadata.source_type)
        : (() => {
            const startConfig = getStartConfig(resolvedFlow.graph);
            return normalizeAutomationAssignmentType(
              startConfig?.event ?? "mention"
            );
          })();

    if (!repo || !fallbackAgent) {
      return { error: "MISSING_CONFIG" as const };
    }

    return {
      context: {
        metadata,
        assignmentType,
        skillId: null,
        agent: fallbackAgent,
        repo,
      } satisfies JobContext,
      flow: resolvedFlow,
      runtime,
    };
  }

  // Legacy assignment dispatch removed for the same reason as triggers above:
  // it ran `assignment.agents` verbatim, model included, with no node to
  // override it. Assignments carry no model of their own, so there is nothing
  // to migrate — a job that reaches here is unroutable, not mis-modelled.
  return { error: "MISSING_CONFIG" as const };
}

const runAutomationAgent = createAutomationAgentRunner();

const runPRFixAgent = createPRFixAgentRunner();

const runPRFixAgentInSandbox = createSandboxPRFixAgentRunner();

// Wrapper that binds startAutomationJobRun to the module's release function
// (the module version takes it as a parameter to avoid circular dependencies)
async function releaseQueuedJobs(input: {
  jobRunId: string;
  releasedScope: ReleasedAutomationScope;
}) {
  return releaseQueuedJobsBase(input, startAutomationJobRun);
}

type AutomationJobExecutorDeps = {
  resolveJobContext: typeof resolveJobContext;
  resolveGithubToken: typeof resolveGithubToken;
  createPrReviewCheckRun: typeof createPrReviewCheckRun;
  completePrReviewCheckRun: typeof completePrReviewCheckRun;
  createPrReviewGithubReview: typeof createPrReviewGithubReview;
  clearPrReviewTimelineComment: typeof clearPrReviewTimelineComment;
  upsertPrReviewTimelineComment: typeof upsertPrReviewTimelineComment;
  resolveAutomationModel: typeof resolveAutomationModel;
  loadPullRequestDetails: typeof loadPullRequestDetails;
  resolveAutofixTargetRepo: typeof resolveAutofixTargetRepo;
  resolveAutofixGithubToken: typeof resolveAutofixGithubToken;
  runAutomationAgent: typeof runAutomationAgent;
  runAutomationHarnessAgent: typeof runAutomationHarnessAgent;
  runPRFixAgent: typeof runPRFixAgent;
  runPRFixAgentInSandbox: typeof runPRFixAgentInSandbox;
  getDurationMs: typeof getDurationMs;
  persistJobSuccess: typeof persistJobSuccess;
  persistJobReviewFindings: typeof persistJobReviewFindings;
  persistJobFailure: typeof persistJobFailure;
  tryLogAiCall: typeof tryLogAiCall;
  recordControlDispatchEvent: typeof recordControlDispatchEvent;
  releaseQueuedJobs: typeof releaseQueuedJobs;
  isJobRunCancellationRequested: typeof isJobRunCancellationRequested;
  throwIfJobRunCancelled: typeof throwIfJobRunCancelled;
  runFlowAction: typeof runFlowAction;
  // Durable wait surfaces are deps so unit tests can swap in a deterministic
  // wait provider (no real trigger.dev tokens, no real Supabase rows) without
  // patching the wait module at the import boundary.
  waitProvider: FlowOperatorWaitProvider;
  waitStore: FlowOperatorWaitStore;
};

const defaultAutomationJobExecutorDeps: AutomationJobExecutorDeps = {
  resolveJobContext,
  resolveGithubToken,
  createPrReviewCheckRun,
  completePrReviewCheckRun,
  createPrReviewGithubReview,
  clearPrReviewTimelineComment,
  upsertPrReviewTimelineComment,
  resolveAutomationModel,
  loadPullRequestDetails,
  resolveAutofixTargetRepo,
  resolveAutofixGithubToken,
  runAutomationAgent,
  runAutomationHarnessAgent,
  runPRFixAgent,
  runPRFixAgentInSandbox,
  getDurationMs,
  persistJobSuccess,
  persistJobReviewFindings,
  persistJobFailure,
  tryLogAiCall,
  recordControlDispatchEvent,
  releaseQueuedJobs,
  isJobRunCancellationRequested,
  throwIfJobRunCancelled,
  runFlowAction,
  waitProvider: triggerWaitProvider,
  waitStore: supabaseWaitStore,
};

export async function hydrateFlowPullRequestHeadContext(input: {
  context: JobContext;
  githubToken: string;
  loadPullRequestDetails: typeof loadPullRequestDetails;
  refresh?: boolean;
}) {
  const prNumber = resolvePullRequestNumber(input.context.metadata);
  const existingHeadSha =
    typeof input.context.metadata.head_sha === "string"
      ? input.context.metadata.head_sha.trim()
      : "";
  if (prNumber == null || (existingHeadSha && input.refresh !== true)) {
    return input.context;
  }

  let pullRequest: PullRequestDetails | null;
  try {
    pullRequest = await input.loadPullRequestDetails({
      repoFullName: input.context.repo.full_name,
      prNumber,
      githubToken: input.githubToken,
      fallbackHeadRef: null,
      fallbackHeadSha: null,
      fallbackHeadRepoFullName: null,
      fallbackBaseRef: null,
      fallbackBaseSha: null,
      fallbackBaseRepoFullName: null,
    });
  } catch (error) {
    console.warn("[automation-job] failed to hydrate pull request head", {
      repoFullName: input.context.repo.full_name,
      prNumber,
      error: error instanceof Error ? error.message : String(error),
    });
    return input.context;
  }

  const headSha = pullRequest?.headSha?.trim();
  if (!pullRequest || !headSha) return input.context;
  return {
    ...input.context,
    metadata: {
      ...input.context.metadata,
      pr_number: prNumber,
      head_ref: pullRequest.headRef,
      head_sha: headSha,
      head_repo_full_name: pullRequest.headRepoFullName,
      base_ref: pullRequest.baseRef,
      base_sha: pullRequest.baseSha,
      base_repo_full_name: pullRequest.baseRepoFullName,
    },
  };
}

function flowRequestsAutoMerge(graph: FlowGraph) {
  return graph.nodes.some(
    (node) =>
      (node.type === "agent" && node.data.autoMerge === true) ||
      (node.type === "action" &&
        node.data.operation === "github.merge_pull_request")
  );
}

async function attemptFlowAutoMerge(input: {
  jobRunId: string;
  repoFullName: string;
  prNumber: number;
  githubToken: string;
  expectedHeadSha?: string | null;
  commitTitle?: string | null;
}): Promise<AutoMergeOutcome> {
  const [mergeOwner, mergeRepo] = input.repoFullName.split("/");
  let autoMerge: AutoMergeOutcome;
  try {
    autoMerge = await mergePullRequestIfSafe({
      githubToken: input.githubToken,
      owner: mergeOwner,
      repo: mergeRepo,
      prNumber: input.prNumber,
      ...(input.expectedHeadSha
        ? { expectedHeadSha: input.expectedHeadSha }
        : {}),
      ...(input.commitTitle ? { commitTitle: input.commitTitle } : {}),
    });
  } catch (error) {
    autoMerge = {
      merged: false,
      reason: `Auto-merge errored: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  console.log(
    JSON.stringify({
      event: "flow_auto_merge",
      job_run_id: input.jobRunId,
      repo_full_name: input.repoFullName,
      pr_number: input.prNumber,
      merged: autoMerge.merged,
      reason: autoMerge.reason,
    })
  );
  return autoMerge;
}

async function executeAutomationContext(input: {
  jobRunId: string;
  context: JobContext;
  githubToken: string;
  deps: AutomationJobExecutorDeps;
  allowAutofix?: boolean;
  autofixSandbox?: boolean;
  allowAutoMerge?: boolean;
}) {
  const assignmentType = normalizeAutomationAssignmentType(
    input.context.assignmentType
  );
  const resolvedModel = await resolveAutomationModelForPhase({
    deps: input.deps,
    userId: input.context.repo.user_id,
    modelId: input.context.agent.model,
    phase: `${assignmentType}:model_resolution`,
    timeoutMs: input.context.agent.timeout_ms,
    gatewayContext: buildAutomationGatewayContext(
      input.context,
      assignmentType
    ),
    teamId: readAutomationTeamId(input.context.metadata),
  });
  const prNumber =
    assignmentType === "pr_review"
      ? resolvePullRequestNumber(input.context.metadata)
      : null;

  if (assignmentType === "pr_review" && prNumber == null) {
    throw new Error(INVALID_PR_REVIEW_CONTEXT);
  }

  let result = await input.deps.runAutomationAgent(
    input.context,
    input.githubToken,
    resolvedModel
  );

  // Code mutation must be explicitly opted into. Legacy PR review jobs stay review-only.
  if (assignmentType !== "pr_review") {
    return result;
  }

  const reviewHarnessResult = extractPrReviewHarnessResult(result);
  const review =
    reviewHarnessResult.source === "structured"
      ? reviewHarnessResult.reviewOutcome
      : null;

  if (
    input.allowAutoMerge === true &&
    prNumber != null &&
    review !== null &&
    !review.hasIssues
  ) {
    // Don't merge here: the Mogplex PR Review check run for this head SHA is
    // still in_progress until finalizePrReviewSuccess completes it, so a repo
    // that requires that check would never report mergeable_state "clean".
    // The job success path performs the merge after the check run is
    // published (see attemptFlowAutoMerge).
    return { ...result, autoMergeRequest: { prNumber } };
  }

  if (input.allowAutofix !== true) {
    return result;
  }

  if (!review?.hasIssues || prNumber == null) {
    return result;
  }

  const pullRequest = await input.deps.loadPullRequestDetails({
    repoFullName: input.context.repo.full_name,
    prNumber,
    githubToken: input.githubToken,
    fallbackHeadRef:
      typeof input.context.metadata.head_ref === "string"
        ? input.context.metadata.head_ref
        : null,
    fallbackHeadSha:
      typeof input.context.metadata.head_sha === "string"
        ? input.context.metadata.head_sha
        : null,
    fallbackHeadRepoFullName:
      typeof input.context.metadata.head_repo_full_name === "string"
        ? input.context.metadata.head_repo_full_name
        : null,
    fallbackBaseRef:
      typeof input.context.metadata.base_ref === "string"
        ? input.context.metadata.base_ref
        : (input.context.repo.default_branch ?? null),
    fallbackBaseSha:
      typeof input.context.metadata.base_sha === "string"
        ? input.context.metadata.base_sha
        : null,
    fallbackBaseRepoFullName:
      typeof input.context.metadata.base_repo_full_name === "string"
        ? input.context.metadata.base_repo_full_name
        : input.context.repo.full_name,
  });

  if (!pullRequest) {
    return result;
  }

  const targetRepo = await input.deps.resolveAutofixTargetRepo({
    contextRepo: input.context.repo,
    headRepoFullName: pullRequest.headRepoFullName,
  });
  const autofixGithubToken = targetRepo
    ? await input.deps.resolveAutofixGithubToken(targetRepo, {
        jobRunId: input.jobRunId,
      })
    : null;

  if (!targetRepo || !autofixGithubToken) {
    return result;
  }

  const runFixAgent =
    input.autofixSandbox === true
      ? input.deps.runPRFixAgentInSandbox
      : input.deps.runPRFixAgent;

  const fixResult = await runFixAgent(
    {
      context: input.context,
      review,
      pullRequest,
      targetRepo,
    },
    autofixGithubToken,
    resolvedModel
  );

  result = mergeAutomationAgentResults([result, fixResult]);
  return result;
}

async function executeResolvedFlow(input: {
  jobRunId: string;
  context: JobContext;
  githubToken: string;
  resolvedFlow: ResolvedFlowDefinition;
  deps: AutomationJobExecutorDeps;
}) {
  const outputs = new Map<string, { label: string; text: string }>();
  // Per-run mutable state. Written by `set_variable` and `transform`, read by
  // downstream conditions under `state.<key>`. Lives only for the duration of
  // this job execution — never persisted to the published graph.
  const flowState = new Map<string, unknown>();
  const results: AutomationAgentResult[] = [];
  const receivedTokens = new Map<string, FlowExecutionToken[]>();
  const incomingCounts = new Map<string, number>();
  const processed = new Set<string>();
  let observabilityError: string | null = null;
  let autoMergeRequest: FlowAutoMergeRequest | null = null;
  let expectedTriggerHeadSha =
    typeof input.context.metadata.head_sha === "string"
      ? input.context.metadata.head_sha.trim() || null
      : null;
  const expectedHeadShaFor = (prNumber: number) =>
    resolvePullRequestNumber(input.context.metadata) === prNumber
      ? expectedTriggerHeadSha
      : null;
  for (const node of input.resolvedFlow.graph.nodes) {
    incomingCounts.set(
      node.id,
      input.resolvedFlow.graph.edges.filter((edge) => edge.target === node.id)
        .length
    );
  }

  const startNode = input.resolvedFlow.graph.nodes.find(
    (node) => node.type === "start"
  );
  if (!startNode) {
    return {
      success: false as const,
      message: "Flow is missing a start node",
      context: input.context,
      observabilityError,
    };
  }

  const collectPredecessorOutputs = (nodeId: string) => {
    const inboundTokens = receivedTokens.get(nodeId) ?? [];
    return inboundTokens
      .filter((token) => !token.skipped && token.text.trim().length > 0)
      .map((token) => ({
        label: token.label,
        text: token.text,
      }));
  };

  const emitToOutgoing = (
    nodeId: string,
    label: string,
    text: string,
    skipped = false,
    payload?: Record<string, unknown> | null,
    selector?: (
      edge: (typeof input.resolvedFlow.graph.edges)[number]
    ) => boolean
  ) =>
    getOutgoingEdges(input.resolvedFlow.graph, nodeId)
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

  const executeNode = async (nodeId: string) => {
    await input.deps.throwIfJobRunCancelled(input.jobRunId);

    const node = getNodeById(input.resolvedFlow.graph, nodeId);
    if (!node) {
      return {
        ok: false as const,
        message: `Missing flow node "${nodeId}"`,
        context: input.context,
        observabilityError,
      };
    }

    const label =
      typeof node.data.label === "string" ? node.data.label : node.id;
    const inboundTokens = receivedTokens.get(node.id) ?? [];
    const activeInboundTokens = inboundTokens.filter((token) => !token.skipped);
    const shouldSkip =
      node.type !== "start" &&
      inboundTokens.length > 0 &&
      activeInboundTokens.length === 0;

    const nodeRun = await createFlowNodeRunBestEffort({
      userId: input.context.repo.user_id,
      jobRunId: input.jobRunId,
      flowId: input.resolvedFlow.flowId,
      flowVersionId: input.resolvedFlow.flowVersionId,
      nodeId: node.id,
      nodeType: node.type,
      nodeLabel: label,
    });

    const noteObservabilityError = (value: string | null) => {
      if (value && !observabilityError) {
        observabilityError = value;
      }
    };

    noteObservabilityError(nodeRun.observabilityError);

    const completeNodeRun = async (completion: {
      status: FlowNodeRunStatus;
      output?: Record<string, unknown> | null;
      error?: string | null;
    }) => {
      const result = await completeFlowNodeRunBestEffort({
        nodeRunId: nodeRun.id,
        jobRunId: input.jobRunId,
        flowId: input.resolvedFlow.flowId,
        nodeId: node.id,
        status: completion.status,
        startedAt: nodeRun.startedAt,
        output: completion.output,
        error: completion.error,
      });
      noteObservabilityError(result.observabilityError);
      return result.durationMs;
    };

    const completeSkipped = async (reason: string) => {
      await completeNodeRun({
        status: "skipped",
        output: {
          skipped: true,
          reason,
        },
      });

      return {
        ok: true as const,
        emitted: emitToOutgoing(node.id, label, reason, true),
      };
    };

    // Routes a node failure to a downstream "error" handle when one is wired
    // up; otherwise returns null so the caller can fail the run normally.
    // Callers must have already recorded the node-run row as `failed` before
    // invoking this — this helper only changes the outgoing-token signal.
    //
    // Mirrors how condition emits skipped tokens on the not-taken branch: the
    // success-path edges still receive a skipped token so any multi-input
    // node downstream (join, end with parallel branches) doesn't deadlock.
    const routeFailureOrNull = (message: string) => {
      const failureEdges = getFailureEdges(input.resolvedFlow.graph, node.id);
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
          ...emitToOutgoing(
            node.id,
            label,
            message,
            false,
            failurePayload,
            (edge) => edge.sourceHandle === FAILURE_HANDLE_ID
          ),
          ...emitToOutgoing(
            node.id,
            label,
            `Skipped because "${label}" failed and routed to its error handle`,
            true,
            null,
            (edge) => edge.sourceHandle !== FAILURE_HANDLE_ID
          ),
        ],
      };
    };

    const completeFailedNode = async (message: string, context: JobContext) => {
      await completeNodeRun({
        status: "failed",
        error: message,
      });
      return (
        routeFailureOrNull(message) ?? {
          ok: false as const,
          message,
          context,
          observabilityError,
        }
      );
    };

    // Operator-flavored adapters: the operator registry's execute() takes a
    // narrower context than the executor needs end-to-end. These wrappers
    // bridge the registry shape onto the closures that already live in this
    // function.
    const operatorEmit = (
      emitLabel: string,
      text: string,
      options?: {
        skipped?: boolean;
        payload?: Record<string, unknown> | null;
        selector?: (
          edge: (typeof input.resolvedFlow.graph.edges)[number]
        ) => boolean;
      }
    ): FlowOperatorEmission[] =>
      emitToOutgoing(
        node.id,
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
      return { ok: true, emitted: skipResult.emitted };
    };

    const runOperator = async () => {
      const operator = getFlowOperator(node.type);
      if (!operator.execute) {
        // Defensive guard: every type in the operator-managed set should ship
        // an execute(); if one is missing it's a programmer error that would
        // silently skip the node, so fail the run loudly instead.
        return {
          ok: false as const,
          message: `Operator "${node.type}" has no execute() registered`,
          context: input.context,
          observabilityError,
        };
      }

      const operatorContext: FlowOperatorExecuteContext = {
        node,
        label,
        graph: input.resolvedFlow.graph,
        inboundTokens: inboundTokens as ReadonlyArray<FlowOperatorEmittedToken>,
        activeInboundTokens:
          activeInboundTokens as ReadonlyArray<FlowOperatorEmittedToken>,
        shouldSkip,
        outputs,
        flowState,
        resolutionState: buildFlowConditionState({
          context: input.context,
          inboundTokens,
          outputs,
          flowState,
        }),
        predecessorOutputs: () => collectPredecessorOutputs(node.id),
        emit: operatorEmit,
        completeNodeRun,
        completeSkipped: operatorCompleteSkipped,
        jobRunId: input.jobRunId,
        flowId: input.resolvedFlow.flowId,
        flowVersionId: input.resolvedFlow.flowVersionId,
        userId: input.context.repo.user_id,
        installationId:
          typeof input.context.repo.github_installation_id === "number"
            ? input.context.repo.github_installation_id
            : null,
        repoId: input.context.repo.id,
        waitProvider: input.deps.waitProvider,
        waitStore: input.deps.waitStore,
        actionRunner: ({ jobRunId, nodeId, action }) =>
          input.deps.runFlowAction({
            jobRunId,
            nodeId,
            action,
            context: input.context,
            githubToken: input.githubToken,
            loadPullRequestDetails: input.deps.loadPullRequestDetails,
            resolveAutofixTargetRepo: input.deps.resolveAutofixTargetRepo,
          }),
      };

      const result = await operator.execute(operatorContext);
      if (result.ok) {
        if (
          node.type === "action" &&
          node.data.operation === "github.merge_pull_request"
        ) {
          const payload = result.emitted.find(
            (emission) => emission.token.payload?.auto_merge_requested === true
          )?.token.payload;
          const prNumber = coercePositivePrNumber(payload?.pull_request_number);
          if (prNumber != null) {
            autoMergeRequest = {
              prNumber,
              expectedHeadSha: expectedHeadShaFor(prNumber),
              commitTitle:
                typeof payload?.commit_title === "string"
                  ? payload.commit_title
                  : null,
            };
          }
        }
        return { ok: true as const, emitted: result.emitted };
      }
      const recovered = routeFailureOrNull(result.message);
      if (recovered) return recovered;
      return {
        ok: false as const,
        message: result.message,
        context: input.context,
        observabilityError,
      };
    };

    let failureContext: JobContext | null = null;

    try {
      switch (node.type) {
        case "start":
        case "action":
        case "parallel":
        case "join":
        case "delay":
        case "await_event":
        case "set_variable":
        case "transform":
        case "end": {
          return await runOperator();
        }
        case "agent": {
          if (shouldSkip) {
            return completeSkipped(
              "Skipped because every incoming branch was skipped"
            );
          }

          const agentId =
            typeof node.data.agentId === "string" ? node.data.agentId : null;
          const baseAgent = agentId
            ? input.resolvedFlow.agentsById.get(agentId)
            : null;
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
            await completeNodeRun({
              status: "failed",
              error: message,
            });
            const recovered = routeFailureOrNull(message);
            if (recovered) return recovered;
            return {
              ok: false as const,
              message,
              context: input.context,
              observabilityError,
            };
          }
          if (!baseAgent && !harnessId) {
            const message = `Missing agent for node "${label}"`;
            await completeNodeRun({
              status: "failed",
              error: message,
            });
            const recovered = routeFailureOrNull(message);
            if (recovered) return recovered;
            return {
              ok: false as const,
              message,
              context: input.context,
              observabilityError,
            };
          }

          const predecessorOutputs = collectPredecessorOutputs(node.id);
          const nodeContext: JobContext = {
            ...input.context,
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
              ...input.context.metadata,
              flow_id: input.resolvedFlow.flowId,
              flow_version_id: input.resolvedFlow.flowVersionId,
              flow_node_id: node.id,
              flow_node_label: label,
              flow_node_role: nodeRole,
              flow_node_harness: nodeHarness,
              ...(node.data.autoRevert === true
                ? { flow_auto_revert: true }
                : {}),
              // The agent runner needs the job run id to persist approval
              // waits; it is only stamped when the node opted into gating.
              ...(node.data.requireApproval === true
                ? {
                    flow_require_approval: true,
                    flow_job_run_id: input.jobRunId,
                  }
                : {}),
              flow_previous_outputs: predecessorOutputs.map((entry) => ({
                label: entry.label,
                output: entry.text,
              })),
            },
          };
          failureContext = nodeContext;

          let result: AutomationAgentResult;
          const loadNodePullRequest = (prNumber: number) =>
            input.deps.loadPullRequestDetails({
              repoFullName: nodeContext.repo.full_name,
              prNumber,
              githubToken: input.githubToken,
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

          if (nodeRole === "edit") {
            const startEvent =
              getStartConfig(input.resolvedFlow.graph)?.event ?? null;
            const commentTriggered = isCommentTriggerEvent(startEvent);
            const hasReviewUpstream = hasUpstreamAgentRole(
              input.resolvedFlow.graph,
              node.id,
              "review"
            );

            if (!hasReviewUpstream && !commentTriggered) {
              const message = `Fix node "${label}" must be placed after a Review node, or its flow must start from a pull request comment trigger (@mogplex mention or PR comment).`;
              await completeNodeRun({
                status: "failed",
                error: message,
              });
              const recovered = routeFailureOrNull(message);
              if (recovered) return recovered;
              return {
                ok: false as const,
                message,
                context: nodeContext,
                observabilityError,
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
              return completeSkipped(
                "Edit node skipped because no upstream review output was available"
              );
            }
            if (!review.hasIssues) {
              return completeSkipped(
                "Edit node skipped because upstream reviewers reported no issues"
              );
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
              return completeSkipped(
                "Edit node skipped because editor nodes currently support pull request, PR comment, @mogplex mention, and label triggers only"
              );
            }

            const prNumber = resolvePullRequestNumber(nodeContext.metadata);

            if (prNumber == null) {
              const message = `Edit node "${label}" is missing pull request context`;
              await completeNodeRun({
                status: "failed",
                error: message,
              });
              const recovered = routeFailureOrNull(message);
              if (recovered) return recovered;
              return {
                ok: false as const,
                message,
                context: nodeContext,
                observabilityError,
              };
            }

            const pullRequest = await loadNodePullRequest(prNumber);

            if (!pullRequest) {
              const message = `Edit node "${label}" could not load pull request details`;
              await completeNodeRun({
                status: "failed",
                error: message,
              });
              const recovered = routeFailureOrNull(message);
              if (recovered) return recovered;
              return {
                ok: false as const,
                message,
                context: nodeContext,
                observabilityError,
              };
            }

            const targetRepo = await input.deps.resolveAutofixTargetRepo({
              contextRepo: nodeContext.repo,
              headRepoFullName: pullRequest.headRepoFullName,
            });
            if (!targetRepo) {
              return completeSkipped(
                "Edit node skipped because the PR head repository is unavailable"
              );
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

            if (harnessId) {
              result = await input.deps.runAutomationHarnessAgent({
                jobRunId: input.jobRunId,
                context: fixContext,
                harnessId,
                review,
                pullRequest,
                targetRepo,
              });
            } else {
              const autofixGithubToken =
                await input.deps.resolveAutofixGithubToken(targetRepo, {
                  jobRunId: input.jobRunId,
                });
              if (!autofixGithubToken) {
                return completeSkipped(
                  "Edit node skipped because no GitHub App autofix token was available for the PR head repository"
                );
              }

              const resolvedModel = await resolveAutomationModelForPhase({
                deps: input.deps,
                userId: nodeContext.repo.user_id,
                modelId: nodeContext.agent.model,
                phase: "pr_fix:model_resolution",
                timeoutMs: nodeContext.agent.timeout_ms,
                gatewayContext: buildAutomationGatewayContext(
                  nodeContext,
                  "pr_fix"
                ),
                teamId: readAutomationTeamId(nodeContext.metadata),
              });

              const runFixAgent =
                node.data.autofixSandbox === true
                  ? input.deps.runPRFixAgentInSandbox
                  : input.deps.runPRFixAgent;

              result = await runFixAgent(
                {
                  context: fixContext,
                  review,
                  pullRequest,
                  targetRepo,
                },
                autofixGithubToken,
                resolvedModel
              );
            }
          } else if (harnessId) {
            let pullRequest: PullRequestDetails | null = null;
            let targetRepo: JobContext["repo"] | null = null;
            const prNumber = resolvePullRequestNumber(nodeContext.metadata);
            const requiresPullRequest =
              normalizeAutomationAssignmentType(nodeContext.assignmentType) ===
                "pr_review" || prNumber != null;

            if (requiresPullRequest) {
              if (prNumber == null) {
                return completeFailedNode(
                  `Harness node "${label}" is missing pull request context`,
                  nodeContext
                );
              }

              pullRequest = await loadNodePullRequest(prNumber);
              if (!pullRequest) {
                return completeFailedNode(
                  `Harness node "${label}" could not load pull request details`,
                  nodeContext
                );
              }

              targetRepo = await input.deps.resolveAutofixTargetRepo({
                contextRepo: nodeContext.repo,
                headRepoFullName: pullRequest.headRepoFullName,
              });
              if (!targetRepo) {
                return completeFailedNode(
                  `Harness node "${label}" could not resolve the pull request head repository`,
                  nodeContext
                );
              }
            }

            result = await input.deps.runAutomationHarnessAgent({
              jobRunId: input.jobRunId,
              context: nodeContext,
              harnessId,
              pullRequest,
              targetRepo,
            });
          } else {
            result = await executeAutomationContext({
              jobRunId: input.jobRunId,
              context: nodeContext,
              githubToken: input.githubToken,
              deps: input.deps,
              allowAutofix: nodeRole === "review" && node.data.autofix === true,
              autofixSandbox:
                nodeRole === "review" &&
                node.data.autofix === true &&
                node.data.autofixSandbox === true,
              allowAutoMerge:
                nodeRole === "review" && node.data.autoMerge === true,
            });
          }

          if (nodeRole === "edit") {
            const refreshedContext = await hydrateFlowPullRequestHeadContext({
              context: input.context,
              githubToken: input.githubToken,
              loadPullRequestDetails: input.deps.loadPullRequestDetails,
              refresh: true,
            });
            const prNumber = resolvePullRequestNumber(
              refreshedContext.metadata
            );
            expectedTriggerHeadSha =
              prNumber == null
                ? null
                : resolveAutoMergeExpectedHeadSha(
                    refreshedContext.metadata,
                    prNumber
                  );
          }

          const toolCalls = extractToolCalls(result);
          const inputTokens = result.usage?.inputTokens ?? null;
          const outputTokens = result.usage?.outputTokens ?? null;
          const reviewOutcome =
            nodeRole === "review"
              ? extractPrReviewHarnessResult(result).reviewOutcome
              : null;
          let nodeAutoMergeRequest =
            (result as { autoMergeRequest?: FlowAutoMergeRequest })
              .autoMergeRequest ?? null;
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
            autoMergeRequest = {
              ...nodeAutoMergeRequest,
              expectedHeadSha: expectedHeadShaFor(
                nodeAutoMergeRequest.prNumber
              ),
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
              await input.deps.tryLogAiCall({
                context: nodeContext,
                jobRunId: input.jobRunId,
                status: "success",
                startedAt: nodeRun.startedAt,
                durationMs: nodeDurationMs,
                inputTokens,
                outputTokens,
                toolCalls,
                execution: result.execution ?? null,
              })
            );
          }

          const summary = summarizeNodeOutput(result.text);
          outputs.set(node.id, { label, text: summary });
          results.push(result);

          return {
            ok: true as const,
            emitted: emitToOutgoing(node.id, label, summary, false, {
              role: nodeRole,
              review: reviewOutcome,
            }),
          };
        }
        case "condition": {
          if (shouldSkip) {
            return completeSkipped(
              "Condition skipped because every incoming branch was skipped"
            );
          }

          const state = buildFlowConditionState({
            context: input.context,
            inboundTokens,
            outputs,
            flowState,
          });
          const passed = evaluateConditionNode({
            node,
            state,
          });
          const chosenHandle = passed ? "true" : "false";
          const skippedHandle = passed ? "false" : "true";
          const summary = `${label} evaluated ${passed ? "then" : "else"}`;

          outputs.set(node.id, { label, text: summary });
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
                node.id,
                label,
                summary,
                false,
                null,
                (edge) => (edge.sourceHandle ?? "true") === chosenHandle
              ),
              ...emitToOutgoing(
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
      }
    } catch (error) {
      const isCancellation = error instanceof JobRunCancelledError;
      const message =
        error instanceof Error
          ? error.message
          : `Failed to execute node "${label}"`;
      const execution = isAutomationModelExecutionError(error)
        ? error.metadata
        : null;
      const nodeContext =
        failureContext ??
        (node.type === "agent"
          ? {
              ...input.context,
              metadata: {
                ...input.context.metadata,
                flow_id: input.resolvedFlow.flowId,
                flow_version_id: input.resolvedFlow.flowVersionId,
                flow_node_id: node.id,
                flow_node_label: label,
              },
            }
          : input.context);
      const nodeDurationMs = await completeNodeRun({
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
        startedAt: nodeRun.startedAt,
        durationMs: nodeDurationMs,
        inputTokens: loggedUsage.inputTokens,
        outputTokens: loggedUsage.outputTokens,
        error: message,
        execution,
      });
      noteObservabilityError(aiCallObservabilityError);

      // Cancellation is non-recoverable. The outer loop relies on the
      // JOB_RUN_CANCELLED message to terminate the run, so error edges must
      // not catch it.
      if (!isCancellation) {
        const recovered = routeFailureOrNull(message);
        if (recovered) return recovered;
      }

      return {
        ok: false as const,
        message,
        context: nodeContext,
        observabilityError,
        execution,
        aiCallTelemetryHandled: true as const,
      };
    }
  };

  let ready = [startNode.id];

  while (ready.length > 0) {
    if (await input.deps.isJobRunCancellationRequested(input.jobRunId)) {
      return {
        success: false as const,
        message: JOB_RUN_CANCELLED,
        context: input.context,
        observabilityError,
      };
    }

    const currentBatch = ready.filter((nodeId) => !processed.has(nodeId));
    if (currentBatch.length === 0) {
      break;
    }

    const settled = await Promise.all(
      currentBatch.map((nodeId) => executeNode(nodeId))
    );
    const nextReady = new Set<string>();

    for (const nodeId of currentBatch) {
      processed.add(nodeId);
    }

    if (await input.deps.isJobRunCancellationRequested(input.jobRunId)) {
      return {
        success: false as const,
        message: JOB_RUN_CANCELLED,
        context: input.context,
        observabilityError,
      };
    }

    for (const item of settled) {
      if (!item.ok) {
        return {
          success: false as const,
          message: item.message,
          context: item.context,
          observabilityError: item.observabilityError ?? observabilityError,
          execution: "execution" in item ? item.execution : null,
          aiCallTelemetryHandled:
            "aiCallTelemetryHandled" in item && item.aiCallTelemetryHandled,
        };
      }

      for (const emitted of item.emitted) {
        const existing = receivedTokens.get(emitted.targetId) ?? [];
        receivedTokens.set(emitted.targetId, [...existing, emitted.token]);
        if (processed.has(emitted.targetId)) continue;
        const targetNode = getNodeById(
          input.resolvedFlow.graph,
          emitted.targetId
        );
        if (!targetNode) continue;
        const targetReceived = receivedTokens.get(emitted.targetId) ?? [];
        const targetIncoming = incomingCounts.get(emitted.targetId) ?? 0;
        const operator = getFlowOperator(targetNode.type);
        const ready = operator.isReady
          ? operator.isReady({
              node: targetNode,
              incomingCount: targetIncoming,
              receivedTokens: targetReceived,
            })
          : targetReceived.length === targetIncoming;
        if (ready) {
          nextReady.add(emitted.targetId);
        }
      }
    }

    ready = Array.from(nextReady);
  }

  const endNode = input.resolvedFlow.graph.nodes.find(
    (node) => node.type === "end"
  );
  if (endNode && !processed.has(endNode.id)) {
    return {
      success: false as const,
      message: "Flow execution ended before reaching the end node",
      context: input.context,
      observabilityError,
    };
  }

  return {
    success: true as const,
    result: mergeAutomationAgentResults(results),
    // Assigned inside the node-processing closure, so TS narrows the local
    // back to its initializer here; the cast restores the declared type.
    autoMergeRequest: autoMergeRequest as FlowAutoMergeRequest | null,
    observabilityError,
  };
}

export function createAutomationJobExecutor(
  overrides: Partial<AutomationJobExecutorDeps> = {}
) {
  const deps: AutomationJobExecutorDeps = {
    ...defaultAutomationJobExecutorDeps,
    ...overrides,
  };

  return async function executeAutomationJobRun(
    input: AutomationJobInput
  ): Promise<AutomationJobRunResult> {
    const { startedAt } = input;

    const resolved = await deps.resolveJobContext(input.jobRunId);
    if (!("context" in resolved)) {
      const durationMs = await deps.getDurationMs(startedAt);
      const persisted = await deps.persistJobFailure({
        jobRunId: input.jobRunId,
        error: resolved.error,
        durationMs,
      });
      if (!persisted) {
        return { success: false, error: JOB_RUN_CANCELLED };
      }
      await deps.releaseQueuedJobs({
        jobRunId: input.jobRunId,
        releasedScope: input.releasedScope,
      });
      return { success: false, error: resolved.error };
    }

    let { context } = resolved;
    const runtime = resolved.runtime ?? null;
    const dispatchLogContext = buildDispatchLogContext({
      releasedScope: input.releasedScope,
      context,
      resolvedFlow: resolved.flow ?? null,
    });
    const isPrReview = isPrReviewSourceType(dispatchLogContext.sourceType);
    const githubToken = await deps.resolveGithubToken(context.repo, {
      jobRunId: input.jobRunId,
    });

    if (!githubToken) {
      const durationMs = await deps.getDurationMs(startedAt);
      const persisted = await deps.persistJobFailure({
        jobRunId: input.jobRunId,
        error: "NO_GITHUB_CONNECTION",
        durationMs,
      });
      if (!persisted) {
        return { success: false, error: JOB_RUN_CANCELLED };
      }
      const genericFailureReason = classifyAutomationFailureReason({
        message: "NO_GITHUB_CONNECTION",
      });
      await deps.recordControlDispatchEvent(
        isPrReview
          ? {
              context: dispatchLogContext,
              jobRunId: input.jobRunId,
              outcome: "failed",
              reason: PR_REVIEW_REASON_CODES.githubAuthFailed,
              metadata: {
                review_outcome: PR_REVIEW_REASON_CODES.githubAuthFailed,
                review_outcome_label: formatAutomationReasonLabel(
                  PR_REVIEW_REASON_CODES.githubAuthFailed
                ),
              },
            }
          : {
              context: dispatchLogContext,
              jobRunId: input.jobRunId,
              outcome: "failed",
              reason: genericFailureReason,
              metadata: {
                error: "NO_GITHUB_CONNECTION",
              },
            }
      );
      const observabilityError = await deps.tryLogAiCall({
        context,
        jobRunId: input.jobRunId,
        status: "failed",
        startedAt,
        durationMs,
        inputTokens: null,
        outputTokens: null,
        error: "NO_GITHUB_CONNECTION",
      });
      await deps.releaseQueuedJobs({
        jobRunId: input.jobRunId,
        releasedScope: input.releasedScope,
      });
      return {
        success: false,
        error: "NO_GITHUB_CONNECTION",
        observabilityError,
      };
    }

    if (resolved.flow && flowRequestsAutoMerge(resolved.flow.graph)) {
      context = await hydrateFlowPullRequestHeadContext({
        context,
        githubToken,
        loadPullRequestDetails: deps.loadPullRequestDetails,
      });
    }

    const reviewHeadSha =
      isPrReview && typeof context.metadata.head_sha === "string"
        ? context.metadata.head_sha.trim()
        : "";
    const reviewPrNumber = isPrReview
      ? resolvePullRequestNumber(context.metadata)
      : null;
    const reviewCheckDetailsUrl = buildPrReviewCheckDetailsUrl();
    let reviewCheckRunId: number | null = null;
    let reviewCheckRunUrl: string | null = null;
    let reviewCheckRunCompleted = false;
    let reviewCheckRunConclusion: "success" | "neutral" | "failure" | null =
      null;
    let reviewCheckRunError: string | null = null;
    let reviewTimelineCommentPublished = false;
    let reviewTimelineCommentId: number | null = null;
    let reviewTimelineCommentUrl: string | null = null;
    let reviewTimelineCommentError: string | null = null;
    let reviewGithubReviewPublished = false;
    let reviewGithubReviewId: number | null = null;
    let reviewGithubReviewUrl: string | null = null;
    let reviewGithubReviewError: string | null = null;
    let reviewGithubInlineCommentCount = 0;
    let reviewStaleHeadCheckError: string | null = null;
    let prReviewCompletionReason: string | null = null;

    if (isPrReview && reviewHeadSha.length > 0) {
      try {
        const checkRun = await deps.createPrReviewCheckRun({
          githubToken,
          repoFullName: context.repo.full_name,
          headSha: reviewHeadSha,
          externalId: input.jobRunId,
          detailsUrl: reviewCheckDetailsUrl,
        });
        reviewCheckRunId = checkRun.id;
        reviewCheckRunUrl = checkRun.htmlUrl;
      } catch (error) {
        reviewCheckRunError =
          error instanceof Error
            ? error.message
            : "Failed to create GitHub check run";
      }
    }

    const loadCurrentPrReviewHeadSha = async () => {
      if (!isPrReview || reviewPrNumber == null || reviewHeadSha.length === 0) {
        return null;
      }

      try {
        const pullRequest = await deps.loadPullRequestDetails({
          repoFullName: context.repo.full_name,
          prNumber: reviewPrNumber,
          githubToken,
          fallbackHeadRef:
            typeof context.metadata.head_ref === "string"
              ? context.metadata.head_ref
              : null,
          fallbackHeadSha: reviewHeadSha,
          fallbackHeadRepoFullName:
            typeof context.metadata.head_repo_full_name === "string"
              ? context.metadata.head_repo_full_name
              : null,
          fallbackBaseRef:
            typeof context.metadata.base_ref === "string"
              ? context.metadata.base_ref
              : null,
          fallbackBaseSha:
            typeof context.metadata.base_sha === "string"
              ? context.metadata.base_sha
              : null,
          fallbackBaseRepoFullName:
            typeof context.metadata.base_repo_full_name === "string"
              ? context.metadata.base_repo_full_name
              : null,
        });
        const currentHeadSha = pullRequest?.headSha?.trim() || null;
        reviewStaleHeadCheckError = null;
        return currentHeadSha;
      } catch (error) {
        reviewStaleHeadCheckError =
          error instanceof Error
            ? error.message
            : "Failed to load current PR head SHA";
        return null;
      }
    };

    const completeStalePrReviewCheckRun = async (currentHeadSha: string) => {
      if (!reviewCheckRunId) return false;

      const summary = `Mogplex skipped publishing this review because the PR head changed from ${reviewHeadSha} to ${currentHeadSha}.`;

      try {
        const updatedCheckRun = await deps.completePrReviewCheckRun({
          githubToken,
          repoFullName: context.repo.full_name,
          checkRunId: reviewCheckRunId,
          conclusion: "success",
          title: "Review skipped",
          summary,
          text: summary,
          detailsUrl: reviewCheckDetailsUrl,
        });
        reviewCheckRunCompleted = true;
        reviewCheckRunConclusion = "success";
        reviewCheckRunUrl = updatedCheckRun.htmlUrl ?? reviewCheckRunUrl;
        reviewCheckRunError = null;
        return true;
      } catch (error) {
        reviewCheckRunError =
          error instanceof Error
            ? error.message
            : "Failed to update GitHub check run";
        return false;
      }
    };

    const publishPrReviewCheckRun = async (input: {
      reviewHarnessResult: PrReviewHarnessResult | null;
      reviewOutcome: ReviewOutcome | null;
      fallbackText: string | null | undefined;
      conclusion: PrReviewConclusion;
      failureDetails?: PrReviewFailureDetails | null;
    }) => {
      if (!reviewCheckRunId) return false;
      if (
        reviewCheckRunCompleted &&
        reviewCheckRunConclusion === input.conclusion
      )
        return true;

      try {
        const updatedCheckRun = await deps.completePrReviewCheckRun({
          githubToken,
          repoFullName: context.repo.full_name,
          checkRunId: reviewCheckRunId,
          conclusion: input.conclusion,
          title: buildPrReviewCheckTitle({
            harnessResult: input.reviewHarnessResult,
            conclusion: input.conclusion,
          }),
          summary: buildPrReviewCheckSummary({
            harnessResult: input.reviewHarnessResult,
            fallbackText: input.fallbackText,
            conclusion: input.conclusion,
            failureDetails: input.failureDetails,
          }),
          text: buildPrReviewCheckText({
            harnessResult: input.reviewHarnessResult,
            fallbackText: input.fallbackText,
            conclusion: input.conclusion,
            failureDetails: input.failureDetails,
          }),
          detailsUrl: reviewCheckDetailsUrl,
        });
        reviewCheckRunCompleted = true;
        reviewCheckRunConclusion = input.conclusion;
        reviewCheckRunUrl = updatedCheckRun.htmlUrl ?? reviewCheckRunUrl;
        reviewCheckRunError = null;
        return true;
      } catch (error) {
        reviewCheckRunError =
          error instanceof Error
            ? error.message
            : "Failed to update GitHub check run";
        return false;
      }
    };

    const publishPrReviewTimelineComment = async (input: {
      reviewHarnessResult: PrReviewHarnessResult | null;
      reviewOutcome: ReviewOutcome | null;
      fallbackText: string | null | undefined;
      conclusion: PrReviewConclusion;
      failureDetails?: PrReviewFailureDetails | null;
    }) => {
      if (!isPrReview || reviewPrNumber == null) return false;

      try {
        const comment = await deps.upsertPrReviewTimelineComment({
          githubToken,
          repoFullName: context.repo.full_name,
          prNumber: reviewPrNumber,
          body: buildPrReviewTimelineCommentBody({
            harnessResult: input.reviewHarnessResult,
            fallbackText: input.fallbackText,
            conclusion: input.conclusion,
            checkRunUrl: reviewCheckRunUrl,
            failureDetails: input.failureDetails,
          }),
        });
        reviewTimelineCommentPublished = true;
        reviewTimelineCommentId = comment.id;
        reviewTimelineCommentUrl = comment.htmlUrl;
        reviewTimelineCommentError = null;
        return true;
      } catch (error) {
        reviewTimelineCommentError =
          error instanceof Error
            ? error.message
            : "Failed to publish PR timeline comment";
        return false;
      }
    };

    const clearStalePrReviewTimelineComment = async () => {
      if (!isPrReview || reviewPrNumber == null) return false;

      try {
        const cleared = await deps.clearPrReviewTimelineComment({
          githubToken,
          repoFullName: context.repo.full_name,
          prNumber: reviewPrNumber,
        });

        if (cleared.deleted) {
          reviewTimelineCommentPublished = false;
          reviewTimelineCommentId = null;
          reviewTimelineCommentUrl = null;
        }

        reviewTimelineCommentError = null;
        return cleared.deleted;
      } catch (error) {
        reviewTimelineCommentError =
          error instanceof Error
            ? error.message
            : "Failed to clear stale GitHub timeline comment";
        return false;
      }
    };

    const publishPrReviewGithubReview = async (input: {
      reviewHarnessResult: PrReviewHarnessResult | null;
      reviewOutcome: ReviewOutcome | null;
      conclusion: PrReviewConclusion;
    }) => {
      const reviewOutcome = input.reviewOutcome;

      if (
        !isPrReview ||
        reviewPrNumber == null ||
        reviewHeadSha.length === 0 ||
        input.reviewHarnessResult?.source !== "structured" ||
        !reviewOutcome?.hasIssues
      ) {
        return false;
      }

      const inlineComments = buildPrReviewInlineComments(
        reviewOutcome.findings
      );
      const publishReview = (comments: typeof inlineComments) =>
        deps.createPrReviewGithubReview({
          githubToken,
          repoFullName: context.repo.full_name,
          prNumber: reviewPrNumber,
          commitId: reviewHeadSha,
          body: buildPrReviewGithubReviewBody({
            reviewOutcome,
            conclusion: input.conclusion,
            checkRunUrl: reviewCheckRunUrl,
            inlineCommentCount: comments.length,
            autofix: input.reviewHarnessResult?.autofix ?? null,
          }),
          comments,
        });

      try {
        const review = await publishReview(inlineComments);
        reviewGithubReviewPublished = true;
        reviewGithubReviewId = review.id;
        reviewGithubReviewUrl = review.htmlUrl;
        reviewGithubReviewError = null;
        reviewGithubInlineCommentCount = inlineComments.length;
        return true;
      } catch (error) {
        let publishError: unknown = error;

        if (
          inlineComments.length > 0 &&
          shouldRetryPrReviewWithoutInlineComments(publishError)
        ) {
          try {
            const review = await publishReview([]);
            reviewGithubReviewPublished = true;
            reviewGithubReviewId = review.id;
            reviewGithubReviewUrl = review.htmlUrl;
            reviewGithubReviewError = null;
            reviewGithubInlineCommentCount = 0;
            return true;
          } catch (retryError) {
            publishError = retryError;
          }
        }

        reviewGithubReviewError =
          publishError instanceof Error
            ? publishError.message
            : "Failed to publish PR review";
        reviewGithubInlineCommentCount = inlineComments.length;
        return false;
      }
    };

    const finalizePrReviewSuccess = async (input: {
      jobRunId: string;
      result: AutomationAgentResult;
      reviewHarnessResult: PrReviewHarnessResult | null;
      reviewOutcome: ReviewOutcome | null;
      reviewCommentPosted: boolean;
      execution: AutomationModelExecutionMetadata | null | undefined;
    }) => {
      const reviewSummary =
        input.reviewOutcome?.summary ?? input.result.text ?? "";
      const requiresReviewCheckRun = reviewHeadSha.length > 0;
      const reviewConclusion = input.reviewOutcome?.hasIssues
        ? "neutral"
        : "success";
      const currentHeadSha = await loadCurrentPrReviewHeadSha();
      const isStaleHeadSha =
        reviewHeadSha.length > 0 &&
        currentHeadSha !== null &&
        currentHeadSha !== reviewHeadSha;

      if (isStaleHeadSha) {
        const reviewCheckPublished =
          await completeStalePrReviewCheckRun(currentHeadSha);

        if (requiresReviewCheckRun && !reviewCheckPublished) {
          return {
            ok: false as const,
            error: reviewCheckRunError
              ? `GitHub check run publish failed: ${reviewCheckRunError}`
              : "GitHub check run publish failed: stale review check run was not completed",
          };
        }

        const reviewReason = PR_REVIEW_REASON_CODES.staleHeadSha;

        return {
          ok: true as const,
          reviewReason,
          metadata: {
            review_outcome: reviewReason,
            review_outcome_label: formatAutomationReasonLabel(reviewReason),
            review_has_issues: input.reviewOutcome?.hasIssues ?? false,
            review_summary: reviewSummary,
            review_affected_files: input.reviewOutcome?.affectedFiles ?? [],
            review_comment_posted: false,
            review_timeline_comment_posted: false,
            review_timeline_comment_id: null,
            review_timeline_comment_url: null,
            review_timeline_comment_error: null,
            review_github_review_posted: false,
            review_github_review_id: null,
            review_github_review_url: null,
            review_github_review_error: null,
            review_github_inline_comments_count: 0,
            review_check_run_id: reviewCheckRunId,
            review_check_run_url: reviewCheckRunUrl,
            review_check_run_completed: reviewCheckPublished,
            review_check_run_conclusion: reviewCheckRunConclusion,
            review_check_run_error: reviewCheckRunError,
            review_findings_persisted: false,
            review_findings_count: 0,
            review_findings_persist_error: null,
            review_head_sha: reviewHeadSha,
            review_current_head_sha: currentHeadSha,
            review_stale_head_check_error: reviewStaleHeadCheckError,
            ...buildAutomationExecutionMetadataFields(input.execution),
          },
        };
      }

      const reviewCheckPublished = await publishPrReviewCheckRun({
        reviewHarnessResult: input.reviewHarnessResult,
        reviewOutcome: input.reviewOutcome,
        fallbackText: input.result.text,
        conclusion: reviewConclusion,
      });
      const githubReviewPublished = await publishPrReviewGithubReview({
        reviewHarnessResult: input.reviewHarnessResult,
        reviewOutcome: input.reviewOutcome,
        conclusion: reviewConclusion,
      });
      if (
        input.reviewHarnessResult?.source === "structured" &&
        input.reviewOutcome?.hasIssues &&
        githubReviewPublished
      ) {
        // Native GitHub reviews are the canonical success surface for findings.
        // Remove any older marker comment so the PR shows a single review.
        await clearStalePrReviewTimelineComment();
      }
      const requiresReviewTimelineComment =
        reviewPrNumber != null &&
        (!input.reviewOutcome?.hasIssues || !githubReviewPublished);
      const timelineCommentPublished = requiresReviewTimelineComment
        ? await publishPrReviewTimelineComment({
            reviewHarnessResult: input.reviewHarnessResult,
            reviewOutcome: input.reviewOutcome,
            fallbackText: input.result.text,
            conclusion: reviewConclusion,
          })
        : false;
      let reviewFindingsPersisted = false;
      let reviewFindingsCount: number;
      let reviewFindingsPersistError: string | null = null;

      try {
        const persistedReviewFindings = await deps.persistJobReviewFindings({
          userId: context.repo.user_id,
          jobRunId: input.jobRunId,
          repoId: context.repo.id,
          repoFullName: context.repo.full_name,
          prNumber: reviewPrNumber,
          headSha: reviewHeadSha.length > 0 ? reviewHeadSha : null,
          findings: input.reviewOutcome?.findings ?? [],
        });
        reviewFindingsPersisted = persistedReviewFindings.persisted;
        reviewFindingsCount = persistedReviewFindings.count;
      } catch (error) {
        reviewFindingsPersistError =
          error instanceof Error
            ? error.message
            : "Failed to persist review findings";
        reviewFindingsCount = input.reviewOutcome?.findings.length ?? 0;
        console.error("[automation-job] failed to persist review findings", {
          jobRunId: input.jobRunId,
          repoId: context.repo.id,
          error: reviewFindingsPersistError,
        });
      }

      const publishErrors = [
        requiresReviewCheckRun && !reviewCheckPublished
          ? reviewCheckRunError
            ? `GitHub check run publish failed: ${reviewCheckRunError}`
            : "GitHub check run publish failed: required check run was not completed"
          : null,
        requiresReviewTimelineComment && !timelineCommentPublished
          ? reviewTimelineCommentError
            ? `GitHub timeline comment publish failed: ${reviewTimelineCommentError}`
            : "GitHub timeline comment publish failed: required timeline comment was not published"
          : null,
      ].filter(Boolean) as string[];

      if (publishErrors.length > 0) {
        return {
          ok: false as const,
          error: publishErrors.join("; "),
        };
      }

      const reviewReason = input.reviewOutcome?.hasIssues
        ? PR_REVIEW_REASON_CODES.posted
        : PR_REVIEW_REASON_CODES.noFindings;

      return {
        ok: true as const,
        reviewReason,
        metadata: {
          review_outcome: reviewReason,
          review_outcome_label: formatAutomationReasonLabel(reviewReason),
          review_has_issues: input.reviewOutcome?.hasIssues ?? false,
          review_summary: reviewSummary,
          review_affected_files: input.reviewOutcome?.affectedFiles ?? [],
          review_comment_posted: input.reviewCommentPosted,
          review_timeline_comment_posted: timelineCommentPublished,
          review_timeline_comment_id: reviewTimelineCommentId,
          review_timeline_comment_url: reviewTimelineCommentUrl,
          review_timeline_comment_error: reviewTimelineCommentError,
          review_github_review_posted: reviewGithubReviewPublished,
          review_github_review_id: reviewGithubReviewId,
          review_github_review_url: reviewGithubReviewUrl,
          review_github_review_error: reviewGithubReviewError,
          review_github_inline_comments_count: reviewGithubInlineCommentCount,
          review_check_run_id: reviewCheckRunId,
          review_check_run_url: reviewCheckRunUrl,
          review_check_run_completed: reviewCheckPublished,
          review_check_run_conclusion: reviewCheckRunConclusion,
          review_check_run_error: reviewCheckRunError,
          review_findings_persisted: reviewFindingsPersisted,
          review_findings_count: reviewFindingsCount,
          review_findings_persist_error: reviewFindingsPersistError,
          ...buildAutomationExecutionMetadataFields(input.execution),
        },
      };
    };

    const failJob = async (
      message: string,
      failureContext: JobContext = context,
      failureStartedAt = startedAt,
      inputTokens: number | null = null,
      outputTokens: number | null = null,
      execution: AutomationModelExecutionMetadata | null = null,
      options: {
        toolCalls?: Array<{
          name: string;
          input?: unknown;
          output?: unknown;
          input_preview?: string;
          output_preview?: string;
        }>;
        aiCallTelemetryHandled?: boolean;
      } = {}
    ) => {
      const genericFailureReason = classifyAutomationFailureReason({
        message,
        execution,
      });
      const reviewFailureReason = isPrReview
        ? classifyPrReviewFailureReason(message, execution)
        : null;
      const displayMessage = buildAutomationFailureDisplayMessage({
        message,
        assignmentType: failureContext.assignmentType,
        execution,
        runtime,
      });
      const modelFailure = buildAutomationJobModelFailureDiagnostics(execution);
      const reviewFailureDetails = isPrReview
        ? buildPrReviewFailureDetails({
            reason: reviewFailureReason ?? genericFailureReason,
            message: displayMessage,
            rawMessage: message,
            execution,
            runtime,
          })
        : null;

      if (isPrReview) {
        // Failure updates the status surfaces only; native GitHub reviews are
        // reserved for successful review findings with inline anchors.
        await publishPrReviewCheckRun({
          reviewHarnessResult: null,
          reviewOutcome: null,
          fallbackText: displayMessage,
          conclusion: "failure",
          failureDetails: reviewFailureDetails,
        });
        await publishPrReviewTimelineComment({
          reviewHarnessResult: null,
          reviewOutcome: null,
          fallbackText: displayMessage,
          conclusion: "failure",
          failureDetails: reviewFailureDetails,
        });
      }

      const durationMs = await deps.getDurationMs(startedAt);
      const failureDurationMs =
        Date.now() - new Date(failureStartedAt).getTime();
      const persisted = await deps.persistJobFailure({
        jobRunId: input.jobRunId,
        error: displayMessage,
        durationMs,
      });
      if (!persisted) {
        return {
          success: false as const,
          error: JOB_RUN_CANCELLED,
          observabilityError: null,
        };
      }
      const failureDispatchContext = buildDispatchLogContext({
        releasedScope: input.releasedScope,
        context: failureContext,
        resolvedFlow: resolved.flow ?? null,
      });
      const genericFailureMetadata = {
        error: displayMessage,
        review_timeline_comment_posted: reviewTimelineCommentPublished,
        review_timeline_comment_id: reviewTimelineCommentId,
        review_timeline_comment_url: reviewTimelineCommentUrl,
        review_timeline_comment_error: reviewTimelineCommentError,
        review_github_review_posted: reviewGithubReviewPublished,
        review_github_review_id: reviewGithubReviewId,
        review_github_review_url: reviewGithubReviewUrl,
        review_github_review_error: reviewGithubReviewError,
        review_github_inline_comments_count: reviewGithubInlineCommentCount,
        review_check_run_id: reviewCheckRunId,
        review_check_run_url: reviewCheckRunUrl,
        review_check_run_completed: reviewCheckRunCompleted,
        review_check_run_conclusion: reviewCheckRunConclusion,
        review_check_run_error: reviewCheckRunError,
        ...buildAutomationRuntimeMetadataFields(runtime),
        ...buildAutomationExecutionMetadataFields(execution),
      };
      const usePrReviewFailureReason =
        reviewFailureReason &&
        isPrReviewSourceType(failureDispatchContext.sourceType);
      await deps.recordControlDispatchEvent({
        context: failureDispatchContext,
        jobRunId: input.jobRunId,
        outcome: "failed",
        reason: usePrReviewFailureReason
          ? reviewFailureReason
          : genericFailureReason,
        metadata: usePrReviewFailureReason
          ? {
              review_outcome: reviewFailureReason,
              review_outcome_label:
                formatAutomationReasonLabel(reviewFailureReason),
              ...genericFailureMetadata,
            }
          : genericFailureMetadata,
      });
      await persistAutomationOutcomeMemory({
        context: failureContext,
        jobRunId: input.jobRunId,
        outcome: "failed",
        summary: `${normalizeAutomationAssignmentType(
          failureContext.assignmentType
        )} failed: ${displayMessage.slice(0, 240)}`,
        reason: usePrReviewFailureReason
          ? reviewFailureReason
          : genericFailureReason,
        execution,
      });
      // Failed flow nodes record their own ai_calls row. Creating an additional
      // job-level row would duplicate usage and cost. Failures that happen
      // outside node model telemetry still rely on this outer write.
      let observabilityError: string | null = null;
      if (!options.aiCallTelemetryHandled) {
        const loggedUsage = resolveAutomationAiCallUsage({
          inputTokens,
          outputTokens,
          execution,
        });
        observabilityError = await deps.tryLogAiCall({
          context: failureContext,
          jobRunId: input.jobRunId,
          status: "failed",
          startedAt: failureStartedAt,
          durationMs: Math.max(failureDurationMs, 0),
          inputTokens: loggedUsage.inputTokens,
          outputTokens: loggedUsage.outputTokens,
          error: displayMessage,
          execution,
          toolCalls: options.toolCalls,
        });
      }
      await deps.releaseQueuedJobs({
        jobRunId: input.jobRunId,
        releasedScope: input.releasedScope,
      });
      return {
        success: false as const,
        error: displayMessage,
        observabilityError,
        ...(modelFailure ? { modelFailure } : {}),
      };
    };

    if (resolved.flow) {
      const flowExecution = await executeResolvedFlow({
        jobRunId: input.jobRunId,
        context,
        githubToken,
        resolvedFlow: resolved.flow,
        deps,
      });
      if (!flowExecution.success) {
        if (flowExecution.message === JOB_RUN_CANCELLED) {
          await deps.releaseQueuedJobs({
            jobRunId: input.jobRunId,
            releasedScope: input.releasedScope,
          });
          return {
            success: false,
            error: JOB_RUN_CANCELLED,
            observabilityError: flowExecution.observabilityError,
          };
        }

        const failure = await failJob(
          flowExecution.message,
          flowExecution.context,
          startedAt,
          null,
          null,
          "execution" in flowExecution &&
            flowExecution.execution &&
            typeof flowExecution.execution === "object" &&
            "phase" in flowExecution.execution
            ? (flowExecution.execution as AutomationModelExecutionMetadata)
            : null,
          {
            aiCallTelemetryHandled:
              flowExecution.aiCallTelemetryHandled === true,
          }
        );
        return {
          ...failure,
          observabilityError:
            failure.observabilityError ?? flowExecution.observabilityError,
        };
      }

      const finalResult = flowExecution.result;
      const reviewHarnessResult = isPrReview
        ? extractPrReviewHarnessResult(finalResult)
        : null;
      const reviewOutcome = reviewHarnessResult?.reviewOutcome ?? null;
      const reviewCommentPosted = isPrReview
        ? hasToolCall(finalResult, "postComment")
        : false;
      if (await deps.isJobRunCancellationRequested(input.jobRunId)) {
        await deps.releaseQueuedJobs({
          jobRunId: input.jobRunId,
          releasedScope: input.releasedScope,
        });
        return {
          success: false,
          error: JOB_RUN_CANCELLED,
          observabilityError: flowExecution.observabilityError,
        };
      }

      const durationMs = await deps.getDurationMs(startedAt);
      const persisted = await deps.persistJobSuccess({
        jobRunId: input.jobRunId,
        inputTokens: finalResult.usage?.inputTokens ?? null,
        outputTokens: finalResult.usage?.outputTokens ?? null,
        durationMs,
      });
      if (!persisted) {
        return {
          success: false,
          error: JOB_RUN_CANCELLED,
          observabilityError: flowExecution.observabilityError,
        };
      }
      if (isPrReview) {
        const finalizedReview = await finalizePrReviewSuccess({
          jobRunId: input.jobRunId,
          result: finalResult,
          reviewHarnessResult,
          reviewOutcome,
          reviewCommentPosted,
          execution: finalResult.execution,
        });
        if (!finalizedReview.ok) {
          return failJob(
            finalizedReview.error,
            context,
            startedAt,
            finalResult.usage?.inputTokens ?? null,
            finalResult.usage?.outputTokens ?? null,
            finalResult.execution ?? null,
            { aiCallTelemetryHandled: true }
          );
        }
        prReviewCompletionReason = finalizedReview.reviewReason;
        // The review check run for this head SHA is completed now, so a
        // repo that requires it can report the PR as clean. expectedHeadSha
        // refuses the merge if commits landed after the reviewed head.
        const autoMergeBlockReason = flowExecution.autoMergeRequest
          ? (getPrReviewAutoMergeBlockReason({
              reviewOutcome,
              requestedPrNumber: flowExecution.autoMergeRequest.prNumber,
              reviewedPrNumber: resolvePullRequestNumber(context.metadata),
            }) ??
            getAutoMergeHeadBlockReason(
              context.metadata,
              flowExecution.autoMergeRequest.prNumber,
              flowExecution.autoMergeRequest.expectedHeadSha
            ))
          : null;
        const autoMerge = flowExecution.autoMergeRequest
          ? autoMergeBlockReason
            ? { merged: false, reason: autoMergeBlockReason }
            : await attemptFlowAutoMerge({
                jobRunId: input.jobRunId,
                repoFullName: context.repo.full_name,
                prNumber: flowExecution.autoMergeRequest.prNumber,
                githubToken,
                expectedHeadSha: flowExecution.autoMergeRequest.expectedHeadSha,
                commitTitle: flowExecution.autoMergeRequest.commitTitle,
              })
          : null;
        await deps.recordControlDispatchEvent({
          context: dispatchLogContext,
          jobRunId: input.jobRunId,
          outcome: "completed",
          reason: finalizedReview.reviewReason,
          metadata: {
            ...finalizedReview.metadata,
            ...(autoMerge ? { auto_merge: autoMerge } : {}),
          },
        });
      } else {
        // Non-pr_review jobs never create a review check run, so there is
        // nothing to wait for before honoring the merge request.
        const autoMergeBlockReason = flowExecution.autoMergeRequest
          ? getAutoMergeHeadBlockReason(
              context.metadata,
              flowExecution.autoMergeRequest.prNumber,
              flowExecution.autoMergeRequest.expectedHeadSha
            )
          : null;
        const autoMerge = flowExecution.autoMergeRequest
          ? autoMergeBlockReason
            ? { merged: false, reason: autoMergeBlockReason }
            : await attemptFlowAutoMerge({
                jobRunId: input.jobRunId,
                repoFullName: context.repo.full_name,
                prNumber: flowExecution.autoMergeRequest.prNumber,
                githubToken,
                expectedHeadSha: flowExecution.autoMergeRequest.expectedHeadSha,
                commitTitle: flowExecution.autoMergeRequest.commitTitle,
              })
          : null;
        await deps.recordControlDispatchEvent({
          context: dispatchLogContext,
          jobRunId: input.jobRunId,
          outcome: "completed",
          reason: AUTOMATION_REASON_CODES.completed,
          metadata: {
            automation_output_summary: summarizeNodeOutput(finalResult.text),
            ...buildAutomationExecutionMetadataFields(finalResult.execution),
            ...(autoMerge ? { auto_merge: autoMerge } : {}),
          },
        });
      }
      await persistAutomationOutcomeMemory({
        context,
        jobRunId: input.jobRunId,
        outcome: "completed",
        summary: `${normalizeAutomationAssignmentType(
          context.assignmentType
        )}: ${summarizeNodeOutput(finalResult.text)}`,
        reason: isPrReview
          ? (prReviewCompletionReason ??
            (reviewOutcome?.hasIssues
              ? PR_REVIEW_REASON_CODES.posted
              : PR_REVIEW_REASON_CODES.noFindings))
          : AUTOMATION_REASON_CODES.completed,
        execution: finalResult.execution ?? null,
      });
      await deps.releaseQueuedJobs({
        jobRunId: input.jobRunId,
        releasedScope: input.releasedScope,
      });

      return {
        success: true,
        output: finalResult.text,
        observabilityError: flowExecution.observabilityError,
      };
    }

    let finalResult: Awaited<ReturnType<typeof runAutomationAgent>>;
    try {
      await deps.throwIfJobRunCancelled(input.jobRunId);
      finalResult = await executeAutomationContext({
        jobRunId: input.jobRunId,
        context,
        githubToken,
        deps,
        allowAutofix: false,
      });
    } catch (error) {
      if (error instanceof JobRunCancelledError) {
        await deps.releaseQueuedJobs({
          jobRunId: input.jobRunId,
          releasedScope: input.releasedScope,
        });
        return {
          success: false,
          error: JOB_RUN_CANCELLED,
        };
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      return failJob(
        message,
        context,
        startedAt,
        null,
        null,
        isAutomationModelExecutionError(error) ? error.metadata : null
      );
    }

    if (await deps.isJobRunCancellationRequested(input.jobRunId)) {
      await deps.releaseQueuedJobs({
        jobRunId: input.jobRunId,
        releasedScope: input.releasedScope,
      });
      return {
        success: false,
        error: JOB_RUN_CANCELLED,
      };
    }

    const durationMs = await deps.getDurationMs(startedAt);
    const inputTokens = finalResult.usage?.inputTokens ?? null;
    const outputTokens = finalResult.usage?.outputTokens ?? null;
    const toolCalls = extractToolCalls(finalResult);
    const reviewHarnessResult = isPrReview
      ? extractPrReviewHarnessResult(finalResult)
      : null;
    const reviewOutcome = reviewHarnessResult?.reviewOutcome ?? null;
    const reviewCommentPosted = isPrReview
      ? hasToolCall(finalResult, "postComment")
      : false;

    const persisted = await deps.persistJobSuccess({
      jobRunId: input.jobRunId,
      inputTokens,
      outputTokens,
      durationMs,
    });
    if (!persisted) {
      return {
        success: false,
        error: JOB_RUN_CANCELLED,
      };
    }
    if (isPrReview) {
      const finalizedReview = await finalizePrReviewSuccess({
        jobRunId: input.jobRunId,
        result: finalResult,
        reviewHarnessResult,
        reviewOutcome,
        reviewCommentPosted,
        execution: finalResult.execution,
      });
      if (!finalizedReview.ok) {
        return failJob(
          finalizedReview.error,
          context,
          startedAt,
          inputTokens,
          outputTokens,
          finalResult.execution ?? null,
          { toolCalls }
        );
      }
      prReviewCompletionReason = finalizedReview.reviewReason;
      await deps.recordControlDispatchEvent({
        context: dispatchLogContext,
        jobRunId: input.jobRunId,
        outcome: "completed",
        reason: finalizedReview.reviewReason,
        metadata: finalizedReview.metadata,
      });
    } else {
      await deps.recordControlDispatchEvent({
        context: dispatchLogContext,
        jobRunId: input.jobRunId,
        outcome: "completed",
        reason: AUTOMATION_REASON_CODES.completed,
        metadata: {
          automation_output_summary: summarizeNodeOutput(finalResult.text),
          ...buildAutomationExecutionMetadataFields(finalResult.execution),
        },
      });
    }
    await persistAutomationOutcomeMemory({
      context,
      jobRunId: input.jobRunId,
      outcome: "completed",
      summary: `${normalizeAutomationAssignmentType(
        context.assignmentType
      )}: ${summarizeNodeOutput(finalResult.text)}`,
      reason: isPrReview
        ? (prReviewCompletionReason ??
          (reviewOutcome?.hasIssues
            ? PR_REVIEW_REASON_CODES.posted
            : PR_REVIEW_REASON_CODES.noFindings))
        : AUTOMATION_REASON_CODES.completed,
      execution: finalResult.execution ?? null,
    });
    const observabilityError = await deps.tryLogAiCall({
      context,
      jobRunId: input.jobRunId,
      status: "success",
      startedAt,
      durationMs,
      inputTokens,
      outputTokens,
      toolCalls,
      execution: finalResult.execution ?? null,
    });
    await deps.releaseQueuedJobs({
      jobRunId: input.jobRunId,
      releasedScope: input.releasedScope,
    });

    return { success: true, output: finalResult.text, observabilityError };
  };
}

export const executeAutomationJobRun = createAutomationJobExecutor();

export function createAutomationJobTask(
  overrides: Partial<AutomationJobExecutorDeps> = {}
) {
  const execute = createAutomationJobExecutor(overrides);

  return async function automationJobTask(
    input: AutomationJobInput
  ): Promise<AutomationJobRunResult> {
    return execute(input);
  };
}

export const automationJobTask = createAutomationJobTask();
