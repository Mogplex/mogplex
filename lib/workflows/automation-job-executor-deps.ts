/**
 * Executor dependencies for automation jobs.
 *
 * Contains the AutomationJobExecutorDeps type, default dependency
 * implementations, runner constants, and phase model resolution.
 * Extracted from automation-job-workflow.ts for modularity.
 */

import {
  clearPrReviewTimelineComment,
  completePrReviewCheckRun,
  createPrReviewGithubReview,
  createPrReviewCheckRun,
  upsertPrReviewTimelineComment,
} from "@/lib/github-check-runs";
import {
  supabaseWaitStore,
  triggerWaitProvider,
} from "@/lib/flows/wait-service";
import type {
  FlowOperatorWaitProvider,
  FlowOperatorWaitStore,
} from "@/lib/flows/operators/types";
import type { GatewayCallContext } from "@/lib/models/gateway-provider-routing";

import {
  loadPullRequestDetails,
  fetchPrLiveness,
  resolveAutofixGithubToken,
  resolveAutofixTargetRepo,
  resolveGithubToken,
} from "@/lib/workflows/automation-job-github";
import { recordControlDispatchEvent } from "@/lib/workflows/automation-job-dispatch";
import { finalizeJobRunCancelled } from "@/lib/workflows/job-run-cancel-persistence";
import {
  isJobRunCancellationRequested,
  throwIfJobRunCancelled,
} from "@/lib/workflows/automation-job-flow-nodes";
import {
  getDurationMs,
  persistJobFailure,
  persistJobReviewFindings,
  persistJobSuccess,
  tryLogAiCall,
} from "@/lib/workflows/automation-job-persistence";
import { runFlowAction } from "@/lib/workflows/automation-job-sandbox-actions";
import {
  createAutomationAgentRunner,
  createPRFixAgentRunner,
  createSandboxPRFixAgentRunner,
} from "@/lib/workflows/automation-job-agent-runners";
import { runAutomationHarnessAgent } from "@/lib/workflows/automation-job-harness";
import { resolveAutomationModel } from "@/lib/workflows/automation-job-model-resolution";
import {
  releaseQueuedJobs,
  resolveJobContext,
} from "@/lib/workflows/automation-job-context-resolution";
import { asAutomationModelExecutionError } from "@/lib/workflows/automation-model-execution";

/**
 * Runner constants for automation agent execution.
 */
export const runAutomationAgent = createAutomationAgentRunner();

export const runPRFixAgent = createPRFixAgentRunner();

export const runPRFixAgentInSandbox = createSandboxPRFixAgentRunner();

/**
 * Dependencies for automation job execution.
 */
export type AutomationJobExecutorDeps = {
  resolveJobContext: typeof resolveJobContext;
  resolveGithubToken: typeof resolveGithubToken;
  createPrReviewCheckRun: typeof createPrReviewCheckRun;
  completePrReviewCheckRun: typeof completePrReviewCheckRun;
  createPrReviewGithubReview: typeof createPrReviewGithubReview;
  clearPrReviewTimelineComment: typeof clearPrReviewTimelineComment;
  upsertPrReviewTimelineComment: typeof upsertPrReviewTimelineComment;
  resolveAutomationModel: typeof resolveAutomationModel;
  loadPullRequestDetails: typeof loadPullRequestDetails;
  fetchPrLiveness: typeof fetchPrLiveness;
  persistJobCancelled: typeof finalizeJobRunCancelled;
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

/**
 * Default implementation of executor dependencies.
 */
export const defaultAutomationJobExecutorDeps: AutomationJobExecutorDeps = {
  resolveJobContext,
  resolveGithubToken,
  createPrReviewCheckRun,
  completePrReviewCheckRun,
  createPrReviewGithubReview,
  clearPrReviewTimelineComment,
  upsertPrReviewTimelineComment,
  resolveAutomationModel,
  loadPullRequestDetails,
  fetchPrLiveness,
  persistJobCancelled: finalizeJobRunCancelled,
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

/**
 * Resolve the automation model for a specific execution phase,
 * wrapping errors in AutomationModelExecutionError.
 */
export async function resolveAutomationModelForPhase(input: {
  deps: AutomationJobExecutorDeps;
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
