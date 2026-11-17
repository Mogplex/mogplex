import { isTriggerRuntimeConfigured } from "@/lib/runtime-providers";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";

/**
 * How the reply relates to the checkpoint. `review` (default): feedback on
 * implemented work, or approval to ship. `plan`: revise the plan and pause
 * again before changing files. `plan_reply`: a free-form reply to a plan;
 * the agent decides whether it approves or revises.
 */
export type ResumeMode = "review" | "plan" | "plan_reply" | "delivery";

export type ResumeExternalAgentRunPayload = {
  runId: string;
  userId: string;
  /** The user's steering reply that triggered this resume. */
  steer: string;
  mode?: ResumeMode;
  followThrough?: boolean;
  checkpointAiCallId?: string;
  delivery?: { headSha: string; revision: string };
};

/**
 * Queues a resume segment on Trigger. A resume can't run inline in the Slack
 * event task (a segment can take many minutes), so the Slack reply handler
 * dispatches it here. Resumes of the same run share a concurrency key so they
 * serialize; the caller owns idempotency (e.g. keyed on the Slack message ts).
 */
type TriggerHandle = { id?: string | null };
type TriggerResumeTask = (
  taskId: string,
  payload: ResumeExternalAgentRunPayload,
  options: Record<string, unknown>
) => Promise<TriggerHandle>;

type QueueResumeDeps = {
  isRuntimeConfigured: () => boolean;
  triggerTask: TriggerResumeTask;
};

async function defaultTriggerResumeTask(
  taskId: string,
  payload: ResumeExternalAgentRunPayload,
  options: Record<string, unknown>
): Promise<TriggerHandle> {
  const { tasks } = await import("@trigger.dev/sdk/v3");
  return tasks.trigger(taskId, payload, options);
}

export async function queueResumeExternalAgentRun(
  input: {
    runId: string;
    userId: string;
    repoId: string;
    steer: string;
    mode?: ResumeMode;
    followThrough?: boolean;
    checkpointAiCallId?: string;
    delivery?: { headSha: string; revision: string };
    idempotencyKey: string;
  },
  overrides: Partial<QueueResumeDeps> = {}
): Promise<{ runtimeProvider: "trigger"; runtimeRunId: string | null }> {
  const deps: QueueResumeDeps = {
    isRuntimeConfigured: isTriggerRuntimeConfigured,
    triggerTask: defaultTriggerResumeTask,
    ...overrides,
  };

  if (!deps.isRuntimeConfigured()) {
    throw new Error("Trigger.dev runtime is not configured");
  }

  const handle = await deps.triggerTask(
    TRIGGER_TASK_IDS.resumeAgentRun,
    {
      runId: input.runId,
      userId: input.userId,
      steer: input.steer,
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.followThrough ? { followThrough: true } : {}),
      ...(input.checkpointAiCallId
        ? { checkpointAiCallId: input.checkpointAiCallId }
        : {}),
      ...(input.delivery ? { delivery: input.delivery } : {}),
    },
    {
      idempotencyKey: input.idempotencyKey,
      concurrencyKey: `resume-agent-run:${input.runId}`,
      maxAttempts: 1,
      tags: [
        `user:${input.userId}`,
        `repo:${input.repoId}`,
        `external-run:${input.runId}`,
      ],
      metadata: {
        runId: input.runId,
        userId: input.userId,
        repoId: input.repoId,
      },
    }
  );

  return {
    runtimeProvider: "trigger",
    runtimeRunId: handle.id ?? null,
  };
}
