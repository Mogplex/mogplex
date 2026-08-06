import { generateText, stepCountIs, type ToolSet } from "ai";
import path from "node:path";
import { runs, tasks } from "@trigger.dev/sdk/v3";
import { buildPRFixTools, buildSandboxPRFixTools } from "@/lib/agents/pr-fixer";
import { buildPRReviewTools } from "@/lib/agents/pr-reviewer";
import { buildPrReviewRunSpec } from "@/lib/agents/pr-review-run-spec";
import { buildIssueTools } from "@/lib/agents/issue-tools";
import { buildCITools } from "@/lib/agents/ci-tools";
import { buildTagPushTools } from "@/lib/agents/tag-tools";
import { buildCommentTools } from "@/lib/agents/comment-tools";
import { buildRefactorTools } from "@/lib/agents/refactor";
import { getGithubAccessTokenForRepo } from "@/lib/github-access";
import { extractGithubApiErrorMessage } from "@/lib/github-create";
import { createGithubInstallationAccessToken } from "@/lib/github-app";
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
import { replaceJobRunReviewFindings } from "@/lib/review-findings";
import { isTriggerRuntimeConfigured } from "@/lib/runtime-providers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildInternalApiHeaders } from "@/lib/internal-api-auth";
import { loadOwnedSandboxRouteContext } from "@/lib/sandbox/route-context";
import { createHarnessOutputRenderer } from "@/lib/harness/output-renderer";
import type { HarnessId } from "@/lib/harness/config";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import { logAutomationDispatchEvent } from "@/lib/automation-dispatch";
import {
  loadToolApprovalSpentWaitMs,
  supabaseWaitStore,
  triggerWaitProvider,
} from "@/lib/flows/wait-service";
import {
  createGithubIssueAction,
  postGithubComment,
  setGithubCommitStatus,
  submitGithubPullRequestReview,
  updateGithubLabels,
} from "@/lib/flows/github-actions";
import {
  resolveToolApprovalContext,
  wrapToolsWithApprovalGate,
} from "@/lib/flows/tool-approval";
import { getEffectiveFlowAgentMaxSteps } from "@/lib/flows/agent-defaults";
import { getFlowOperator } from "@/lib/flows/operators/registry";
import type {
  FlowOperatorEmission,
  FlowOperatorEmittedToken,
  FlowOperatorExecuteContext,
  FlowOperatorExecuteResult,
  FlowOperatorActionResult,
  FlowOperatorWaitProvider,
  FlowOperatorWaitStore,
} from "@/lib/flows/operators/types";
import { getSlackBotToken, postSlackMessage } from "@/lib/slack/client";
import { getSlackInstallationByTeamId } from "@/lib/slack/installations";
import {
  AUTOMATION_REASON_CODES,
  PR_REVIEW_REASON_CODES,
  classifyAutomationFailureReason,
  formatAutomationReasonLabel,
  isPrReviewSourceType,
} from "@/lib/automation-review";
import { resolveUserLanguageModel } from "@/lib/ai-model-resolver";
import {
  gatewayProviderOptions,
  withGatewaySystemCaching,
  type GatewayCallContext,
} from "@/lib/models/gateway-provider-routing";
import { resolveRuntimeModelId } from "@/lib/models/supersession-runtime";
import {
  loadTeamAllowlistState,
  type TeamAllowlistState,
} from "@/lib/team-capabilities";
import {
  capturedUsageAiCallColumns,
  EMPTY_CAPTURED_USAGE,
  fillUsageGaps,
  hasCapturedUsage,
  mergeUsage,
  type CapturedUsage,
} from "@/lib/observability/usage";
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
  previewTelemetryValue,
  sanitizeTelemetryValue as sanitizeToolPayload,
} from "@/lib/ai-telemetry";
import {
  AUTOMATION_LIMITS,
  describeStartGuardReason,
  loadAutomationScopeForJobRun,
  loadAutomationScopesByStatus,
  selectQueuedJobsToStart,
} from "@/lib/workflows/automation-guardrails";
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
import {
  classifyAutomationInfrastructureFailure,
  formatAutomationInfrastructureFailureLabel,
} from "@/lib/workflows/automation-infra-failures";
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
import type { ResolvedUserLanguageModel } from "@/lib/ai-model-resolver";
import type { BackgroundRuntimeProvider } from "@/lib/runtime-providers";
import type {
  AutomationScope,
  StartGuardReason,
} from "@/lib/workflows/automation-guardrails";
import type {
  FlowAgentNodeRole,
  FlowActionNodeData,
  FlowGraph,
  FlowNode,
  ReviewFinding,
  SandboxRecord,
} from "@/lib/types";
import type { JobRunStartSource } from "@/lib/job-runs";

export type AutomationJobInput = {
  jobRunId: string;
  startedAt: string;
  releasedScope: ReleasedAutomationScope;
};

export type ReleasedAutomationScope = Pick<
  AutomationScope,
  "sourceKind" | "sourceType" | "sourceId" | "repoId" | "installationId"
>;

export type AutomationJobModelFailureDiagnostics = {
  phase: string;
  failureClass: NonNullable<
    AutomationModelExecutionMetadata["finalFailureClass"]
  >;
  statusCode: number | null;
  attempts: number;
  retryCount: number;
};

export type AutomationJobRunResult =
  | {
      success: true;
      output: string;
      observabilityError: string | null;
    }
  | {
      success: false;
      error: string;
      observabilityError?: string | null;
      modelFailure?: AutomationJobModelFailureDiagnostics;
    };

type JobContext = {
  metadata: Record<string, unknown>;
  assignmentType: string;
  skillId: string | null;
  agent: {
    id?: string;
    name?: string | null;
    slug?: string | null;
    model: string;
    system_prompt: string | null;
    max_steps?: number | null;
    timeout_ms?: number | null;
  };
  repo: {
    id: string;
    user_id: string;
    full_name: string;
    default_branch?: string | null;
    github_installation_id?: number | null;
  };
};

// No `model` field: an agent contributes identity and prompt, never a model.
// The flow node supplies the model (see resolveFlowAgentOverrides).
type FlowAgentConfig = {
  id: string;
  name: string | null;
  slug: string | null;
  system_prompt: string | null;
  max_steps: number | null;
  timeout_ms: number | null;
};

type ResolvedFlowDefinition = {
  flowId: string;
  flowVersionId: string;
  graph: FlowGraph;
  agentsById: Map<string, FlowAgentConfig>;
};

type StartedAutomationJob = {
  started: boolean;
  notFound?: boolean;
  status?: string | null;
  runtimeProvider?: BackgroundRuntimeProvider;
  runtimeRunId?: string;
  workflowRunId?: string;
  deferred?: boolean;
  reason?: string | null;
};

type JobRunRuntimeDetails = {
  provider: BackgroundRuntimeProvider | null;
  runId: string | null;
};

const RUNTIME_HANDLE_PERSIST_FAILED = "RUNTIME_HANDLE_PERSIST_FAILED";
export const AUTOMATION_JOB_TRIGGER_MAX_ATTEMPTS = 1;
export const JOB_RUN_CANCELLED = "JOB_RUN_CANCELLED";
const INVALID_PR_REVIEW_CONTEXT = "Missing pull request context for PR review";
const GITHUB_PR_ACCESS_FAILURE_PREFIX = "GitHub PR access failed";
const AUTOMATION_GATEWAY_CACHING_ENV = "AUTOMATION_GATEWAY_CACHING";

export class JobRunCancelledError extends Error {
  constructor() {
    super(JOB_RUN_CANCELLED);
    this.name = "JobRunCancelledError";
  }
}

type ResolvedJobContext =
  | {
      context: JobContext;
      flow?: ResolvedFlowDefinition | null;
      runtime?: JobRunRuntimeDetails | null;
    }
  | { error: "JOB_NOT_FOUND" | "MISSING_CONFIG" };

type StartDispatchContext = {
  userId: string;
  assignmentId: string | null;
  triggerId: string | null;
  flowId: string | null;
  flowVersionId: string | null;
  repoId: string | null;
  installationId: number | null;
  sourceKind: "assignment" | "trigger" | "flow" | "manual_retry";
  sourceType: string;
};

type AutomationAgentUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
};

type AutomationAgentResult = {
  text: string;
  steps: Array<{
    toolCalls?: Array<{ toolName: string; input: unknown }>;
    toolResults?: unknown[];
  }>;
  usage: AutomationAgentUsage | null;
  execution?: AutomationModelExecutionMetadata | null;
  aiCallId?: string | null;
};

// Carries the model id that actually executed. It can differ from the pinned
// id when a deprecated pin was upgraded, and telemetry must record what ran —
// otherwise run history shows a retired model the run never used.
type AutomationLanguageModel = ResolvedUserLanguageModel & {
  effectiveModelId: string;
};

type PullRequestDetails = {
  number: number;
  title: string | null;
  body: string | null;
  headRef: string;
  headSha: string | null;
  headRepoFullName: string;
  baseRef: string;
  baseSha: string | null;
  baseRepoFullName: string;
};

type AutomationSandboxRef = {
  recordId: string;
  sandboxId: string | null;
  rootDirectory: string | null;
};

type AutofixSandboxRecord = {
  sandbox_id: string;
  repo_id: string;
  root_directory?: string | null;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
  preview_url?: string | null;
  repo?: {
    full_name?: string | null;
    root_directory?: string | null;
    sandbox_env_vars?: unknown;
    env_sync_mode?: unknown;
    vercel_project_id?: string | null;
    vercel_team_id?: string | null;
    github_installation_id?: number | null;
  } | null;
};

type DispatchLogContext = {
  userId: string;
  assignmentId: string | null;
  triggerId: string | null;
  flowId: string | null;
  flowVersionId: string | null;
  repoId: string | null;
  installationId: number | null;
  sourceKind: ReleasedAutomationScope["sourceKind"];
  sourceType: string;
};

type AutomationAgentDeps = {
  generateText: typeof generateText;
  // Wait infrastructure for mid-run tool-call approval. The runner derives
  // the approval context from flow metadata, so only flow agent nodes with
  // requireApproval ever touch these.
  waitProvider: FlowOperatorWaitProvider;
  waitStore: FlowOperatorWaitStore;
  loadApprovalSpentWaitMs: typeof loadToolApprovalSpentWaitMs;
};

const defaultAutomationAgentDeps: AutomationAgentDeps = {
  generateText,
  waitProvider: triggerWaitProvider,
  waitStore: supabaseWaitStore,
  loadApprovalSpentWaitMs: loadToolApprovalSpentWaitMs,
};

// Applies the tool-approval gate when the flow agent node opted in via
// requireApproval (stamped onto metadata by the agent-node executor). Runs
// without that flag pass tools through untouched.
function applyToolApprovalGate(
  tools: ToolSet,
  context: JobContext,
  deps: AutomationAgentDeps
): ToolSet {
  const approvalContext = resolveToolApprovalContext(context);
  if (!approvalContext) return tools;
  return wrapToolsWithApprovalGate(tools, approvalContext, {
    waitProvider: deps.waitProvider,
    waitStore: deps.waitStore,
    loadSpentWaitMs: deps.loadApprovalSpentWaitMs,
    // Waits must never outlast this loop's own generation window — an
    // in-wait deadline abort would fail the run instead of denying the call.
    generationTimeoutMs: getAutomationGenerateTimeoutMs(
      context.agent.timeout_ms
    ),
  });
}

function sumNullableNumbers(
  values: Array<number | null | undefined>
): number | null {
  const defined = values.filter(
    (value): value is number => typeof value === "number"
  );
  if (defined.length === 0) return null;
  return defined.reduce((total, value) => total + value, 0);
}

type FlowExecutionToken = {
  fromNodeId: string;
  label: string;
  text: string;
  skipped: boolean;
  payload?: Record<string, unknown> | null;
};

function splitRepoFullName(fullName: string) {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) return null;
  return { owner, repo };
}

function extractSandboxRef(record: unknown): AutomationSandboxRef | null {
  if (!record || typeof record !== "object") return null;
  const sandbox = record as Partial<SandboxRecord> & {
    runtime_summary?: { sandbox_id?: string | null };
  };
  if (typeof sandbox.id !== "string") return null;
  return {
    recordId: sandbox.id,
    sandboxId:
      typeof sandbox.sandbox_id === "string"
        ? sandbox.sandbox_id
        : (sandbox.runtime_summary?.sandbox_id ?? null),
    rootDirectory:
      typeof sandbox.root_directory === "string"
        ? sandbox.root_directory
        : null,
  };
}

function parseSseDataEvents(buffer: string) {
  const events: unknown[] = [];
  let remaining = buffer;
  let separatorIndex = remaining.indexOf("\n\n");
  while (separatorIndex !== -1) {
    const rawEvent = remaining.slice(0, separatorIndex);
    remaining = remaining.slice(separatorIndex + 2);
    const data = rawEvent
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n");
    if (data) {
      events.push(JSON.parse(data));
    }
    separatorIndex = remaining.indexOf("\n\n");
  }
  return { events, remaining };
}

async function readTextResponse(response: Response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function readJsonSandboxResponse(response: Response) {
  const payload = (await response.json()) as {
    sandbox?: unknown;
    error?: unknown;
  };
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "Sandbox launch failed"
    );
  }

  const sandbox = extractSandboxRef(payload.sandbox);
  if (!sandbox) {
    throw new Error("Sandbox launch response did not include a sandbox");
  }
  return sandbox;
}

