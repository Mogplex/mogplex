/**
 * Type definitions and constants for the automation job workflow.
 * Extracted from automation-job-workflow.ts for modularity.
 */

import type { AutomationModelExecutionMetadata } from "@/lib/workflows/automation-model-execution-types";
import type { FlowGraph } from "@/lib/types";
import type { BackgroundRuntimeProvider } from "@/lib/runtime-providers";
import type { AutomationScope } from "@/lib/workflows/automation-guardrails";
import type { ResolvedUserLanguageModel } from "@/lib/ai-model-resolver";

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

export type JobContext = {
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
export type FlowAgentConfig = {
  id: string;
  name: string | null;
  slug: string | null;
  system_prompt: string | null;
  max_steps: number | null;
  timeout_ms: number | null;
};

export type ResolvedFlowDefinition = {
  flowId: string;
  flowVersionId: string;
  graph: FlowGraph;
  agentsById: Map<string, FlowAgentConfig>;
};

export type StartedAutomationJob = {
  started: boolean;
  notFound?: boolean;
  status?: string | null;
  runtimeProvider?: BackgroundRuntimeProvider;
  runtimeRunId?: string;
  workflowRunId?: string;
  deferred?: boolean;
  reason?: string | null;
};

export type JobRunRuntimeDetails = {
  provider: BackgroundRuntimeProvider | null;
  runId: string | null;
};

export type ResolvedJobContext =
  | {
      context: JobContext;
      flow?: ResolvedFlowDefinition | null;
      runtime?: JobRunRuntimeDetails | null;
    }
  | { error: "JOB_NOT_FOUND" | "MISSING_CONFIG" };

export type StartDispatchContext = {
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

export type AutomationAgentUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
};

export type AutomationAgentResult = {
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
export type AutomationLanguageModel = ResolvedUserLanguageModel & {
  effectiveModelId: string;
};

export type PullRequestDetails = {
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

export type AutomationSandboxRef = {
  recordId: string;
  sandboxId: string | null;
  rootDirectory: string | null;
};

export type AutofixSandboxRecord = {
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

export type DispatchLogContext = {
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

export type FlowExecutionToken = {
  fromNodeId: string;
  label: string;
  text: string;
  skipped: boolean;
  payload?: Record<string, unknown> | null;
};

export type RepoVariant = JobContext["repo"] & {
  root_directory?: string | null;
  parent_repo_id?: string | null;
};

export type BestEffortFlowNodeRun = {
  id: string | null;
  startedAt: string;
  observabilityError: string | null;
};

export type BestEffortFlowNodeRunCompletion = {
  durationMs: number;
  observabilityError: string | null;
};

export type FlowNodeRunStatus = "success" | "failed" | "skipped" | "cancelled";

// A review node with autoMerge enabled and a clean review requests the merge;
// it is executed by the job success path only after the review check run has
// been completed, so branch protection that requires the check can pass.
export type FlowAutoMergeRequest = {
  prNumber: number;
  expectedHeadSha: string | null;
  commitTitle?: string | null;
};

// Constants
export const RUNTIME_HANDLE_PERSIST_FAILED = "RUNTIME_HANDLE_PERSIST_FAILED";
export const AUTOMATION_JOB_TRIGGER_MAX_ATTEMPTS = 1;
export const JOB_RUN_CANCELLED = "JOB_RUN_CANCELLED";
export const INVALID_PR_REVIEW_CONTEXT =
  "Missing pull request context for PR review";
export const GITHUB_PR_ACCESS_FAILURE_PREFIX = "GitHub PR access failed";
export const AUTOMATION_GATEWAY_CACHING_ENV = "AUTOMATION_GATEWAY_CACHING";

export class JobRunCancelledError extends Error {
  constructor() {
    super(JOB_RUN_CANCELLED);
    this.name = "JobRunCancelledError";
  }
}

// Re-export types for external consumers
export type { FlowAgentNodeRole, FlowGraph, SandboxRecord } from "@/lib/types";
export type { BackgroundRuntimeProvider } from "@/lib/runtime-providers";
export type { AutomationScope } from "@/lib/workflows/automation-guardrails";
export type { AutomationModelExecutionMetadata } from "@/lib/workflows/automation-model-execution-types";
export type { ResolvedUserLanguageModel } from "@/lib/ai-model-resolver";
