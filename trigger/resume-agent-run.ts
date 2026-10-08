import { AbortTaskRunError, metadata, task } from "@trigger.dev/sdk/v3";
import { resumeExternalAgentRun } from "@/lib/mogplex-api/run-resume";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import { AGENT_WORKER_MAX_DURATION_SECONDS } from "@/lib/trigger/agent-worker-duration";
import type { ResumeExternalAgentRunPayload } from "@/lib/mogplex-api/run-resume";

export const executeResumeAgentRunTask = task({
  id: TRIGGER_TASK_IDS.resumeAgentRun,
  maxDuration: AGENT_WORKER_MAX_DURATION_SECONDS,
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: ResumeExternalAgentRunPayload) => {
    metadata.set("runId", payload.runId);
    metadata.set("userId", payload.userId);

    const result = await resumeExternalAgentRun(payload);
    metadata.set("status", result.status);
    metadata.set("success", result.success);
    if (result.error) metadata.set("error", result.error);

    if (!result.success && result.status !== "cancelled") {
      throw new AbortTaskRunError(result.error || "Resume agent run failed");
    }

    return result;
  },
});
