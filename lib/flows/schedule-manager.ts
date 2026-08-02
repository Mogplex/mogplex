import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";

type ScheduleConfig = {
  cron: string;
  timezone: string;
};

type ScheduleApi = Pick<
  typeof import("@trigger.dev/sdk/v3").schedules,
  "create" | "update" | "del"
>;

function isNotFoundError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 404
  );
}

function scheduleDeduplicationKey(flowId: string) {
  const environment =
    process.env.VERCEL_ENV?.trim() ||
    process.env.NODE_ENV?.trim() ||
    "development";
  const branch = process.env.VERCEL_GIT_COMMIT_REF?.trim();
  return [
    environment,
    ...(environment === "preview" && branch ? [branch] : []),
    "workflow",
    flowId,
  ].join(":");
}

export async function upsertFlowSchedule(
  flowId: string,
  config: ScheduleConfig,
  scheduleId?: string | null,
  scheduleApi?: ScheduleApi
) {
  const schedules =
    scheduleApi ?? (await import("@trigger.dev/sdk/v3")).schedules;
  if (scheduleId) {
    try {
      const schedule = await schedules.update(scheduleId, {
        task: TRIGGER_TASK_IDS.workflowSchedule,
        cron: config.cron,
        timezone: config.timezone,
        externalId: flowId,
      });
      return schedule.id;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }

  const schedule = await schedules.create({
    task: TRIGGER_TASK_IDS.workflowSchedule,
    cron: config.cron,
    timezone: config.timezone,
    externalId: flowId,
    deduplicationKey: scheduleDeduplicationKey(flowId),
  });
  return schedule.id;
}

export async function activateFlowSchedule(scheduleId: string) {
  const { schedules } = await import("@trigger.dev/sdk/v3");
  await schedules.activate(scheduleId);
}

export async function deactivateFlowSchedule(scheduleId: string) {
  const { schedules } = await import("@trigger.dev/sdk/v3");
  await schedules.deactivate(scheduleId);
}

export async function deleteFlowSchedule(
  scheduleId: string,
  scheduleApi?: ScheduleApi
) {
  const schedules =
    scheduleApi ?? (await import("@trigger.dev/sdk/v3")).schedules;
  try {
    await schedules.del(scheduleId);
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}
