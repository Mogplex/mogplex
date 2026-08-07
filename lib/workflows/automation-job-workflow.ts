/**
 * Automation job workflow entry point.
 *
 * This is the main entry module for automation job execution. It exports
 * the public surface for job execution (createAutomationJobExecutor,
 * executeAutomationJobRun, createAutomationJobTask, automationJobTask)
 * and re-exports types/utilities from extracted modules.
 *
 * Implementation is delegated to:
 * - automation-job-executor-deps.ts: deps type and defaults
 * - automation-job-context-executor.ts: context execution
 * - automation-job-executor-core.ts: full job orchestration
 */

import type {
  AutomationJobInput,
  AutomationJobRunResult,
} from "@/lib/workflows/automation-job-types";
import {
  type AutomationJobExecutorDeps,
  defaultAutomationJobExecutorDeps,
} from "@/lib/workflows/automation-job-executor-deps";
import { runAutomationJob } from "@/lib/workflows/automation-job-executor-core";

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
export {
  extractFlowReviewOutcome,
  resolveFlowAgentNodeRole,
  synthesizeReviewOutcomeFromComment,
} from "@/lib/workflows/automation-job-review-outcome";
export {
  getAutoMergeHeadBlockReason,
  getPrReviewAutoMergeBlockReason,
  hydrateFlowPullRequestHeadContext,
  resolveAutoMergeExpectedHeadSha,
} from "@/lib/workflows/automation-job-auto-merge";

// Re-export deps type for external consumers (e.g. tests)
export type { AutomationJobExecutorDeps } from "@/lib/workflows/automation-job-executor-deps";

/**
 * Create an automation job executor with optional dependency overrides.
 *
 * Returns an async function that executes automation jobs with full
 * orchestration: context resolution, agent execution, and result handling.
 */
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
    return runAutomationJob(deps, input);
  };
}

/**
 * Default automation job executor with standard dependencies.
 */
export const executeAutomationJobRun = createAutomationJobExecutor();

/**
 * Create an automation job task with optional dependency overrides.
 *
 * Returns a task function suitable for use with trigger.dev.
 */
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

/**
 * Default automation job task with standard dependencies.
 */
export const automationJobTask = createAutomationJobTask();
