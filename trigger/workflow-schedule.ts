import { logger, metadata, schedules } from "@trigger.dev/sdk/v3";
import { dispatchFlowTrigger } from "@/lib/flows/trigger-dispatch";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";

export type WorkflowSchedulePayload = {
  scheduleId: string;
  timestamp: Date;
  lastTimestamp?: Date;
  externalId?: string;
  timezone: string;
};

export async function runWorkflowSchedule(
  payload: WorkflowSchedulePayload,
  dispatch: typeof dispatchFlowTrigger = dispatchFlowTrigger
) {
  const flowId = payload.externalId?.trim();
  if (!flowId) {
    throw new Error("Scheduled workflow is missing its flow externalId");
  }

  const scheduledAt = payload.timestamp.toISOString();
  const result = await dispatch({
    flowId,
    event: "schedule",
    idempotencyKey: `workflow-schedule:${payload.scheduleId}:${scheduledAt}`,
    startSource: "cron",
    payload: {
      scheduled_at: scheduledAt,
      previous_scheduled_at: payload.lastTimestamp?.toISOString() ?? null,
      timezone: payload.timezone,
      schedule_id: payload.scheduleId,
    },
  });
  return { flowId, scheduledAt, result };
}

export const workflowScheduleTask = schedules.task({
  id: TRIGGER_TASK_IDS.workflowSchedule,
  maxDuration: 60,
  retry: { maxAttempts: 2 },
  run: async (payload) => {
    const { flowId, scheduledAt, result } = await runWorkflowSchedule(payload);
    metadata.set("flowId", flowId);
    metadata.set("scheduledAt", scheduledAt);
    metadata.set("scheduleId", payload.scheduleId);

    logger.info("Scheduled workflow dispatch completed", result);
    return result;
  },
});
