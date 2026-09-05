import { AbortTaskRunError, metadata, task } from "@trigger.dev/sdk/v3";
import { executeExternalAgentRun } from "@/lib/mogplex-api/run-execution";
import { superviseExternalAgentRun } from "@/lib/mogplex-api/run-supervisor";
import { notifyControlWorkerCompletion } from "@/lib/control/continuation-dispatch";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import type { ExternalAgentRunExecutionPayload } from "@/lib/mogplex-api/run-execution";

export const executeExternalAgentRunWorkerTask = task({
  id: TRIGGER_TASK_IDS.externalAgentRunWorker,
  maxDuration: 60 * 30,
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: ExternalAgentRunExecutionPayload) => {
    metadata.set("runId", payload.runId);
    metadata.set("userId", payload.userId);

    const result = await executeExternalAgentRun(payload);
    metadata.set("status", result.status);
    metadata.set("success", result.success);
    if (result.error) metadata.set("error", result.error);

    if (!result.success && result.status !== "cancelled") {
      throw new AbortTaskRunError(result.error || "External agent run failed");
    }

    return result;
  },
});

export const executeExternalAgentRunTask = task({
  id: TRIGGER_TASK_IDS.externalAgentRun,
  maxDuration: 60 * 30,
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10_000,
    factor: 2,
  },
  run: async (payload: ExternalAgentRunExecutionPayload, { ctx }) => {
    metadata.set("runId", payload.runId);
    metadata.set("userId", payload.userId);
    const result = await superviseExternalAgentRun(payload, ctx.run.id);
    // A supervisor retry reuses the completed worker and retries only delivery.
    // Awaiting-input also wakes the coordinator to explain the blocker.
    await notifyControlWorkerCompletion(payload.userId, payload.runId);
    metadata.set("status", result.status);
    metadata.set("success", result.success);
    if (!result.success && result.status !== "cancelled") {
      throw new AbortTaskRunError(result.error || "External agent run failed");
    }
    return result;
  },
});