async function readSandboxStreamResponse(response: Response) {
  if (!response.body) {
    throw new Error("Sandbox launch response did not include a stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let latestSandbox: AutomationSandboxRef | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseDataEvents(buffer);
    buffer = parsed.remaining;

    for (const event of parsed.events) {
      if (!event || typeof event !== "object") continue;
      const typedEvent = event as {
        type?: string;
        message?: string;
        sandbox?: unknown;
      };
      if (typedEvent.type === "error") {
        throw new Error(typedEvent.message || "Sandbox launch failed");
      }
      const sandbox = extractSandboxRef(typedEvent.sandbox);
      if (sandbox) latestSandbox = sandbox;
      if (typedEvent.type === "ready" && latestSandbox) {
        return latestSandbox;
      }
    }
  }

  if (!latestSandbox) {
    throw new Error("Sandbox launch stream ended before a sandbox was ready");
  }
  return latestSandbox;
}

function mergeAutomationExecutionMetadata(
  results: AutomationAgentResult[]
): AutomationModelExecutionMetadata | null {
  const executions = results
    .map((result) => result.execution)
    .filter(
      (execution): execution is AutomationModelExecutionMetadata =>
        execution != null
    );

  if (executions.length === 0) {
    return null;
  }

  const recoveredExecution =
    executions.find((execution) => execution.recoveredFromFailureClass) ?? null;
  const failedExecution =
    executions.find((execution) => execution.finalFailureClass) ?? null;
  const observedUsage = executions.reduce(
    (usage, execution) =>
      mergeUsage(usage, readAutomationExecutionObservedUsage(execution)),
    EMPTY_CAPTURED_USAGE
  );
  const distinctModelIds = (modelIds: Array<string | null | undefined>) => {
    const seen = new Set<string>();
    return modelIds.flatMap((modelId) => {
      const trimmed = modelId?.trim();
      if (!trimmed) return [];
      const normalized = trimmed.toLowerCase();
      if (seen.has(normalized)) return [];
      seen.add(normalized);
      return [trimmed];
    });
  };
  const requestedModelIds = distinctModelIds(
    executions.map((execution) => execution.requestedModelId)
  );
  const effectiveModelIds = distinctModelIds(
    executions.flatMap((execution) => execution.effectiveModelIds ?? [])
  );
  const gatewayModelAttempts = executions
    .flatMap((execution) => execution.gatewayModelAttempts ?? [])
    .slice(0, 50);
  const gatewayModelAttemptCount = executions.reduce(
    (total, execution) => total + (execution.gatewayModelAttemptCount ?? 0),
    0
  );
  const hasFallbackRouting = executions.some(
    (execution) => execution.fallbackUsed !== undefined
  );

  return {
    phase:
      executions.length === 1
        ? executions[0].phase
        : executions.map((execution) => execution.phase).join(","),
    attempts: executions.reduce(
      (total, execution) => total + execution.attempts,
      0
    ),
    retryCount: executions.reduce(
      (total, execution) => total + execution.retryCount,
      0
    ),
    retried: executions.some((execution) => execution.retried),
    effectiveTimeoutMs: Math.max(
      ...executions.map((execution) => execution.effectiveTimeoutMs)
    ),
    recoveredFromFailureClass:
      recoveredExecution?.recoveredFromFailureClass ?? null,
    recoveredFromMessage: recoveredExecution?.recoveredFromMessage ?? null,
    finalFailureClass: failedExecution?.finalFailureClass ?? null,
    finalFailureMessage: failedExecution?.finalFailureMessage ?? null,
    finalFailureStatusCode: failedExecution?.finalFailureStatusCode ?? null,
    ...(requestedModelIds.length === 1
      ? { requestedModelId: requestedModelIds[0] }
      : {}),
    ...(gatewayModelAttempts.length > 0 ? { gatewayModelAttempts } : {}),
    ...(gatewayModelAttemptCount > 0 ? { gatewayModelAttemptCount } : {}),
    ...(effectiveModelIds.length > 0 ? { effectiveModelIds } : {}),
    ...(hasFallbackRouting
      ? {
          fallbackUsed: executions.some(
            (execution) => execution.fallbackUsed === true
          ),
        }
      : {}),
    ...(hasCapturedUsage(observedUsage)
      ? {
          observedInputTokens: observedUsage.inputTokens,
          observedOutputTokens: observedUsage.outputTokens,
          observedUsage,
        }
      : {}),
  };
}

function buildAutomationExecutionMetadataFields(
  execution: AutomationModelExecutionMetadata | null | undefined
) {
  if (!execution) {
    return {};
  }

  return {
    model_execution_phase: execution.phase,
    model_attempts: execution.attempts,
    model_retry_attempted: execution.retried,
    model_retry_count: execution.retryCount,
    model_effective_timeout_ms: execution.effectiveTimeoutMs,
    model_recovered_from_failure_class: execution.recoveredFromFailureClass,
    model_recovered_from_message: execution.recoveredFromMessage,
    model_failure_class: execution.finalFailureClass,
    model_failure_message: execution.finalFailureMessage,
    model_failure_status_code: execution.finalFailureStatusCode,
    ...(execution.requestedModelId
      ? { model_requested: execution.requestedModelId }
      : {}),
    ...(execution.effectiveModelIds
      ? { model_effective_ids: execution.effectiveModelIds }
      : {}),
    ...(typeof execution.fallbackUsed === "boolean"
      ? { model_fallback_used: execution.fallbackUsed }
      : {}),
    ...(typeof execution.gatewayModelAttemptCount === "number"
      ? { gateway_model_attempt_count: execution.gatewayModelAttemptCount }
      : {}),
  };
}

function buildAutomationJobModelFailureDiagnostics(
  execution: AutomationModelExecutionMetadata | null | undefined
): AutomationJobModelFailureDiagnostics | null {
  if (!execution?.finalFailureClass) {
    return null;
  }

  return {
    phase: execution.phase,
    failureClass: execution.finalFailureClass,
    statusCode: execution.finalFailureStatusCode,
    attempts: execution.attempts,
    retryCount: execution.retryCount,
  };
}

function readAutomationExecutionObservedUsage(
  execution: AutomationModelExecutionMetadata | null | undefined
): CapturedUsage {
  return fillUsageGaps(execution?.observedUsage ?? EMPTY_CAPTURED_USAGE, {
    ...EMPTY_CAPTURED_USAGE,
    inputTokens:
      typeof execution?.observedInputTokens === "number"
        ? execution.observedInputTokens
        : null,
    outputTokens:
      typeof execution?.observedOutputTokens === "number"
        ? execution.observedOutputTokens
        : null,
  });
}

function resolveAutomationAiCallUsage(input: {
  inputTokens: number | null;
  outputTokens: number | null;
  execution: AutomationModelExecutionMetadata | null | undefined;
}): CapturedUsage {
  const observedUsage = readAutomationExecutionObservedUsage(input.execution);

  return fillUsageGaps(
    {
      ...EMPTY_CAPTURED_USAGE,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
    },
    observedUsage
  );
}

function getAutomationGatewayCaching(): GatewayCallContext["caching"] {
  const value =
    process.env[AUTOMATION_GATEWAY_CACHING_ENV]?.trim().toLowerCase();
  if (value === "off" || value === "false" || value === "0") return "off";
  return "auto";
}

function buildAutomationGatewayContext(
  context: JobContext,
  assignmentType = normalizeAutomationAssignmentType(context.assignmentType)
): GatewayCallContext {
  return {
    userId: context.repo.user_id,
    caching: getAutomationGatewayCaching(),
    tags: [
      "surface:automation",
      `type:${assignmentType}`,
      `repo:${context.repo.full_name}`,
      `flow:${typeof context.metadata.flow_id === "string" ? context.metadata.flow_id : "none"}`,
    ],
  };
}

function buildAutomationSystem(
  system: string | undefined,
  gatewayContext: GatewayCallContext
): Parameters<typeof generateText>[0]["system"] {
  return system ? withGatewaySystemCaching(system, gatewayContext) : undefined;
}

function buildAutomationRuntimeMetadataFields(
  runtime: JobRunRuntimeDetails | null | undefined
) {
  if (!runtime) {
    return {};
  }

  return {
    runtime_provider: runtime.provider,
    runtime_run_id: runtime.runId,
  };
}

function resolveJobRunRuntimeDetails(input: {
  runtime_provider?: BackgroundRuntimeProvider | null;
  runtime_run_id?: string | null;
  workflow_run_id?: string | null;
}): JobRunRuntimeDetails {
  return {
    provider:
      input.runtime_provider ?? (input.workflow_run_id ? "workflow" : null),
    runId: input.runtime_run_id ?? input.workflow_run_id ?? null,
  };
}

function formatAutomationTimeoutScopeLabel(assignmentType: string) {
  switch (normalizeAutomationAssignmentType(assignmentType)) {
    case "pr_review":
      return "PR review";
    case "push_review":
      return "push review";
    case "issue_triage":
      return "issue triage";
    case "pr_fix":
      return "PR fix";
    default:
      return "automation run";
  }
}

function formatAutomationStateScopeLabel(assignmentType: string) {
  return formatAutomationTimeoutScopeLabel(assignmentType);
}

function formatFailureDurationLabel(durationMs: number) {
  if (durationMs % 1000 === 0) {
    return `${durationMs / 1000}s`;
  }

  return `${durationMs}ms`;
}

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

type RepoVariant = JobContext["repo"] & {
  root_directory?: string | null;
  parent_repo_id?: string | null;
};

function pickPreferredRepoVariant(repos: RepoVariant[]) {
  return (
    repos.find((repo) => !repo.root_directory && !repo.parent_repo_id) ||
    repos.find((repo) => !repo.root_directory) ||
    repos[0] ||
    null
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is string =>
        typeof entry === "string" && entry.trim().length > 0
    )
    .slice(0, 20);
}

function toPositiveInteger(value: unknown) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    Number.isSafeInteger(value)
    ? value
    : null;
}

function toReviewFindingSeverity(
  value: unknown
): ReviewFinding["severity"] | null {
  return value === "critical" || value === "warning" || value === "suggestion"
    ? value
    : null;
}

function toReviewFindings(value: unknown): ReviewFinding[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];

    const severity = toReviewFindingSeverity(entry.severity);
    const title = toOptionalString(entry.title);
    const body = toOptionalString(entry.body);

    if (!severity || !title || !body) {
      return [];
    }

    return [
      {
        severity,
        title,
        body,
        path: toOptionalString(entry.path),
        line: toPositiveInteger(entry.line),
      },
    ];
  });
}

function classifyGithubAppTokenError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    lower.includes("404") ||
    lower.includes("not found") ||
    lower.includes("installation")
  ) {
    return {
      code: "GITHUB_APP_INSTALLATION_UNAVAILABLE",
      message,
    };
  }

  if (
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("forbidden") ||
    lower.includes("denied")
  ) {
    return {
      code: "GITHUB_APP_TOKEN_FORBIDDEN",
      message,
    };
  }

  return {
    code: "GITHUB_APP_TOKEN_FAILED",
    message,
  };
}

async function noteGithubTokenFallback(input: {
  jobRunId?: string | null;
  kind: "primary" | "autofix";
  repo: JobContext["repo"];
  resolution: "fallback_user_token" | "skip_autofix";
  reasonCode: string;
  reasonMessage: string;
}) {
  if (!input.jobRunId) {
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("job_runs")
    .select("metadata")
    .eq("id", input.jobRunId)
    .maybeSingle();

  if (error || !data) {
    console.warn(
      "[automation-job] failed to load job metadata for github token fallback note",
      {
        jobRunId: input.jobRunId,
        repoId: input.repo.id,
        reasonCode: input.reasonCode,
        error: error?.message ?? "missing job run",
      }
    );
    return;
  }

  const metadata = isRecord(data.metadata) ? data.metadata : {};
  const existingNotes = Array.isArray(metadata.github_token_fallbacks)
    ? metadata.github_token_fallbacks
    : [];

  const { error: updateError } = await supabaseAdmin
    .from("job_runs")
    .update({
      metadata: {
        ...metadata,
        github_token_fallbacks: [
          ...existingNotes.slice(-4),
          {
            kind: input.kind,
            resolution: input.resolution,
            reason_code: input.reasonCode,
            reason_message: input.reasonMessage,
            repo_id: input.repo.id,
            repo_full_name: input.repo.full_name,
            at: new Date().toISOString(),
          },
        ],
      },
    })
    .eq("id", input.jobRunId);

  if (updateError) {
    console.warn(
      "[automation-job] failed to persist github token fallback note",
      {
        jobRunId: input.jobRunId,
        repoId: input.repo.id,
        reasonCode: input.reasonCode,
        error: updateError.message,
      }
    );
  }
}

function normalizeAutomationAgentResult(result: {
  text: string;
  totalUsage?: {
    inputTokens?: number | null;
    outputTokens?: number | null;
  } | null;
  execution?: AutomationModelExecutionMetadata | null;
  steps: Array<{
    text?: string;
    usage?: {
      inputTokens?: number | null;
      outputTokens?: number | null;
    } | null;
    toolCalls?: Array<{ toolName: string; input: unknown }>;
    toolResults?: unknown[];
  }>;
}): AutomationAgentResult {
  const lastStep = result.steps.at(-1);

  return {
    text: result.text ?? lastStep?.text ?? "",
    steps: result.steps.map((step) => ({
      toolCalls: (step.toolCalls || []).map((toolCall) => ({
        toolName: toolCall.toolName,
        input: toolCall.input,
      })),
      toolResults: step.toolResults,
    })),
    usage: result.totalUsage
      ? {
          inputTokens: result.totalUsage.inputTokens ?? null,
          outputTokens: result.totalUsage.outputTokens ?? null,
        }
      : result.steps.length === 0
        ? null
        : {
            inputTokens: sumNullableNumbers(
              result.steps.map((step) => step.usage?.inputTokens)
            ),
            outputTokens: sumNullableNumbers(
              result.steps.map((step) => step.usage?.outputTokens)
            ),
          },
    execution: result.execution ?? null,
  };
}

function extractToolCalls(result: {
  steps: Array<{
    toolCalls?: Array<{ toolName: string; input: unknown }>;
    toolResults?: unknown[];
  }>;
}) {
  return result.steps.flatMap((step) =>
    (step.toolCalls || []).map((toolCall, index) => {
      const input = sanitizeToolPayload(toolCall.input);
      const output = sanitizeToolPayload(step.toolResults?.[index]);

      return {
        name: toolCall.toolName,
        input,
        output,
        input_preview: previewTelemetryValue(input),
        output_preview: previewTelemetryValue(output),
      };
    })
  );
}

function hasToolCall(result: AutomationAgentResult, toolName: string) {
  return result.steps.some((step) =>
    (step.toolCalls || []).some((toolCall) => toolCall.toolName === toolName)
  );
}

function buildDispatchLogContext(input: {
  releasedScope: ReleasedAutomationScope;
  context: JobContext;
  resolvedFlow?: ResolvedFlowDefinition | null;
}): DispatchLogContext {
  return {
    userId: input.context.repo.user_id,
    assignmentId:
      input.releasedScope.sourceKind === "assignment"
        ? input.releasedScope.sourceId
        : null,
    triggerId:
      input.releasedScope.sourceKind === "trigger"
        ? input.releasedScope.sourceId
        : null,
    flowId:
      input.resolvedFlow?.flowId ??
      (input.releasedScope.sourceKind === "flow"
        ? input.releasedScope.sourceId
        : null) ??
      (typeof input.context.metadata.flow_id === "string"
        ? input.context.metadata.flow_id
        : null),
    flowVersionId:
      input.resolvedFlow?.flowVersionId ??
      (typeof input.context.metadata.flow_version_id === "string"
        ? input.context.metadata.flow_version_id
        : null),
    repoId: input.releasedScope.repoId ?? input.context.repo.id,
    installationId:
      input.releasedScope.installationId ??
      input.context.repo.github_installation_id ??
      null,
    sourceKind: input.releasedScope.sourceKind,
    sourceType: input.releasedScope.sourceType,
  };
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

function buildFlowNodeRunObservabilityError(input: {
  phase: "create" | "update";
  message: string;
}) {
  const infraFailure = classifyAutomationInfrastructureFailure(input.message);
  const phaseLabel = input.phase === "create" ? "creating" : "updating";
  const detail =
    formatAutomationInfrastructureFailureLabel(infraFailure?.failureClass) ??
    input.message;

  return `Flow node run bookkeeping degraded while ${phaseLabel}: ${detail}`;
}

function mergeAutomationAgentResults(
  results: AutomationAgentResult[]
): AutomationAgentResult {
  return {
    text: results
      .map((result) => result.text)
      .filter(Boolean)
      .join("\n\n")
      .trim(),
    steps: results.flatMap((result) => result.steps),
    usage: {
      inputTokens: sumNullableNumbers(
        results.map((result) => result.usage?.inputTokens)
      ),
      outputTokens: sumNullableNumbers(
        results.map((result) => result.usage?.outputTokens)
      ),
    },
    execution: mergeAutomationExecutionMetadata(results),
  };
}

function buildPrReviewCheckDetailsUrl() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl) return null;

  return `${appUrl.replace(/\/+$/, "")}/observability`;
}

