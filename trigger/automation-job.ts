import { AbortTaskRunError, metadata, task } from "@trigger.dev/sdk/v3";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import {
  AUTOMATION_JOB_TRIGGER_MAX_ATTEMPTS,
  JOB_RUN_CANCELLED,
  executeAutomationJobRun,
  type AutomationJobInput,
  type AutomationJobRunResult,
} from "@/lib/workflows/automation-job-workflow";

type TriggerAutomationJobDeps = {
  executeAutomationJobRun: typeof executeAutomationJobRun;
  metadata: Pick<typeof metadata, "set">;
};

const defaultDeps: TriggerAutomationJobDeps = {
  executeAutomationJobRun,
  metadata,
};

export const AUTOMATION_JOB_TRIGGER_MAX_DURATION_SECONDS = 60 * 30;

export async function runTriggerAutomationJob(
  payload: AutomationJobInput,
  overrides: Partial<TriggerAutomationJobDeps> = {}
): Promise<AutomationJobRunResult> {
  const deps: TriggerAutomationJobDeps = {
    ...defaultDeps,
    ...overrides,
  };

  deps.metadata.set("jobRunId", payload.jobRunId);
  deps.metadata.set("repoId", payload.releasedScope.repoId);
  deps.metadata.set("installationId", payload.releasedScope.installationId);
  deps.metadata.set("sourceType", payload.releasedScope.sourceType);

  const result = await deps.executeAutomationJobRun(payload);

  if (result.observabilityError) {
    deps.metadata.set("observabilityError", result.observabilityError);
  }

  if (result.success) {
    return result;
  }

  if (result.error === JOB_RUN_CANCELLED) {
    return result;
  }

  if (result.modelFailure) {
    deps.metadata.set("modelPhase", result.modelFailure.phase);
    deps.metadata.set("modelFailureClass", result.modelFailure.failureClass);
    deps.metadata.set("modelFailureStatusCode", result.modelFailure.statusCode);
    deps.metadata.set("modelAttempts", result.modelFailure.attempts);
    deps.metadata.set("modelRetryCount", result.modelFailure.retryCount);
  }

  // AbortTaskRunError for every model failure, including the retryable classes.
  // The reason is side effects, not the failure's nature: by the time
  // executeAutomationJobRun returns a modelFailure it has already published a
  // GitHub check run and PR comment, persisted the job failure, recorded a
  // dispatch event, written an ai_calls row, and released queued jobs. A
  // task-level re-run repeats all of it — a second check run and comment on the
  // PR, duplicate telemetry — so "retryable" here cannot mean "re-run the job".
  //
  // An earlier revision of this branch let `dependency_unavailable` through as a
  // plain Error to restore recovery after the allowlist gate started failing
  // closed. That was wrong for exactly the reason above. Recovery for that case
  // lives where it belongs instead: loadTeamAllowlistState retries the read once
  // before it can ever become a failure, so a blip is absorbed before any of
  // this bookkeeping runs.
  //
  // Retrying other resolution-time failures needs the same treatment — at the
  // resolution call site, ahead of the side effects — which is #766.
  throw new AbortTaskRunError(result.error);
}

export const executeAutomationJobTask = task({
  id: TRIGGER_TASK_IDS.automationJob,
  maxDuration: AUTOMATION_JOB_TRIGGER_MAX_DURATION_SECONDS,
  retry: {
    maxAttempts: AUTOMATION_JOB_TRIGGER_MAX_ATTEMPTS,
  },
  run: async (payload: AutomationJobInput) => runTriggerAutomationJob(payload),
});
