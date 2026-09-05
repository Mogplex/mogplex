import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import { loadRunForExecution } from "./run-execution-data";
import {
  finalizeRunAfterWorkerExit,
  isTerminalRunStatus,
  type RuntimeFinalizationDeps,
} from "./run-runtime-reconciliation";
import { runtimeCompletion } from "./run-runtime";
import type {
  ExternalAgentRunExecutionPayload,
  ExternalAgentRunExecutionResult,
} from "./run-execution-finalize";
import type { executeExternalAgentRunWorkerTask } from "@/trigger/external-agent-run";

type WorkerResult =
  | { ok: true; output: ExternalAgentRunExecutionResult }
  | { ok: false; error: unknown };
async function waitForWorker(
  payload: ExternalAgentRunExecutionPayload,
  idempotencyKey: string
): Promise<WorkerResult> {
  const { tasks } = await import("@trigger.dev/sdk/v3");
  return tasks.triggerAndWait<typeof executeExternalAgentRunWorkerTask>(
    TRIGGER_TASK_IDS.externalAgentRunWorker,
    payload,
    { idempotencyKey, maxAttempts: 1 }
  );
}

export async function superviseExternalAgentRun(
  payload: ExternalAgentRunExecutionPayload,
  supervisorRunId: string,
  overrides: Partial<RuntimeFinalizationDeps> & {
    waitForWorker?: typeof waitForWorker;
  } = {}
): Promise<ExternalAgentRunExecutionResult> {
  const loadRun = overrides.loadRun ?? loadRunForExecution;
  const before = await loadRun(payload.runId, payload.userId);
  const notFound: ExternalAgentRunExecutionResult = {
    success: false,
    runId: payload.runId,
    status: "not_found",
    error: "External agent run not found",
  };
  if (!before) return notFound;
  if (before.runtime_run_id && before.runtime_run_id !== supervisorRunId) {
    throw new Error("This worker no longer owns the external run");
  }

  const completion = { status: "completed" as const, error: null };
  let workerCompletion: ReturnType<typeof runtimeCompletion> = completion;
  if (
    !isTerminalRunStatus(before.status) &&
    before.status !== "awaiting_input"
  ) {
    // Trigger checkpoints this lightweight parent while the child executes.
    // Its wait does not consume maxDuration; retries reuse the same child.
    const result = await (overrides.waitForWorker ?? waitForWorker)(
      payload,
      `external-worker:${supervisorRunId}`
    );
    if (!result.ok) {
      const code =
        result.error &&
        typeof result.error === "object" &&
        "code" in result.error
          ? result.error.code
          : null;
      workerCompletion = runtimeCompletion(
        code === "MAX_DURATION_EXCEEDED" ? "TIMED_OUT" : "FAILED"
      );
    }
  }
  const after = await loadRun(payload.runId, payload.userId);
  if (!after) return notFound;
  // The launch request may write runtime_run_id after the task starts. Pin
  // reconciliation to this supervisor, never to another queued segment.
  if (after.runtime_run_id !== supervisorRunId)
    throw new Error("External run runtime binding changed");
  const run = await finalizeRunAfterWorkerExit(
    after,
    workerCompletion ?? completion,
    overrides
  );
  if (!run) return notFound;
  if (run.status === "pending" || run.status === "streaming")
    throw new Error("Worker exited without finalizing its run");
  return {
    success: run.status === "success" || run.status === "awaiting_input",
    runId: run.id,
    status: run.status,
    error: run.error,
  };
}