function normalizeAutomationAssignmentType(type: string) {
  switch (type) {
    case "pr_opened":
      return "pr_review";
    case "issue_opened":
      return "issue_triage";
    case "push":
      return "push_review";
    default:
      return type;
  }
}

function coercePositivePrNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function resolvePullRequestNumber(
  metadata: Record<string, unknown>
): number | null {
  const direct = coercePositivePrNumber(metadata.pr_number);
  if (direct != null) return direct;

  // GitHub `issue_comment` and `pull_request_review_comment` deliveries set
  // `is_pr: true` and store the PR number in `issue_number`. Honor that so
  // mention / PR-comment triggered fix nodes can resolve their pull request.
  if (metadata.is_pr === true) {
    return coercePositivePrNumber(metadata.issue_number);
  }

  return null;
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

function fallbackAutomationModel(
  modelId: string,
  gatewayContext: GatewayCallContext
): AutomationLanguageModel {
  return {
    model: modelId,
    providerOptions: gatewayProviderOptions(modelId, gatewayContext),
    effectiveModelId: modelId,
  };
}

/**
 * Pull the active team id out of a job's metadata blob. Returns null when
 * the field is missing, the wrong shape, or empty — solo jobs (and any
 * legacy rows from before team scope existed) flow through unchanged.
 */
function readAutomationTeamId(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  if (!metadata) return null;
  const raw = (metadata as Record<string, unknown>).team_id;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildAutofixSandboxInternalApiHeaders(
  context: Pick<JobContext, "metadata" | "repo">
) {
  return buildInternalApiHeaders(context.repo.user_id, {
    teamId: readAutomationTeamId(context.metadata),
  });
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

function buildPromptForJob(
  type: string,
  metadata: Record<string, unknown>,
  systemPrompt: string | null
): {
  prompt: string;
  system?: string;
} {
  const normalizedType = normalizeAutomationAssignmentType(type);
  const flowPreviousOutputs = Array.isArray(metadata.flow_previous_outputs)
    ? metadata.flow_previous_outputs
        .filter(
          (entry): entry is { label?: unknown; output?: unknown } =>
            typeof entry === "object" && entry !== null
        )
        .map((entry) => {
          const label =
            typeof entry.label === "string" ? entry.label : "Previous step";
          const output = typeof entry.output === "string" ? entry.output : "";
          return { label, output };
        })
        .filter((entry) => entry.output.trim().length > 0)
    : [];
  const flowContextBlock =
    flowPreviousOutputs.length > 0
      ? [
          "Upstream flow context:",
          ...flowPreviousOutputs.map(
            (entry, index) => `${index + 1}. ${entry.label}: ${entry.output}`
          ),
        ].join("\n")
      : null;

  if (normalizedType === "cron_refactor" || normalizedType === "cron") {
    return {
      system: systemPrompt || "You are a code refactoring agent.",
      prompt: [
        `Use the GitHub tools to improve ${String(metadata.repo_full_name || "the repository")} on a new branch from ${String(metadata.base_branch || "main")}.`,
        typeof metadata.skill_id === "string" && metadata.skill_id
          ? `Start by fetching the skill definition for "${metadata.skill_id}" and follow it.`
          : "Perform a focused, low-risk refactor with clear value.",
        flowContextBlock,
        "You must inspect relevant files, create a branch, apply edits, and create a pull request back to the base branch if you make a meaningful change.",
        "If the repository does not need a safe automated refactor, explain why and do not create a PR.",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (normalizedType === "pr_review") {
    // Separate stable cacheable content (system) from per-call content (prompt)
    // so Anthropic prompt caching can fire. See issue #530.
    return buildPrReviewRunSpec({
      flowContextBlock,
      prNumber: metadata.pr_number,
      systemPrompt,
    });
  }

  const prefix = systemPrompt ? `${systemPrompt}\n\n` : "";
  const promptPrefix = flowContextBlock
    ? `${prefix}${flowContextBlock}\n\n`
    : prefix;

  switch (normalizedType) {
    case "webhook": {
      const webhookPayload =
        metadata.webhook &&
        typeof metadata.webhook === "object" &&
        !Array.isArray(metadata.webhook)
          ? (metadata.webhook as Record<string, unknown>)
          : {};
      const webhookPrompt =
        typeof webhookPayload.prompt === "string"
          ? webhookPayload.prompt.trim()
          : "";
      return {
        prompt: [
          promptPrefix,
          webhookPrompt || "Process this signed webhook event.",
          `Webhook payload:\n${JSON.stringify(webhookPayload)}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      };
    }
    case "push_review":
      return {
        prompt: `${promptPrefix}Review the ${metadata.commits_count} commit(s) pushed. Head SHA: ${metadata.head_sha}. Compare: ${metadata.compare_url}. Focus on security, performance, and correctness. Fetch key changed files and post a review comment.`,
      };
    case "tag_push": {
      const tagBy =
        typeof metadata.sender_login === "string" && metadata.sender_login
          ? ` by @${metadata.sender_login}`
          : "";
      return {
        prompt: `${promptPrefix}Tag "${metadata.tag_name}" was pushed${tagBy}. Compare: ${metadata.compare_url}. Inspect the tagged state with listFiles and fetchFile (both default to the tag ref), then act on your instructions. Post your findings as a commit comment with postCommitComment, or open an issue with createIssue if follow-up work is needed.`,
      };
    }
    case "issue_triage":
      return {
        prompt: `${promptPrefix}Triage issue #${metadata.issue_number}: "${metadata.issue_title}". Fetch the issue details, add appropriate labels, and post an initial response with guidance or next steps.`,
      };
    case "ci_failure": {
      const name = metadata.check_name ?? metadata.workflow_name ?? "unknown";
      const revertHint =
        metadata.flow_auto_revert === true
          ? ` If the pushed commit itself caused the failure and no quick fix is apparent, call createRevertPr to open a revert PR (it only works while that commit is still the branch head).`
          : "";
      return {
        prompt: `${promptPrefix}CI check "${name}" failed on ${metadata.head_sha}. Analyze the failure, fetch relevant source files if needed, and suggest a fix. Post a commit comment with your analysis.${revertHint}`,
      };
    }
    case "mention": {
      const entityType = metadata.is_pr ? "PR" : "issue";
      const entityRef = metadata.issue_number
        ? `#${metadata.issue_number}`
        : `commit ${String(metadata.commit_id || "unknown").slice(0, 7)}`;
      return {
        prompt: `${promptPrefix}You were @mentioned in a ${entityType} comment on ${entityRef} by @${metadata.comment_author}. The comment:\n\n"${metadata.comment_body}"\n\nUse getThreadContext to understand the full conversation, then use replyToThread to respond helpfully.`,
      };
    }
    case "pr_comment":
      return {
        prompt: `${promptPrefix}A new comment was posted on PR #${metadata.issue_number} "${metadata.issue_title}" by @${metadata.comment_author}:\n\n"${metadata.comment_body}"\n\nUse getThreadContext to understand the conversation. Analyze and respond if appropriate using replyToThread.`,
      };
    case "issue_comment":
      return {
        prompt: `${promptPrefix}A new comment was posted on issue #${metadata.issue_number} "${metadata.issue_title}" by @${metadata.comment_author}:\n\n"${metadata.comment_body}"\n\nUse getThreadContext to understand the conversation. Analyze and respond if appropriate using replyToThread.`,
      };
    case "labeled": {
      const labelBy =
        typeof metadata.sender_login === "string" && metadata.sender_login
          ? ` by @${metadata.sender_login}`
          : "";
      const labelTitle = metadata.issue_title
        ? ` "${metadata.issue_title}"`
        : "";
      if (metadata.is_pr === true) {
        return {
          prompt: `${promptPrefix}The "${metadata.label_name}" label was added to PR #${metadata.issue_number}${labelTitle}${labelBy}. Inspect the pull request with getPullRequest and listChangedFiles, read the files you need, then act on your instructions. Call reportReview with structured findings when you perform a review; use postComment for conversational replies.`,
        };
      }
      return {
        prompt: `${promptPrefix}The "${metadata.label_name}" label was added to issue #${metadata.issue_number}${labelTitle}${labelBy}. Fetch the issue with fetchIssue, then act on your instructions — add labels with addLabels or reply with postIssueComment as appropriate.`,
      };
    }
    default:
      return {
        prompt: `${promptPrefix}Process job with metadata: ${JSON.stringify(metadata)}`,
      };
  }
}

function buildPromptForPRFix(input: {
  context: JobContext;
  review: ReviewOutcome;
  pullRequest: PullRequestDetails;
  targetRepo: JobContext["repo"];
}) {
  const prefix = input.context.agent.system_prompt
    ? `${input.context.agent.system_prompt}\n\n`
    : "";
  return {
    prompt: [
      `${prefix}A prior PR review found issues in PR #${input.pullRequest.number} for ${input.context.repo.full_name}.`,
      input.pullRequest.title
        ? `PR title: "${input.pullRequest.title}".`
        : null,
      `Apply a safe, minimal fix directly to the existing PR branch ${input.pullRequest.headRef} targeting ${input.pullRequest.baseRef}.`,
      input.targetRepo.full_name === input.context.repo.full_name
        ? null
        : `The PR head repository is ${input.targetRepo.full_name}; write changes there, not to the base repository.`,
      input.review.summary ? `Review summary: ${input.review.summary}` : null,
      input.review.commentBody
        ? `The reviewer comment body was:\n${input.review.commentBody}`
        : null,
      // Structured reviews put the line-level detail in findings and omit
      // commentBody, so the fixer prompt must carry the findings itself.
      input.review.findings.length > 0
        ? [
            "The review findings:",
            ...input.review.findings.map((finding) => {
              const location = finding.path
                ? ` (${finding.path}${finding.line === null ? "" : `:${finding.line}`})`
                : "";
              return `- [${finding.severity}] ${finding.title}${location}: ${finding.body}`;
            }),
          ].join("\n")
        : null,
      input.review.affectedFiles.length > 0
        ? `Likely affected files: ${input.review.affectedFiles.join(", ")}.`
        : null,
      "Start by calling getPullRequest and listChangedFiles to confirm context, then read the smallest set of files needed.",
      "Use updateFile to commit changes directly to the PR branch. Do not create a new branch and do not open a new pull request.",
      "If you apply a fix, call reportFix with applied=true and the updated files before finishing.",
      "If no safe automated fix is possible, do not modify files and call reportFix with applied=false and a short explanation.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

const AUTOMATION_HARNESS_REVIEW_PREFIX = "MOGPLEX_REVIEW_RESULT:";

export function buildAutomationHarnessPrompt(input: {
  context: JobContext;
  harnessId: HarnessId;
  review?: ReviewOutcome | null;
  pullRequest?: PullRequestDetails | null;
  targetRepo?: JobContext["repo"] | null;
}) {
  const assignmentType = normalizeAutomationAssignmentType(
    input.context.assignmentType
  );
  const baseBranch = input.context.repo.default_branch || "main";
  const runSpec =
    input.review && input.pullRequest && input.targetRepo
      ? buildPromptForPRFix({
          context: input.context,
          review: input.review,
          pullRequest: input.pullRequest,
          targetRepo: input.targetRepo,
        })
      : buildPromptForJob(
          assignmentType,
          {
            ...input.context.metadata,
            repo_full_name: input.context.repo.full_name,
            base_branch: baseBranch,
            skill_id: input.context.skillId,
          },
          input.context.agent.system_prompt
        );

  const metadataRole = input.context.metadata.flow_node_role;
  const isReview =
    (isFlowAgentNodeRole(metadataRole) ? metadataRole : "review") === "review";

  const instructions = [
    `You are ${input.harnessId === "claude-code" ? "Claude Code" : "Codex"} running a Mogplex automation inside an isolated checkout of ${input.context.repo.full_name}.`,
    "Use the local checkout and the authenticated gh CLI instead of any Mogplex-only tool names mentioned below.",
    "Never print credentials or environment-variable values.",
    "system" in runSpec && runSpec.system
      ? `Agent instructions:\n${runSpec.system}`
      : null,
    `Task:\n${runSpec.prompt}`,
  ];

  if (input.review && input.pullRequest) {
    instructions.push(
      "Apply the smallest safe fix in the current PR branch, run relevant checks, then commit and push the changes to that same branch.",
      "Do not create a new branch or pull request. Do not force-push.",
      "Finish with a concise summary of the files changed and checks run."
    );
  } else if (isReview) {
    instructions.push(
      "Inspect only. Do not edit files, push commits, merge, or publish GitHub comments or reviews; Mogplex publishes the review after you finish.",
      `Your final non-empty line must be ${AUTOMATION_HARNESS_REVIEW_PREFIX} followed by one compact JSON object with this shape: {"hasIssues":true,"summary":"...","commentBody":"...","affectedFiles":["path"],"findings":[{"severity":"warning","title":"...","body":"...","path":"path","line":1}]}.`,
      "Use hasIssues=false and an empty findings array only when there are no material issues."
    );
  } else {
    instructions.push(
      "Complete the task using the local checkout and gh CLI, then finish with a concise outcome summary."
    );
  }

  return instructions.filter(Boolean).join("\n\n");
}

export function parseAutomationHarnessReviewResult(
  text: string
): ReviewOutcome | null {
  const markerIndex = text.lastIndexOf(AUTOMATION_HARNESS_REVIEW_PREFIX);
  if (markerIndex === -1) return null;

  const jsonLine = text
    .slice(markerIndex + AUTOMATION_HARNESS_REVIEW_PREFIX.length)
    .trimStart()
    .split(/\r?\n/, 1)[0]
    ?.trim()
    .replace(/```$/, "");
  if (!jsonLine) return null;

  try {
    const payload = JSON.parse(jsonLine) as unknown;
    if (!isRecord(payload) || typeof payload.hasIssues !== "boolean") {
      return null;
    }
    const summary = toOptionalString(payload.summary);
    if (!summary) return null;
    const findings = toReviewFindings(payload.findings);
    if (payload.hasIssues && findings.length === 0) return null;

    return {
      hasIssues: payload.hasIssues,
      summary,
      commentBody: toOptionalString(payload.commentBody),
      affectedFiles: toStringArray(payload.affectedFiles),
      findings,
    };
  } catch {
    return null;
  }
}

function stripAutomationHarnessReviewMarker(text: string) {
  const markerIndex = text.lastIndexOf(AUTOMATION_HARNESS_REVIEW_PREFIX);
  return (markerIndex === -1 ? text : text.slice(0, markerIndex)).trim();
}

async function loadPullRequestDetails(input: {
  repoFullName: string;
  prNumber: number;
  githubToken: string;
  fallbackHeadRef?: string | null;
  fallbackHeadSha?: string | null;
  fallbackHeadRepoFullName?: string | null;
  fallbackBaseRef?: string | null;
  fallbackBaseSha?: string | null;
  fallbackBaseRepoFullName?: string | null;
}): Promise<PullRequestDetails | null> {
  "use step";

  const [owner, repo] = input.repoFullName.split("/");
  if (!owner || !repo) return null;

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${input.prNumber}`,
    {
      headers: {
        Authorization: `Bearer ${input.githubToken}`,
        Accept: "application/vnd.github+json",
      },
    }
  );

  if (!res.ok) {
    if (!input.fallbackHeadRef || !input.fallbackBaseRef) return null;
    return {
      number: input.prNumber,
      title: null,
      body: null,
      headRef: input.fallbackHeadRef,
      headSha: input.fallbackHeadSha ?? null,
      headRepoFullName: input.fallbackHeadRepoFullName ?? input.repoFullName,
      baseRef: input.fallbackBaseRef,
      baseSha: input.fallbackBaseSha ?? null,
      baseRepoFullName: input.fallbackBaseRepoFullName ?? input.repoFullName,
    };
  }

  const data = (await res.json()) as {
    number: number;
    title?: string | null;
    body?: string | null;
    head?: { ref?: string; sha?: string; repo?: { full_name?: string | null } };
    base?: { ref?: string; sha?: string; repo?: { full_name?: string | null } };
  };

  const headRef = data.head?.ref ?? input.fallbackHeadRef ?? null;
  const baseRef = data.base?.ref ?? input.fallbackBaseRef ?? null;
  const headRepoFullName =
    data.head?.repo?.full_name ??
    input.fallbackHeadRepoFullName ??
    input.repoFullName;
  const baseRepoFullName =
    data.base?.repo?.full_name ??
    input.fallbackBaseRepoFullName ??
    input.repoFullName;

  if (!headRef || !baseRef || !headRepoFullName || !baseRepoFullName)
    return null;

  return {
    number: data.number,
    title: data.title ?? null,
    body: data.body ?? null,
    headRef,
    headSha: data.head?.sha ?? input.fallbackHeadSha ?? null,
    headRepoFullName,
    baseRef,
    baseSha: data.base?.sha ?? input.fallbackBaseSha ?? null,
    baseRepoFullName,
  };
}

function buildGithubPrAccessFailureMessage(input: {
  repoFullName: string;
  prNumber: number;
  status: number;
  body: string;
}) {
  const repoParts = splitRepoFullName(input.repoFullName);
  const ownerHint = repoParts?.owner
    ? `the "${repoParts.owner}" org or personal account`
    : "the repo owner";
  const detail = extractGithubApiErrorMessage(input.body);
  const detailLabel = detail
    ? `GitHub responded with ${input.status}: ${detail}.`
    : `GitHub responded with ${input.status}.`;

  return [
    `${GITHUB_PR_ACCESS_FAILURE_PREFIX} for ${input.repoFullName}#${input.prNumber}.`,
    detailLabel,
    `Open Settings > GitHub App coverage and add ${ownerHint}, then rerun the review.`,
  ].join(" ");
}

async function assertPullRequestGithubAccess(input: {
  repoFullName: string;
  prNumber: number;
  githubToken: string;
}) {
  const repoParts = splitRepoFullName(input.repoFullName);
  if (!repoParts) return;

  const response = await fetch(
    `https://api.github.com/repos/${repoParts.owner}/${repoParts.repo}/pulls/${input.prNumber}`,
    {
      headers: {
        Authorization: `Bearer ${input.githubToken}`,
        Accept: "application/vnd.github+json",
      },
      cache: "no-store",
    }
  );

  if (response.ok) {
    return;
  }

  const body = await response.text().catch(() => "");

  if (
    response.status === 401 ||
    response.status === 403 ||
    response.status === 404
  ) {
    throw new Error(
      buildGithubPrAccessFailureMessage({
        repoFullName: input.repoFullName,
        prNumber: input.prNumber,
        status: response.status,
        body,
      })
    );
  }

  const detail = extractGithubApiErrorMessage(body) || "Unknown GitHub error";
  throw new Error(
    `GitHub PR lookup failed (${response.status}) for ${input.repoFullName}#${input.prNumber}: ${detail}`
  );
}

async function resolveAutofixTargetRepo(input: {
  contextRepo: JobContext["repo"];
  headRepoFullName: string;
}): Promise<JobContext["repo"] | null> {
  "use step";

  if (input.headRepoFullName === input.contextRepo.full_name) {
    return input.contextRepo;
  }

  const { data, error } = await supabaseAdmin
    .from("repos")
    .select(
      "id, user_id, full_name, default_branch, github_installation_id, root_directory, parent_repo_id"
    )
    .eq("user_id", input.contextRepo.user_id)
    .eq("full_name", input.headRepoFullName);

  if (error) {
    throw new Error(`Failed to resolve autofix target repo: ${error.message}`);
  }

  const preferred = pickPreferredRepoVariant((data || []) as RepoVariant[]);
  if (!preferred) return null;

  return {
    id: preferred.id,
    user_id: preferred.user_id,
    full_name: preferred.full_name,
    default_branch: preferred.default_branch ?? null,
    github_installation_id: preferred.github_installation_id ?? null,
  };
}

async function resolveAutofixGithubToken(
  repo: JobContext["repo"],
  options?: { jobRunId?: string | null }
) {
  "use step";

  if (!repo.github_installation_id) return null;

  try {
    const { token } = await createGithubInstallationAccessToken(
      repo.github_installation_id
    );
    return token;
  } catch (error) {
    const reason = classifyGithubAppTokenError(error);
    console.warn("[automation-job] autofix github token unavailable", {
      repoId: repo.id,
      repoFullName: repo.full_name,
      githubInstallationId: repo.github_installation_id,
      reasonCode: reason.code,
      error: reason.message,
    });
    await noteGithubTokenFallback({
      jobRunId: options?.jobRunId ?? null,
      kind: "autofix",
      repo,
      resolution: "skip_autofix",
      reasonCode: reason.code,
      reasonMessage: reason.message,
    });
    return null;
  }
}

async function launchAutofixSandbox(input: {
  context: JobContext;
  pullRequest: PullRequestDetails;
  targetRepo: JobContext["repo"];
}) {
  "use step";

  const { createSandboxPostHandler } = await import("@/app/api/sandbox/route");
  const response = await createSandboxPostHandler()(
    new Request("https://internal.mogplex/api/sandbox", {
      method: "POST",
      headers: buildAutofixSandboxInternalApiHeaders(input.context),
      body: JSON.stringify({
        repoId: input.targetRepo.id,
        baseBranch:
          input.pullRequest.baseRef ||
          input.targetRepo.default_branch ||
          input.context.repo.default_branch ||
          "main",
        workingBranch: input.pullRequest.headRef,
        createBranch: false,
      }),
    })
  );

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return readJsonSandboxResponse(response);
  }
  if (!response.ok) {
    throw new Error(
      (await readTextResponse(response)) || "Sandbox launch failed"
    );
  }
  return readSandboxStreamResponse(response);
}

async function launchAutomationHarnessSandbox(context: JobContext) {
  "use step";

  const { createSandboxPostHandler } = await import("@/app/api/sandbox/route");
  const baseBranch = context.repo.default_branch || "main";
  const response = await createSandboxPostHandler()(
    new Request("https://internal.mogplex/api/sandbox", {
      method: "POST",
      headers: buildAutofixSandboxInternalApiHeaders(context),
      body: JSON.stringify({
        repoId: context.repo.id,
        baseBranch,
        workingBranch: baseBranch,
        createBranch: false,
      }),
    })
  );

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return readJsonSandboxResponse(response);
  }
  if (!response.ok) {
    throw new Error(
      (await readTextResponse(response)) || "Sandbox launch failed"
    );
  }
  return readSandboxStreamResponse(response);
}

type FlowActionRuntimeInput = {
  jobRunId: string;
  nodeId: string;
  action: FlowActionNodeData;
  context: JobContext;
  githubToken: string;
  loadPullRequestDetails: typeof loadPullRequestDetails;
  resolveAutofixTargetRepo: typeof resolveAutofixTargetRepo;
  fetchImpl?: typeof fetch;
};

function resolveActionWorkingDirectory(
  sandboxRootDirectory: string | null,
  configuredDirectory: string | null
) {
  if (!configuredDirectory?.trim()) return sandboxRootDirectory;
  const configured = configuredDirectory.trim();
  if (path.posix.isAbsolute(configured)) {
    throw new Error("Run command working directory must be repo-relative");
  }
  const normalized = path.posix.normalize(configured);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Run command working directory must stay inside the repo");
  }
  return sandboxRootDirectory
    ? path.posix.join(sandboxRootDirectory, normalized)
    : normalized;
}

async function launchFlowActionSandbox(input: FlowActionRuntimeInput) {
  const prNumber = resolvePullRequestNumber(input.context.metadata);
  if (prNumber == null) {
    return launchAutomationHarnessSandbox(input.context);
  }

  const pullRequest = await input.loadPullRequestDetails({
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
    throw new Error("Run command could not load pull request details");
  }

  const targetRepo = await input.resolveAutofixTargetRepo({
    contextRepo: input.context.repo,
    headRepoFullName: pullRequest.headRepoFullName,
  });
  if (!targetRepo) {
    throw new Error(
      "Run command could not resolve the pull request head repository"
    );
  }

  return launchAutofixSandbox({
    context: input.context,
    pullRequest,
    targetRepo,
  });
}

function resolveActionTargetNumber(
  configured: string | null,
  metadata: Record<string, unknown>,
  target: "issue or pull request" | "pull request"
) {
  const configuredNumber = configured
    ? coercePositivePrNumber(configured)
    : null;
  if (configured && configuredNumber == null) {
    throw new Error(
      `GitHub action ${target} number must resolve to a positive integer`
    );
  }
  if (configuredNumber != null) return configuredNumber;

  const prNumber = resolvePullRequestNumber(metadata);
  if (prNumber != null) return prNumber;
  if (target === "issue or pull request") {
    const issueNumber = coercePositivePrNumber(metadata.issue_number);
    if (issueNumber != null) return issueNumber;
  }
  throw new Error(
    `GitHub action could not resolve the triggering ${target} number`
  );
}

function resolveActionCommitSha(
  configured: string | null,
  metadata: Record<string, unknown>
) {
  const value =
    configured ??
    (typeof metadata.head_sha === "string" ? metadata.head_sha : null);
  const normalized = value?.trim() ?? "";
  if (!/^[a-f0-9]{7,40}$/i.test(normalized)) {
    throw new Error(
      "GitHub status action could not resolve a valid commit SHA"
    );
  }
  return normalized;
}

function requireResolvedActionText(value: string, field: string) {
  if (!value.trim()) {
    throw new Error(`Flow action ${field} resolved to an empty value`);
  }
}

export function resolveSlackTriggerDestination(
  metadata: Record<string, unknown>
) {
  const slack =
    metadata.slack &&
    typeof metadata.slack === "object" &&
    !Array.isArray(metadata.slack)
      ? (metadata.slack as Record<string, unknown>)
      : null;
  const teamId =
    slack && typeof slack.team_id === "string" ? slack.team_id.trim() : "";
  const channelId =
    slack && typeof slack.channel_id === "string"
      ? slack.channel_id.trim()
      : "";
  const threadTs =
    slack && typeof slack.thread_ts === "string" ? slack.thread_ts.trim() : "";
  const messageTs =
    slack && typeof slack.message_ts === "string"
      ? slack.message_ts.trim()
      : "";
  if (!teamId || !channelId || (!threadTs && !messageTs)) {
    throw new Error(
      "Slack thread action requires a Slack-triggered workflow event"
    );
  }
  return {
    teamId,
    channelId,
    threadTs: threadTs || messageTs,
  };
}

export async function runFlowAction(
  input: FlowActionRuntimeInput
): Promise<FlowOperatorActionResult> {
  if (input.action.operation === "slack.send_message") {
    requireResolvedActionText(input.action.message, "Slack message");
    const triggerDestination =
      input.action.destination === "trigger_thread"
        ? resolveSlackTriggerDestination(input.context.metadata)
        : null;
    const teamId = triggerDestination?.teamId ?? input.action.teamId;
    const channelId = triggerDestination?.channelId ?? input.action.channelId;
    const installation = await getSlackInstallationByTeamId(teamId);
    if (installation?.installed_by_user_id !== input.context.repo.user_id) {
      throw new Error("Slack workspace is not connected for this user");
    }
    const botToken = await getSlackBotToken(teamId);
    if (!botToken) {
      throw new Error("Slack workspace bot token is unavailable");
    }
    const posted = await postSlackMessage(
      botToken,
      {
        channel: channelId,
        text: input.action.message,
        thread_ts: triggerDestination?.threadTs,
        unfurl_links: input.action.unfurlLinks === true,
      },
      input.fetchImpl
    );
    const destination = triggerDestination
      ? "the triggering Slack thread"
      : input.action.channelName
        ? `#${input.action.channelName}`
        : channelId;
    return {
      summary: `Sent Slack message to ${destination}`,
      output: {
        team_id: teamId,
        channel_id: posted.channel,
        channel_name: triggerDestination ? null : input.action.channelName,
        message_ts: posted.ts,
        thread_ts: triggerDestination?.threadTs ?? null,
      },
    };
  }

  if (input.action.operation === "github.post_comment") {
    requireResolvedActionText(input.action.body, "GitHub comment body");
    const targetNumber = resolveActionTargetNumber(
      input.action.targetNumber,
      input.context.metadata,
      "issue or pull request"
    );
    const result = await postGithubComment({
      githubToken: input.githubToken,
      repoFullName: input.context.repo.full_name,
      targetNumber,
      body: input.action.body,
      fetchImpl: input.fetchImpl,
    });
    return {
      summary: `Posted GitHub comment on #${targetNumber}`,
      output: {
        target_number: targetNumber,
        comment_id: result.commentId,
        comment_url: result.commentUrl,
      },
    };
  }

  if (input.action.operation === "github.create_issue") {
    requireResolvedActionText(input.action.title, "GitHub issue title");
    const result = await createGithubIssueAction({
      githubToken: input.githubToken,
      repoFullName: input.context.repo.full_name,
      title: input.action.title,
      body: input.action.body,
      labels: input.action.labels,
      fetchImpl: input.fetchImpl,
    });
    return {
      summary: `Created GitHub issue #${result.issueNumber}`,
      output: {
        issue_number: result.issueNumber,
        issue_url: result.issueUrl,
        labels: input.action.labels,
      },
    };
  }

  if (input.action.operation === "github.update_labels") {
    if (
      input.action.addLabels.length === 0 &&
      input.action.removeLabels.length === 0
    ) {
      throw new Error("Flow action GitHub labels resolved to an empty value");
    }
    const targetNumber = resolveActionTargetNumber(
      input.action.targetNumber,
      input.context.metadata,
      "issue or pull request"
    );
    const result = await updateGithubLabels({
      githubToken: input.githubToken,
      repoFullName: input.context.repo.full_name,
      targetNumber,
      addLabels: input.action.addLabels,
      removeLabels: input.action.removeLabels,
      fetchImpl: input.fetchImpl,
    });
    return {
      summary: `Updated GitHub labels on #${targetNumber}`,
      output: {
        target_number: targetNumber,
        added_labels: result.addedLabels,
        removed_labels: result.removedLabels,
        labels: result.labels,
      },
    };
  }

  if (input.action.operation === "github.set_status") {
    requireResolvedActionText(input.action.context, "GitHub status context");
    const commitSha = resolveActionCommitSha(
      input.action.commitSha,
      input.context.metadata
    );
    if (input.action.targetUrl) {
      try {
        const url = new URL(input.action.targetUrl);
        if (!["http:", "https:"].includes(url.protocol)) {
          throw new Error("Unsupported status URL protocol");
        }
      } catch {
        throw new Error("GitHub status target URL must use http(s)");
      }
    }
    const result = await setGithubCommitStatus({
      githubToken: input.githubToken,
      repoFullName: input.context.repo.full_name,
      commitSha,
      state: input.action.state,
      context: input.action.context,
      description: input.action.description,
      targetUrl: input.action.targetUrl,
      fetchImpl: input.fetchImpl,
    });
    return {
      summary: `Set ${result.context} status to ${result.state}`,
      output: {
        status_id: result.statusId,
        status_url: result.statusUrl,
        state: result.state,
        context: result.context,
        commit_sha: result.commitSha,
      },
    };
  }

  if (input.action.operation === "github.submit_review") {
    requireResolvedActionText(input.action.body, "GitHub review body");
    const pullRequestNumber = resolveActionTargetNumber(
      input.action.pullRequestNumber,
      input.context.metadata,
      "pull request"
    );
    const triggeringPullRequestNumber = resolvePullRequestNumber(
      input.context.metadata
    );
    const result = await submitGithubPullRequestReview({
      githubToken: input.githubToken,
      repoFullName: input.context.repo.full_name,
      pullRequestNumber,
      event: input.action.event,
      body: input.action.body,
      commitSha:
        pullRequestNumber === triggeringPullRequestNumber &&
        typeof input.context.metadata.head_sha === "string"
          ? input.context.metadata.head_sha
          : null,
      fetchImpl: input.fetchImpl,
    });
    return {
      summary: `Submitted ${input.action.event.toLowerCase()} review on PR #${pullRequestNumber}`,
      output: {
        pull_request_number: pullRequestNumber,
        review_id: result.reviewId,
        review_url: result.reviewUrl,
        event: input.action.event,
      },
    };
  }

  if (input.action.operation === "github.merge_pull_request") {
    const pullRequestNumber = resolveActionTargetNumber(
      input.action.pullRequestNumber,
      input.context.metadata,
      "pull request"
    );
    return {
      summary: `Requested safe merge for pull request #${pullRequestNumber}`,
      output: {
        pull_request_number: pullRequestNumber,
        auto_merge_requested: true,
        commit_title: input.action.commitTitle,
      },
    };
  }

  if (!input.action.command.trim()) {
    throw new Error("Run command resolved to an empty command");
  }
  if (input.action.command.includes("{{")) {
    throw new Error("Run command cannot use templates in shell commands");
  }
  const sandbox = await launchFlowActionSandbox(input);
  const { createSandboxExecPostHandler } =
    await import("@/app/api/sandbox/[id]/exec/route");
  const response = await createSandboxExecPostHandler()(
    new Request(
      `https://internal.mogplex/api/sandbox/${sandbox.recordId}/exec`,
      {
        method: "POST",
        headers: buildAutofixSandboxInternalApiHeaders(input.context),
        body: JSON.stringify({
          command: input.action.command,
          cwd: resolveActionWorkingDirectory(
            sandbox.rootDirectory,
            input.action.workingDirectory
          ),
        }),
      }
    ),
    { params: Promise.resolve({ id: sandbox.recordId }) }
  );
  const payload = (await response.json()) as {
    error?: unknown;
    exitCode?: unknown;
    stdout?: unknown;
    stderr?: unknown;
    cwd?: unknown;
  };
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "Sandbox command failed"
    );
  }
  const exitCode = typeof payload.exitCode === "number" ? payload.exitCode : 1;
  const stdout = typeof payload.stdout === "string" ? payload.stdout : "";
  const stderr = typeof payload.stderr === "string" ? payload.stderr : "";
  if (exitCode !== 0) {
    const detail = stderr.trim() || stdout.trim();
    throw new Error(
      detail
        ? `Command exited with code ${exitCode}: ${detail}`
        : `Command exited with code ${exitCode}`
    );
  }

  return {
    summary: `Command completed: ${input.action.command}`,
    output: {
      sandbox_id: sandbox.recordId,
      runtime_sandbox_id: sandbox.sandboxId,
      command: input.action.command,
      cwd: typeof payload.cwd === "string" ? payload.cwd : null,
      exit_code: exitCode,
      stdout,
      stderr,
    },
  };
}

function parseAutomationHarnessSseEvents(buffer: string) {
  const events: unknown[] = [];
  let remaining = buffer;
  let separatorIndex = remaining.indexOf("\n\n");

  while (separatorIndex !== -1) {
    const rawEvent = remaining.slice(0, separatorIndex);
    remaining = remaining.slice(separatorIndex + 2);
    const data = rawEvent
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n");
    if (data) {
      try {
        events.push(JSON.parse(data));
      } catch {
        // Ignore a malformed stream event; the terminal event still decides
        // whether the harness run succeeded.
      }
    }
    separatorIndex = remaining.indexOf("\n\n");
  }

  return { events, remaining };
}

async function attachAutomationHarnessAiCall(input: {
  aiCallId: string;
  jobRunId: string;
  context: JobContext;
}) {
  const { data, error } = await supabaseAdmin
    .from("ai_calls")
    .select("metadata")
    .eq("id", input.aiCallId)
    .eq("user_id", input.context.repo.user_id)
    .maybeSingle();

  if (error || !data) {
    console.warn("[automation-job] failed to load harness ai_call", {
      aiCallId: input.aiCallId,
      jobRunId: input.jobRunId,
      error: error?.message ?? "missing ai_call",
    });
    return;
  }

  const metadata = isRecord(data.metadata) ? data.metadata : {};
  const { error: updateError } = await supabaseAdmin
    .from("ai_calls")
    .update({
      job_run_id: input.jobRunId,
      metadata: {
        ...metadata,
        ...input.context.metadata,
        source: "automation",
      },
    })
    .eq("id", input.aiCallId)
    .eq("user_id", input.context.repo.user_id);

  if (updateError) {
    console.warn("[automation-job] failed to attach harness ai_call", {
      aiCallId: input.aiCallId,
      jobRunId: input.jobRunId,
      error: updateError.message,
    });
  }
}

async function readAutomationHarnessStream(input: {
  response: Response;
  harnessId: HarnessId;
  jobRunId: string;
  context: JobContext;
}) {
  if (!input.response.body) {
    throw new Error("Harness response did not include a stream");
  }

  const reader = input.response.body.getReader();
  const decoder = new TextDecoder();
  const renderer = createHarnessOutputRenderer(input.harnessId);
  let buffer = "";
  let text = "";
  let aiCallId: string | null = null;
  let exitCode: number | null = null;
  let streamError: string | null = null;
  let cancelled = false;
  let toolCalls: Array<{
    name: string;
    input?: unknown;
    output?: unknown;
  }> = [];

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseAutomationHarnessSseEvents(buffer);
    buffer = parsed.remaining;

    for (const event of parsed.events) {
      if (!isRecord(event) || typeof event.type !== "string") continue;

      if (event.type === "run" && typeof event.ai_call_id === "string") {
        aiCallId = event.ai_call_id;
        await attachAutomationHarnessAiCall({
          aiCallId,
          jobRunId: input.jobRunId,
          context: input.context,
        });
        continue;
      }

      if (event.type === "log" && typeof event.data === "string") {
        const rendered = renderer.push(
          typeof event.stream === "string" ? event.stream : "stdout",
          event.data
        );
        text += rendered.text;
        if (rendered.toolCalls) {
          toolCalls = rendered.toolCalls.map((toolCall) => ({
            name: toolCall.name,
            input: toolCall.input,
            output: toolCall.output,
          }));
        }
        continue;
      }

      if (event.type === "done") {
        exitCode = typeof event.exitCode === "number" ? event.exitCode : null;
        continue;
      }

      if (event.type === "cancelled") {
        cancelled = true;
        continue;
      }

      if (event.type === "error") {
        streamError =
          typeof event.data === "string" ? event.data : "Harness run failed";
      }
    }
  }

  const flushed = renderer.flush();
  text += flushed.text;
  if (flushed.toolCalls) {
    toolCalls = flushed.toolCalls.map((toolCall) => ({
      name: toolCall.name,
      input: toolCall.input,
      output: toolCall.output,
    }));
  }

  if (cancelled) throw new JobRunCancelledError();
  if (streamError) throw new Error(streamError);
  if (exitCode !== 0) {
    throw new Error(`Harness exited with code ${exitCode ?? "unknown"}`);
  }

  return {
    text: text.trim(),
    aiCallId,
    toolCalls,
  };
}

async function runAutomationHarnessAgent(input: {
  jobRunId: string;
  context: JobContext;
  harnessId: HarnessId;
  review?: ReviewOutcome | null;
  pullRequest?: PullRequestDetails | null;
  targetRepo?: JobContext["repo"] | null;
}): Promise<AutomationAgentResult> {
  "use step";

  const sandbox =
    input.pullRequest && input.targetRepo
      ? await launchAutofixSandbox({
          context: input.context,
          pullRequest: input.pullRequest,
          targetRepo: input.targetRepo,
        })
      : await launchAutomationHarnessSandbox(input.context);
  const prompt = buildAutomationHarnessPrompt(input);
  const { createSandboxHarnessPostHandler } =
    await import("@/app/api/sandbox/[id]/harness/route");
  const response = await createSandboxHarnessPostHandler()(
    new Request(
      `https://internal.mogplex/api/sandbox/${sandbox.recordId}/harness`,
      {
        method: "POST",
        headers: buildAutofixSandboxInternalApiHeaders(input.context),
        body: JSON.stringify({
          harness: input.harnessId,
          prompt,
          mode: "AUTO",
        }),
      }
    ),
    { params: Promise.resolve({ id: sandbox.recordId }) }
  );

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok && contentType.includes("application/json")) {
    const payload = (await response.json()) as { error?: unknown };
    throw new Error(
      typeof payload.error === "string" ? payload.error : "Harness run failed"
    );
  }
  if (!response.ok) {
    throw new Error((await readTextResponse(response)) || "Harness run failed");
  }

  const streamed = await readAutomationHarnessStream({
    response,
    harnessId: input.harnessId,
    jobRunId: input.jobRunId,
    context: input.context,
  });
  const role = input.context.metadata.flow_node_role;
  const reviewOutcome =
    role === "review"
      ? parseAutomationHarnessReviewResult(streamed.text)
      : null;

  if (role === "review" && !reviewOutcome) {
    throw new Error(
      `${input.harnessId === "claude-code" ? "Claude Code" : "Codex"} completed without a structured review result`
    );
  }

  const text =
    stripAutomationHarnessReviewMarker(streamed.text) ||
    reviewOutcome?.summary ||
    "Harness completed";
  const steps: AutomationAgentResult["steps"] =
    streamed.toolCalls.length > 0
      ? [
          {
            toolCalls: streamed.toolCalls.map((toolCall) => ({
              toolName: toolCall.name,
              input: toolCall.input,
            })),
            toolResults: streamed.toolCalls.map((toolCall) => toolCall.output),
          },
        ]
      : [];

  if (reviewOutcome) {
    steps.push({
      toolCalls: [
        {
          toolName: "reportReview",
          input: reviewOutcome,
        },
      ],
      toolResults: [reviewOutcome],
    });
  }

  return {
    text,
    steps,
    usage: null,
    aiCallId: streamed.aiCallId,
  };
}

async function claimPendingJob(input: {
  jobRunId: string;
  repoId: string | null;
  installationId: number | null;
  claimedAt: string;
}) {
  const { data, error } = await supabaseAdmin.rpc("claim_automation_job_run", {
    p_job_run_id: input.jobRunId,
    p_repo_id: input.repoId,
    p_installation_id: input.installationId,
    p_claimed_at: input.claimedAt,
    p_max_running_per_installation: AUTOMATION_LIMITS.maxRunningPerInstallation,
  });

  if (error) {
    throw new Error(`Failed to claim job: ${error.message}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as {
    claimed?: boolean;
    status?: string | null;
    reason?: string | null;
    started_at?: string | null;
  } | null;

  return {
    claimed: row?.claimed === true,
    status: row?.status ?? null,
    reason: row?.reason ?? null,
    startedAt: row?.started_at ?? input.claimedAt,
  };
}

async function resetClaimedJobToPending(jobRunId: string) {
  const { error } = await supabaseAdmin
    .from("job_runs")
    .update({
      status: "pending",
      started_at: null,
      completed_at: null,
      duration_ms: null,
      input_tokens: null,
      output_tokens: null,
      error: null,
      runtime_provider: null,
      runtime_run_id: null,
      workflow_run_id: null,
    })
    .eq("id", jobRunId);

  if (error) {
    throw new Error(`Failed to reset claimed job: ${error.message}`);
  }
}

async function loadStartDispatchContext(
  jobRunId: string
): Promise<StartDispatchContext | null> {
  const { data: job, error } = await supabaseAdmin
    .from("job_runs")
    .select(
      "id, assignment_id, trigger_id, flow_id, flow_version_id, retry_of_job_run_id, metadata"
    )
    .eq("id", jobRunId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load job dispatch context: ${error.message}`);
  }

  if (!job) return null;

  const metadata = (job.metadata ?? {}) as Record<string, unknown>;

  if (job.assignment_id) {
    const { data: assignment, error: assignmentError } = await supabaseAdmin
      .from("assignments")
      .select("id, repo_id, type, repos(user_id, github_installation_id)")
      .eq("id", job.assignment_id)
      .maybeSingle();

    if (assignmentError) {
      throw new Error(
        `Failed to load assignment dispatch context: ${assignmentError.message}`
      );
    }

    const repo = Array.isArray(assignment?.repos)
      ? assignment?.repos[0]
      : assignment?.repos;
    return {
      userId: repo?.user_id || "",
      assignmentId: assignment?.id ?? job.assignment_id,
      triggerId: null,
      flowId: null,
      flowVersionId: null,
      repoId:
        assignment?.repo_id ??
        (typeof metadata.repo_id === "string" ? metadata.repo_id : null),
      installationId:
        typeof repo?.github_installation_id === "number"
          ? repo.github_installation_id
          : typeof metadata.installation_id === "number"
            ? metadata.installation_id
            : null,
      sourceKind: job.retry_of_job_run_id ? "manual_retry" : "assignment",
      sourceType:
        assignment?.type ||
        (typeof metadata.source_type === "string"
          ? metadata.source_type
          : "assignment"),
    };
  }

  if (job.trigger_id) {
    const { data: trigger, error: triggerError } = await supabaseAdmin
      .from("triggers")
      .select("id, user_id, installation_id, event")
      .eq("id", job.trigger_id)
      .maybeSingle();

    if (triggerError) {
      throw new Error(
        `Failed to load trigger dispatch context: ${triggerError.message}`
      );
    }

    return {
      userId: trigger?.user_id || "",
      assignmentId: null,
      triggerId: trigger?.id ?? job.trigger_id,
      flowId:
        typeof job.flow_id === "string"
          ? job.flow_id
          : typeof metadata.flow_id === "string"
            ? metadata.flow_id
            : null,
      flowVersionId:
        typeof job.flow_version_id === "string"
          ? job.flow_version_id
          : typeof metadata.flow_version_id === "string"
            ? metadata.flow_version_id
            : null,
      repoId: typeof metadata.repo_id === "string" ? metadata.repo_id : null,
      installationId:
        typeof trigger?.installation_id === "number"
          ? trigger.installation_id
          : typeof metadata.installation_id === "number"
            ? metadata.installation_id
            : null,
      sourceKind: job.retry_of_job_run_id ? "manual_retry" : "trigger",
      sourceType:
        trigger?.event ||
        (typeof metadata.source_type === "string"
          ? metadata.source_type
          : "trigger"),
    };
  }

  if (job.flow_id || job.flow_version_id) {
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

    const { data: flow, error: flowError } = flowId
      ? await supabaseAdmin
          .from("flows")
          .select("id, user_id, installation_id")
          .eq("id", flowId)
          .maybeSingle()
      : { data: null, error: null };

    if (flowError) {
      throw new Error(
        `Failed to load flow dispatch context: ${flowError.message}`
      );
    }

    const startConfig = flowVersionId
      ? await loadFlowDefinition(flowVersionId, flowId)
      : null;
    const flowEvent = startConfig
      ? (getStartConfig(startConfig.graph)?.event ?? null)
      : null;

    return {
      userId: flow?.user_id || "",
      assignmentId: null,
      triggerId: null,
      flowId,
      flowVersionId,
      repoId: typeof metadata.repo_id === "string" ? metadata.repo_id : null,
      installationId:
        typeof metadata.installation_id === "number"
          ? metadata.installation_id
          : typeof flow?.installation_id === "number"
            ? flow.installation_id
            : null,
      sourceKind: job.retry_of_job_run_id ? "manual_retry" : "flow",
      sourceType:
        typeof metadata.source_type === "string"
          ? metadata.source_type
          : (flowEvent ?? "flow"),
    };
  }

  return null;
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

async function recordStartDispatchEvent(input: {
  context: StartDispatchContext | null;
  jobRunId: string;
  outcome: "started" | "deferred" | "start_failed";
  reason?: string | null;
  source: JobRunStartSource;
  metadata?: Record<string, unknown> | null;
}) {
  if (!input.context?.userId) return;

  try {
    await logAutomationDispatchEvent({
      userId: input.context.userId,
      jobRunId: input.jobRunId,
      assignmentId: input.context.assignmentId,
      triggerId: input.context.triggerId,
      flowId: input.context.flowId,
      flowVersionId: input.context.flowVersionId,
      repoId: input.context.repoId,
      installationId: input.context.installationId,
      sourceKind: input.context.sourceKind,
      sourceType: input.context.sourceType,
      eventKind: "start",
      outcome: input.outcome,
      reason: input.reason ?? null,
      metadata: {
        flow_id: input.context.flowId,
        flow_version_id: input.context.flowVersionId,
        start_source: input.source,
        ...input.metadata,
      },
    });
  } catch (error) {
    console.error("[automation-job] failed to log start dispatch event", {
      jobRunId: input.jobRunId,
      outcome: input.outcome,
      reason: input.reason,
      error:
        error instanceof Error ? error.message : "Unknown dispatch event error",
    });
  }
}

async function recordControlDispatchEvent(input: {
  context: DispatchLogContext | null;
  jobRunId: string;
  outcome: "completed" | "failed";
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  if (!input.context?.userId) return;

  try {
    await logAutomationDispatchEvent({
      userId: input.context.userId,
      jobRunId: input.jobRunId,
      assignmentId: input.context.assignmentId,
      triggerId: input.context.triggerId,
      flowId: input.context.flowId,
      flowVersionId: input.context.flowVersionId,
      repoId: input.context.repoId,
      installationId: input.context.installationId,
      sourceKind: input.context.sourceKind,
      sourceType: input.context.sourceType,
      eventKind: "control",
      outcome: input.outcome,
      reason: input.reason ?? null,
      metadata: input.metadata ?? {},
    });
  } catch (error) {
    console.error("[automation-job] failed to log control dispatch event", {
      jobRunId: input.jobRunId,
      outcome: input.outcome,
      reason: input.reason,
      error:
        error instanceof Error ? error.message : "Unknown dispatch event error",
    });
  }
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

async function createFlowNodeRun(input: {
  userId: string;
  jobRunId: string;
  flowId: string;
  flowVersionId: string;
  nodeId: string;
  nodeType: string;
  nodeLabel: string | null;
  startedAt?: string;
}) {
  const startedAt = input.startedAt ?? new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("flow_node_runs")
    .insert({
      user_id: input.userId,
      job_run_id: input.jobRunId,
      flow_id: input.flowId,
      flow_version_id: input.flowVersionId,
      node_id: input.nodeId,
      node_type: input.nodeType,
      node_label: input.nodeLabel,
      status: "running",
      started_at: startedAt,
    })
    .select("id, started_at")
    .single();

  if (error) {
    throw new Error(`Failed to create flow node run: ${error.message}`);
  }

  return {
    id: data.id as string,
    startedAt: (data.started_at as string | null) ?? startedAt,
  };
}

type BestEffortFlowNodeRun = {
  id: string | null;
  startedAt: string;
  observabilityError: string | null;
};

type BestEffortFlowNodeRunCompletion = {
  durationMs: number;
  observabilityError: string | null;
};

type FlowNodeRunStatus = "success" | "failed" | "skipped" | "cancelled";

async function completeFlowNodeRun(input: {
  nodeRunId: string;
  status: FlowNodeRunStatus;
  startedAt: string;
  output?: Record<string, unknown> | null;
  error?: string | null;
}) {
  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - new Date(input.startedAt).getTime();
  const { data, error } = await supabaseAdmin
    .from("flow_node_runs")
    .update({
      status: input.status,
      completed_at: completedAt,
      duration_ms: durationMs,
      output: input.output ?? null,
      error: input.error ?? null,
    })
    .eq("id", input.nodeRunId)
    .neq("status", "cancelled")
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update flow node run: ${error.message}`);
  }

  if (!data) {
    return durationMs;
  }

  return durationMs;
}

async function createFlowNodeRunBestEffort(
  input: Parameters<typeof createFlowNodeRun>[0]
): Promise<BestEffortFlowNodeRun> {
  const startedAt = input.startedAt ?? new Date().toISOString();

  try {
    const created = await createFlowNodeRun({
      ...input,
      startedAt,
    });

    return {
      id: created.id,
      startedAt: created.startedAt,
      observabilityError: null,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create flow node run";
    console.error("[automation-job] flow node run create degraded", {
      jobRunId: input.jobRunId,
      flowId: input.flowId,
      nodeId: input.nodeId,
      error: message,
    });

    return {
      id: null,
      startedAt,
      observabilityError: buildFlowNodeRunObservabilityError({
        phase: "create",
        message,
      }),
    };
  }
}

async function completeFlowNodeRunBestEffort(input: {
  nodeRunId: string | null;
  jobRunId: string;
  flowId: string;
  nodeId: string;
  status: FlowNodeRunStatus;
  startedAt: string;
  output?: Record<string, unknown> | null;
  error?: string | null;
}): Promise<BestEffortFlowNodeRunCompletion> {
  const durationMs = Date.now() - new Date(input.startedAt).getTime();

  if (!input.nodeRunId) {
    return { durationMs, observabilityError: null };
  }

  let lastError: string | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const persistedDurationMs = await completeFlowNodeRun({
        nodeRunId: input.nodeRunId,
        status: input.status,
        startedAt: input.startedAt,
        output: input.output,
        error: input.error,
      });

      return {
        durationMs: persistedDurationMs,
        observabilityError: null,
      };
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "Failed to update flow node run";
    }
  }

  console.error("[automation-job] flow node run update degraded", {
    jobRunId: input.jobRunId,
    flowId: input.flowId,
    nodeId: input.nodeId,
    nodeRunId: input.nodeRunId,
    error: lastError,
  });

  return {
    durationMs,
    observabilityError: buildFlowNodeRunObservabilityError({
      phase: "update",
      message: lastError ?? "Failed to update flow node run",
    }),
  };
}

async function isJobRunCancellationRequested(jobRunId: string) {
  const { data, error } = await supabaseAdmin
    .from("job_runs")
    .select("status, cancel_requested_at, cancelled_at")
    .eq("id", jobRunId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load job cancellation state: ${error.message}`);
  }

  if (!data) return false;
  return (
    data.status === "cancelled" ||
    Boolean(data.cancel_requested_at) ||
    Boolean(data.cancelled_at)
  );
}

async function throwIfJobRunCancelled(jobRunId: string) {
  if (await isJobRunCancellationRequested(jobRunId)) {
    throw new JobRunCancelledError();
  }
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

async function resolveGithubToken(
  repo: JobContext["repo"],
  options?: { jobRunId?: string | null }
) {
  "use step";

  let githubToken: string | null = null;

  if (repo.github_installation_id) {
    try {
      const { token } = await createGithubInstallationAccessToken(
        repo.github_installation_id
      );
      githubToken = token;
    } catch (error) {
      const reason = classifyGithubAppTokenError(error);
      console.warn("[automation-job] falling back to user github token", {
        repoId: repo.id,
        repoFullName: repo.full_name,
        githubInstallationId: repo.github_installation_id,
        reasonCode: reason.code,
        error: reason.message,
      });
      await noteGithubTokenFallback({
        jobRunId: options?.jobRunId ?? null,
        kind: "primary",
        repo,
        resolution: "fallback_user_token",
        reasonCode: reason.code,
        reasonMessage: reason.message,
      });
    }
  }

  if (!githubToken) {
    githubToken = await getGithubAccessTokenForRepo(repo);
  }

  return githubToken;
}

export function createAutomationAgentRunner(
  overrides: Partial<AutomationAgentDeps> = {}
) {
  const deps: AutomationAgentDeps = {
    ...defaultAutomationAgentDeps,
    ...overrides,
  };

  return async function runAutomationAgent(
    context: JobContext,
    githubToken: string,
    resolvedModel: AutomationLanguageModel = fallbackAutomationModel(
      context.agent.model,
      buildAutomationGatewayContext(context)
    )
  ): Promise<AutomationAgentResult> {
    "use step";

    const assignmentType = normalizeAutomationAssignmentType(
      context.assignmentType
    );
    const prReviewNumber =
      assignmentType === "pr_review"
        ? resolvePullRequestNumber(context.metadata)
        : null;
    const [owner, repoName] = context.repo.full_name.split("/");
    const headRepoFullName =
      typeof context.metadata.head_repo_full_name === "string"
        ? context.metadata.head_repo_full_name
        : context.repo.full_name;
    const headRepoParts = splitRepoFullName(headRepoFullName) ?? {
      owner,
      repo: repoName,
    };
    const baseBranch = context.repo.default_branch || "main";

    const tools =
      assignmentType === "cron_refactor" || assignmentType === "cron"
        ? buildRefactorTools({
            skillId: context.skillId || "general-refactor",
            githubToken,
            owner,
            repo: repoName,
            branch: baseBranch,
          })
        : assignmentType === "pr_review"
          ? (() => {
              if (prReviewNumber == null) {
                throw new Error(INVALID_PR_REVIEW_CONTEXT);
              }

              return buildPRReviewTools({
                githubToken,
                owner,
                repo: repoName,
                headOwner: headRepoParts.owner,
                headRepo: headRepoParts.repo,
                prNumber: prReviewNumber,
                defaultRef:
                  typeof context.metadata.head_ref === "string"
                    ? context.metadata.head_ref
                    : undefined,
                allowPostComment: false,
              });
            })()
          : assignmentType === "push_review"
            ? buildPRReviewTools({
                githubToken,
                owner,
                repo: repoName,
                headOwner: owner,
                headRepo: repoName,
                prNumber: 0,
                allowPostComment: true,
              })
            : assignmentType === "tag_push"
              ? // Tag runs get a dedicated toolset: PR tools would 404 on
                // prNumber 0, and file reads must default to the tag ref, not
                // a default branch that may have advanced past the tag.
                buildTagPushTools({
                  githubToken,
                  owner,
                  repo: repoName,
                  tagName:
                    typeof context.metadata.tag_name === "string"
                      ? context.metadata.tag_name
                      : "",
                })
              : assignmentType === "issue_triage"
                ? buildIssueTools({
                    githubToken,
                    owner,
                    repo: repoName,
                    issueNumber: context.metadata.issue_number as number,
                  })
                : assignmentType === "ci_failure"
                  ? buildCITools({
                      githubToken,
                      owner,
                      repo: repoName,
                      revert:
                        context.metadata.flow_auto_revert === true &&
                        typeof context.metadata.head_sha === "string" &&
                        context.metadata.head_sha.length > 0
                          ? {
                              failingSha: context.metadata.head_sha,
                              // Revert against the branch the failing commit
                              // was pushed to — CI failures fire for any ref,
                              // not just the default branch. The tool's
                              // head-sha check backstops the default-branch
                              // fallback for older jobs missing head_branch.
                              branch:
                                typeof context.metadata.head_branch ===
                                  "string" &&
                                context.metadata.head_branch.length > 0
                                  ? context.metadata.head_branch
                                  : baseBranch,
                            }
                          : undefined,
                    })
                  : assignmentType === "labeled"
                    ? (() => {
                        // Label on a PR gets the PR review toolset (file access +
                        // reportReview for structured findings + postComment);
                        // label on an issue gets the triage toolset.
                        const labeledPrNumber =
                          context.metadata.is_pr === true
                            ? resolvePullRequestNumber(context.metadata)
                            : null;
                        if (labeledPrNumber != null) {
                          return buildPRReviewTools({
                            githubToken,
                            owner,
                            repo: repoName,
                            headOwner: headRepoParts.owner,
                            headRepo: headRepoParts.repo,
                            prNumber: labeledPrNumber,
                            defaultRef:
                              typeof context.metadata.head_ref === "string"
                                ? context.metadata.head_ref
                                : undefined,
                            allowPostComment: true,
                          });
                        }
                        return buildIssueTools({
                          githubToken,
                          owner,
                          repo: repoName,
                          issueNumber: context.metadata.issue_number as number,
                        });
                      })()
                    : (() => {
                        const issueNumber = context.metadata.issue_number as
                          | number
                          | undefined;
                        if (!issueNumber) {
                          return buildPRReviewTools({
                            githubToken,
                            owner,
                            repo: repoName,
                            headOwner: owner,
                            headRepo: repoName,
                            prNumber: 0,
                            allowPostComment: true,
                          });
                        }
                        return buildCommentTools({
                          githubToken,
                          owner,
                          repo: repoName,
                          issueNumber,
                        });
                      })();

    if (assignmentType === "pr_review") {
      if (prReviewNumber == null) {
        throw new Error(INVALID_PR_REVIEW_CONTEXT);
      }

      await assertPullRequestGithubAccess({
        repoFullName: context.repo.full_name,
        prNumber: prReviewNumber,
        githubToken,
      });
    }

    const runSpec = buildPromptForJob(
      assignmentType,
      {
        ...context.metadata,
        repo_full_name: context.repo.full_name,
        base_branch: baseBranch,
        skill_id: context.skillId,
      },
      context.agent.system_prompt
    );
    const gatewayContext = buildAutomationGatewayContext(
      context,
      assignmentType
    );

    const { result, metadata } = await executeAutomationTextGeneration({
      phase: assignmentType,
      requestedModelId: resolvedModel.effectiveModelId,
      // What the graph pinned. Recorded only when it differs, so an upgraded run
      // is distinguishable from one always pinned to the successor.
      pinnedModelId: context.agent.model,
      generateText: deps.generateText,
      timeoutMs: context.agent.timeout_ms,
      request: {
        model: resolvedModel.model,
        providerOptions: resolvedModel.providerOptions,
        system: buildAutomationSystem(runSpec.system, gatewayContext),
        tools: applyToolApprovalGate(tools, context, deps),
        prompt: runSpec.prompt,
        stopWhen: stepCountIs(
          getEffectiveFlowAgentMaxSteps(context.agent.max_steps)
        ),
      },
    });

    return normalizeAutomationAgentResult({
      text: result.text,
      steps: result.steps,
      totalUsage: result.totalUsage,
      execution: metadata,
    });
  };
}

const runAutomationAgent = createAutomationAgentRunner();

async function runPRFixAgentWithTools(input: {
  deps: AutomationAgentDeps;
  context: JobContext;
  review: ReviewOutcome;
  pullRequest: PullRequestDetails;
  targetRepo: JobContext["repo"];
  resolvedModel: AutomationLanguageModel;
  tools: NonNullable<Parameters<typeof generateText>[0]["tools"]>;
}) {
  const runSpec = buildPromptForPRFix(input);
  const gatewayContext = buildAutomationGatewayContext(input.context, "pr_fix");

  const { result, metadata } = await executeAutomationTextGeneration({
    phase: "pr_fix",
    requestedModelId: input.resolvedModel.effectiveModelId,
    pinnedModelId: input.context.agent.model,
    generateText: input.deps.generateText,
    timeoutMs: input.context.agent.timeout_ms,
    request: {
      model: input.resolvedModel.model,
      providerOptions: input.resolvedModel.providerOptions,
      tools: applyToolApprovalGate(input.tools, input.context, input.deps),
      system: buildAutomationSystem(undefined, gatewayContext),
      prompt: runSpec.prompt,
      stopWhen: stepCountIs(
        getEffectiveFlowAgentMaxSteps(input.context.agent.max_steps)
      ),
    },
  });

  return normalizeAutomationAgentResult({
    text: result.text,
    steps: result.steps,
    totalUsage: result.totalUsage,
    execution: metadata,
  });
}

export function createPRFixAgentRunner(
  overrides: Partial<AutomationAgentDeps> = {}
) {
  const deps: AutomationAgentDeps = {
    ...defaultAutomationAgentDeps,
    ...overrides,
  };

  return async function runPRFixAgent(
    input: {
      context: JobContext;
      review: ReviewOutcome;
      pullRequest: PullRequestDetails;
      targetRepo: JobContext["repo"];
    },
    githubToken: string,
    resolvedModel: AutomationLanguageModel = fallbackAutomationModel(
      input.context.agent.model,
      buildAutomationGatewayContext(input.context, "pr_fix")
    )
  ): Promise<AutomationAgentResult> {
    "use step";

    const [owner, repoName] = input.context.repo.full_name.split("/");
    const targetRepoParts = splitRepoFullName(input.targetRepo.full_name);
    if (!owner || !repoName) {
      throw new Error(`Invalid PR base repo: ${input.context.repo.full_name}`);
    }
    if (!targetRepoParts) {
      throw new Error(
        `Invalid autofix target repo: ${input.targetRepo.full_name}`
      );
    }

    return runPRFixAgentWithTools({
      deps,
      ...input,
      resolvedModel,
      tools: buildPRFixTools({
        githubToken,
        owner,
        repo: repoName,
        headOwner: targetRepoParts.owner,
        headRepo: targetRepoParts.repo,
        prNumber: input.pullRequest.number,
        branch: input.pullRequest.headRef,
      }),
    });
  };
}

const runPRFixAgent = createPRFixAgentRunner();

export function createSandboxPRFixAgentRunner(
  overrides: Partial<AutomationAgentDeps> = {}
) {
  const deps: AutomationAgentDeps = {
    ...defaultAutomationAgentDeps,
    ...overrides,
  };

  return async function runPRFixAgentInSandbox(
    input: {
      context: JobContext;
      review: ReviewOutcome;
      pullRequest: PullRequestDetails;
      targetRepo: JobContext["repo"];
    },
    githubToken: string,
    resolvedModel: AutomationLanguageModel = fallbackAutomationModel(
      input.context.agent.model,
      buildAutomationGatewayContext(input.context, "pr_fix")
    )
  ): Promise<AutomationAgentResult> {
    "use step";

    const [owner, repoName] = input.context.repo.full_name.split("/");
    const targetRepoParts = splitRepoFullName(input.targetRepo.full_name);
    if (!owner || !repoName) {
      throw new Error(`Invalid PR base repo: ${input.context.repo.full_name}`);
    }
    if (!targetRepoParts) {
      throw new Error(
        `Invalid autofix target repo: ${input.targetRepo.full_name}`
      );
    }

    const sandboxRef = await launchAutofixSandbox(input);
    const sandboxData =
      await loadOwnedSandboxRouteContext<AutofixSandboxRecord>(
        new Request(
          `https://internal.mogplex/api/sandbox/${sandboxRef.recordId}/autofix`,
          {
            headers: buildAutofixSandboxInternalApiHeaders(input.context),
          }
        ),
        sandboxRef.recordId,
        {
          select:
            "repo_id, sandbox_id, root_directory, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, preview_url, repo:repos(full_name, root_directory, sandbox_env_vars, env_sync_mode, vercel_project_id, vercel_team_id, github_installation_id)",
          hydrateSandboxClient: true,
        }
      );

    if (!sandboxData.ok) {
      throw new Error(sandboxData.error);
    }
    if (!sandboxData.sandbox) {
      throw new Error("Sandbox is not ready for autofix");
    }

    return runPRFixAgentWithTools({
      deps,
      ...input,
      resolvedModel,
      tools: buildSandboxPRFixTools({
        githubToken,
        owner,
        repo: repoName,
        headOwner: targetRepoParts.owner,
        headRepo: targetRepoParts.repo,
        prNumber: input.pullRequest.number,
        branch: input.pullRequest.headRef,
        sandbox: sandboxData.sandbox,
        rootDirectory: sandboxData.rootDirectory ?? null,
      }),
    });
  };
}

const runPRFixAgentInSandbox = createSandboxPRFixAgentRunner();

async function getDurationMs(startedAt: string) {
  "use step";

  return Date.now() - new Date(startedAt).getTime();
}

async function persistJobSuccess(input: {
  jobRunId: string;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
}) {
  "use step";

  const { data, error } = await supabaseAdmin
    .from("job_runs")
    .update({
      status: "success",
      completed_at: new Date().toISOString(),
      duration_ms: input.durationMs,
      // job_runs intentionally stores aggregate run totals; rich CapturedUsage
      // fields live on ai_calls, which remains the source for cost rollups.
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      error: null,
    })
    .eq("id", input.jobRunId)
    .neq("status", "cancelled")
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to persist successful job run: ${error.message}`);
  }

  return Boolean(data);
}

async function persistJobFailure(input: {
  jobRunId: string;
  error: string;
  durationMs: number;
}) {
  "use step";

  const { data, error } = await supabaseAdmin
    .from("job_runs")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      duration_ms: input.durationMs,
      error: input.error,
    })
    .eq("id", input.jobRunId)
    .neq("status", "cancelled")
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to persist failed job run: ${error.message}`);
  }

  return Boolean(data);
}

async function persistJobReviewFindings(input: {
  userId: string;
  jobRunId: string;
  repoId: string | null;
  repoFullName: string | null;
  prNumber: number | null;
  headSha: string | null;
  findings: ReviewFinding[];
}) {
  "use step";

  return replaceJobRunReviewFindings(input);
}

async function recordStartAttempt(input: {
  jobRunId: string;
  source: JobRunStartSource;
  statusHint?: string | null;
}) {
  const attemptedAt = new Date().toISOString();

  const { data, error } = await supabaseAdmin.rpc(
    "record_job_run_start_attempt",
    {
      p_job_run_id: input.jobRunId,
      p_source: input.source,
      p_attempted_at: attemptedAt,
      p_status_hint: input.statusHint ?? null,
    }
  );

  if (error) {
    throw new Error(`Failed to record job start attempt: ${error.message}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as {
    found?: boolean | null;
    attempted_at?: string | null;
  } | null;

  if (!row?.found) {
    return { attemptedAt, notFound: true as const };
  }

  return {
    attemptedAt: row.attempted_at ?? attemptedAt,
    notFound: false as const,
  };
}

async function recordStartAttemptError(input: {
  jobRunId: string;
  source: JobRunStartSource;
  attemptedAt: string;
  error: string;
}) {
  const { error } = await supabaseAdmin
    .from("job_runs")
    .update({
      last_start_attempt_at: input.attemptedAt,
      last_start_source: input.source,
      last_start_error: input.error,
    })
    .eq("id", input.jobRunId);

  if (error) {
    throw new Error(`Failed to persist start attempt error: ${error.message}`);
  }
}

async function releaseQueuedJobs(input: {
  jobRunId: string;
  releasedScope: ReleasedAutomationScope;
}) {
  "use step";

  if (
    !input.releasedScope.repoId &&
    input.releasedScope.installationId == null
  ) {
    return [];
  }

  try {
    const scopes = await loadAutomationScopesByStatus(["pending", "running"]);
    const pendingScopes = scopes.filter(
      (scope) => scope.status === "pending" && scope.jobRunId !== input.jobRunId
    );
    const runningScopes = scopes.filter(
      (scope) => scope.status === "running" && scope.jobRunId !== input.jobRunId
    );

    const nextJobIds = selectQueuedJobsToStart({
      releasedScope: {
        ...input.releasedScope,
        jobRunId: input.jobRunId,
        status: "success",
      },
      pendingScopes,
      runningScopes,
    });

    return await Promise.all(
      nextJobIds.map(async (jobRunId) => {
        try {
          const started = await startAutomationJobRun(
            jobRunId,
            "queue_release"
          );
          return {
            jobRunId,
            started: started.started,
            reason: started.reason ?? null,
          };
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Failed to release queued job";
          console.error("[automation-job] failed to release queued job", {
            sourceJobRunId: input.jobRunId,
            jobRunId,
            error: message,
          });
          return {
            jobRunId,
            started: false,
            reason: message,
          };
        }
      })
    );
  } catch (error) {
    console.error("[automation-job] failed to load queued jobs for release", {
      sourceJobRunId: input.jobRunId,
      error: error instanceof Error ? error.message : "Unknown release error",
    });
    return [];
  }
}

export function resolveAutomationAiCallModel(
  configuredModelId: string,
  execution:
    | Pick<AutomationModelExecutionMetadata, "effectiveModelIds">
    | null
    | undefined
) {
  const effectiveModelIds = execution?.effectiveModelIds ?? [];
  const seen = new Set<string>();
  const distinctEffectiveModelIds = effectiveModelIds.flatMap((modelId) => {
    const trimmed = modelId.trim();
    if (!trimmed) return [];
    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) return [];
    seen.add(normalized);
    return [trimmed];
  });

  // A single effective model can be priced and labeled accurately. When a
  // tool loop spans multiple effective models, keep the configured model on
  // the aggregate row and retain the full routing detail in execution metadata;
  // generation-ID reconciliation remains the source of truth for billed cost.
  return distinctEffectiveModelIds.length === 1
    ? distinctEffectiveModelIds[0]
    : configuredModelId;
}

async function tryLogAiCall(input: {
  context: JobContext;
  jobRunId: string;
  status: "success" | "failed";
  startedAt: string;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  error?: string | null;
  toolCalls?: Array<{
    name: string;
    input?: unknown;
    output?: unknown;
    input_preview?: string;
    output_preview?: string;
  }>;
  execution?: AutomationModelExecutionMetadata | null;
}) {
  "use step";

  const usage = resolveAutomationAiCallUsage({
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    execution: input.execution,
  });
  const partialFailure = input.status === "failed" && hasCapturedUsage(usage);
  const toolCalls = input.toolCalls || [];
  const model = resolveAutomationAiCallModel(
    input.context.agent.model,
    input.execution
  );
  const { error } = await supabaseAdmin.from("ai_calls").insert({
    user_id: input.context.repo.user_id,
    type: normalizeAutomationAssignmentType(input.context.assignmentType),
    model,
    ...capturedUsageAiCallColumns(usage),
    duration_ms: input.durationMs,
    started_at: input.startedAt,
    completed_at: new Date().toISOString(),
    status: input.status,
    error: input.error || null,
    job_run_id: input.jobRunId,
    repo_id: input.context.repo.id || null,
    tool_calls_count: toolCalls.length,
    tool_calls: toolCalls,
    metadata: {
      ...input.context.metadata,
      ...(input.execution ? { automation_execution: input.execution } : {}),
      ...(partialFailure ? { failed_with_partial_usage: true } : {}),
    },
  });

  return error?.message ?? null;
}

async function persistAutomationOutcomeMemory(input: {
  context: JobContext;
  jobRunId: string;
  outcome: "completed" | "failed";
  summary: string;
  reason?: string | null;
  execution?: AutomationModelExecutionMetadata | null;
}) {
  "use step";

  const content = input.summary.trim();
  if (!content) return;

  try {
    const { addToLane, buildLaneScopedMetadata, createMemoriesClient } =
      await import("@/lib/memories-client");

    await addToLane(
      createMemoriesClient(input.context.repo.user_id),
      "episodic",
      content,
      buildLaneScopedMetadata(
        "episodic",
        {
          job_run_id: input.jobRunId,
          assignment_type: normalizeAutomationAssignmentType(
            input.context.assignmentType
          ),
          outcome: input.outcome,
          reason: input.reason ?? null,
          agent_id: input.context.agent.id ?? null,
          agent_slug: input.context.agent.slug ?? null,
          ...(input.execution ? { automation_execution: input.execution } : {}),
        },
        {
          repoId: input.context.repo.id,
          source: "automation",
          agent:
            input.context.agent.slug ??
            input.context.agent.name ??
            "automation",
        }
      ),
      { skipEmbedding: true }
    );
  } catch (error) {
    console.warn("[automation-job] failed to persist memory", {
      jobRunId: input.jobRunId,
      repoId: input.context.repo.id,
      error: error instanceof Error ? error.message : error,
    });
  }
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

// A review node with autoMerge enabled and a clean review requests the merge;
// it is executed by the job success path only after the review check run has
// been completed, so branch protection that requires the check can pass.
type FlowAutoMergeRequest = {
  prNumber: number;
  expectedHeadSha: string | null;
  commitTitle?: string | null;
};

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

async function startTriggerAutomationRun(
  input: AutomationJobInput,
  startSource: JobRunStartSource
) {
  if (!isTriggerRuntimeConfigured()) {
    throw new Error("Trigger.dev runtime is not configured");
  }

  const handle = await tasks.trigger(TRIGGER_TASK_IDS.automationJob, input, {
    idempotencyKey: [
      "automation-job",
      input.jobRunId,
      startSource,
      input.startedAt,
    ].join(":"),
    concurrencyKey: input.releasedScope.repoId
      ? `repo:${input.releasedScope.repoId}`
      : input.releasedScope.installationId == null
        ? undefined
        : `installation:${input.releasedScope.installationId}`,
    maxAttempts: AUTOMATION_JOB_TRIGGER_MAX_ATTEMPTS,
    tags: [
      `jobRun:${input.jobRunId}`,
      `source:${input.releasedScope.sourceType}`,
      ...(input.releasedScope.repoId
        ? [`repo:${input.releasedScope.repoId}`]
        : []),
    ],
    metadata: {
      jobRunId: input.jobRunId,
      sourceType: input.releasedScope.sourceType,
      sourceKind: input.releasedScope.sourceKind,
      repoId: input.releasedScope.repoId,
      installationId: input.releasedScope.installationId,
      startSource,
    },
  });

  return {
    provider: "trigger" as const,
    runtimeRunId: handle.id,
  };
}

export async function startAutomationJobRun(
  jobRunId: string,
  source: JobRunStartSource = "webhook"
): Promise<StartedAutomationJob> {
  const { data: job, error } = await supabaseAdmin
    .from("job_runs")
    .select(
      "id, status, runtime_provider, runtime_run_id, workflow_run_id, cancel_requested_at, cancelled_at"
    )
    .eq("id", jobRunId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load job run: ${error.message}`);
  }

  if (!job) {
    return { started: false, notFound: true, status: null };
  }

  if (
    job.status === "cancelled" ||
    job.cancel_requested_at ||
    job.cancelled_at
  ) {
    return {
      started: false,
      status: "cancelled",
      runtimeProvider: job.runtime_provider ?? undefined,
      runtimeRunId: job.runtime_run_id ?? job.workflow_run_id ?? undefined,
      workflowRunId: job.workflow_run_id ?? undefined,
      reason: JOB_RUN_CANCELLED,
    };
  }

  const attempt = await recordStartAttempt({
    jobRunId,
    source,
    statusHint: job.status,
  });

  if (attempt.notFound) {
    return { started: false, notFound: true, status: null };
  }

  if (job.status !== "pending") {
    return {
      started: false,
      status: job.status,
      runtimeProvider: job.runtime_provider ?? undefined,
      runtimeRunId: job.runtime_run_id ?? job.workflow_run_id ?? undefined,
      workflowRunId: job.workflow_run_id ?? undefined,
    };
  }

  let dispatchContext: StartDispatchContext | null = null;
  let releasedScope: ReleasedAutomationScope = {
    sourceKind: "assignment",
    sourceType: "unknown",
    sourceId: null,
    repoId: null,
    installationId: null,
  };
  let claim: Awaited<ReturnType<typeof claimPendingJob>>;

  try {
    dispatchContext = await loadStartDispatchContext(jobRunId);

    const scope = await loadAutomationScopeForJobRun(jobRunId);
    releasedScope = scope
      ? {
          sourceKind: scope.sourceKind,
          sourceType: scope.sourceType,
          sourceId: scope.sourceId,
          repoId: scope.repoId,
          installationId: scope.installationId,
        }
      : releasedScope;

    claim = await claimPendingJob({
      jobRunId,
      repoId: releasedScope.repoId,
      installationId: releasedScope.installationId,
      claimedAt: attempt.attemptedAt,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to prepare job start";
    await recordStartAttemptError({
      jobRunId,
      source,
      attemptedAt: attempt.attemptedAt,
      error: message,
    });
    await recordStartDispatchEvent({
      context: dispatchContext,
      jobRunId,
      outcome: "start_failed",
      reason: message,
      source,
    });
    throw error;
  }

  if (!claim.claimed) {
    if (claim.reason === "JOB_NOT_FOUND") {
      return {
        started: false,
        notFound: true,
        status: null,
        reason: claim.reason,
      };
    }

    if (claim.reason) {
      await recordStartAttemptError({
        jobRunId,
        source,
        attemptedAt: attempt.attemptedAt,
        error: describeStartGuardReason(claim.reason as StartGuardReason),
      });
      await recordStartDispatchEvent({
        context: dispatchContext,
        jobRunId,
        outcome: "deferred",
        reason: claim.reason,
        source,
      });
      return {
        started: false,
        deferred: true,
        status: claim.status ?? "pending",
        reason: claim.reason,
      };
    }

    return {
      started: false,
      status: claim.status,
      runtimeProvider: job.runtime_provider ?? undefined,
      runtimeRunId: job.runtime_run_id ?? job.workflow_run_id ?? undefined,
      workflowRunId: job.workflow_run_id ?? undefined,
    };
  }

  let startedRun: Awaited<ReturnType<typeof startTriggerAutomationRun>>;
  try {
    startedRun = await startTriggerAutomationRun(
      {
        jobRunId,
        startedAt: claim.startedAt,
        releasedScope,
      },
      source
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to start background runtime";
    await resetClaimedJobToPending(jobRunId);
    await recordStartAttemptError({
      jobRunId,
      source,
      attemptedAt: attempt.attemptedAt,
      error: message,
    });
    await recordStartDispatchEvent({
      context: dispatchContext,
      jobRunId,
      outcome: "start_failed",
      reason: message,
      source,
    });
    throw error;
  }

  const { runtimeRunId } = startedRun;
  const { error: updateError } = await supabaseAdmin
    .from("job_runs")
    .update({
      runtime_provider: startedRun.provider,
      runtime_run_id: runtimeRunId ?? null,
      workflow_run_id: null,
      last_start_source: source,
      last_start_error: null,
    })
    .eq("id", jobRunId);

  if (updateError) {
    console.error(
      "[automation-job] failed to persist background runtime run id",
      {
        jobRunId,
        runtimeProvider: startedRun.provider,
        runtimeRunId,
        error: updateError.message,
      }
    );

    let cancelErrorMessage: string | null = null;

    if (runtimeRunId) {
      try {
        await runs.cancel(runtimeRunId);
      } catch (cancelError) {
        cancelErrorMessage =
          cancelError instanceof Error
            ? cancelError.message
            : "Unknown cancel error";
        console.error(
          "[automation-job] failed to cancel trigger run after persistence failure",
          {
            jobRunId,
            runtimeRunId,
            error: cancelErrorMessage,
          }
        );
      }
    }

    if (!cancelErrorMessage) {
      await resetClaimedJobToPending(jobRunId);
    }

    const startError = cancelErrorMessage
      ? `${RUNTIME_HANDLE_PERSIST_FAILED} (cancel rollback failed: ${cancelErrorMessage})`
      : RUNTIME_HANDLE_PERSIST_FAILED;

    await recordStartAttemptError({
      jobRunId,
      source,
      attemptedAt: attempt.attemptedAt,
      error: startError,
    });
    await recordStartDispatchEvent({
      context: dispatchContext,
      jobRunId,
      outcome: "start_failed",
      reason: RUNTIME_HANDLE_PERSIST_FAILED,
      source,
      metadata: {
        runtime_provider: startedRun.provider,
        runtime_run_id: runtimeRunId ?? null,
        persist_error: updateError.message,
        cancel_error: cancelErrorMessage,
      },
    });

    return {
      started: false,
      status: cancelErrorMessage ? "running" : "pending",
      reason: RUNTIME_HANDLE_PERSIST_FAILED,
    };
  }

  await recordStartDispatchEvent({
    context: dispatchContext,
    jobRunId,
    outcome: "started",
    source,
  });

  return {
    started: true,
    status: "running",
    runtimeProvider: startedRun.provider,
    runtimeRunId,
  };
}

export function serializeAutomationJobStart(started: StartedAutomationJob) {
  return {
    started: started.started,
    deferred: started.deferred ?? false,
    reason: started.reason ?? null,
    status: started.status ?? null,
    runtimeProvider: started.runtimeProvider ?? null,
    runtimeRunId: started.runtimeRunId ?? started.workflowRunId ?? null,
    workflowRunId: started.workflowRunId ?? null,
  };
}
