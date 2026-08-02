import { AbortTaskRunError, metadata, task } from "@trigger.dev/sdk/v3";
import { executeExternalAgentRun } from "@/lib/mogplex-api/run-execution";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import type { ExternalAgentRunExecutionPayload } from "@/lib/mogplex-api/run-execution";

export const executeExternalAgentRunTask = task({
  id: TRIGGER_TASK_IDS.externalAgentRun,
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
