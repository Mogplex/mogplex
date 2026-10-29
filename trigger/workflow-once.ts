import { task } from "@trigger.dev/sdk/v3";
import { runWithFlowActivationLock } from "@/lib/flows/activation-lock";
import { dispatchFlowTrigger } from "@/lib/flows/trigger-dispatch";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";

export type WorkflowOncePayload = {
  flowId: string;
  versionId: string;
  runAt: string;
};

export const WORKFLOW_ONCE_RETRY = {
  // A due dispatch may race the publisher that is still persisting its handle.
  // Provider-managed backoff leaves several minutes for that lock to release.
  maxAttempts: 10,
  minTimeoutInMs: 5000,
  maxTimeoutInMs: 30000,
  factor: 2,
  randomize: true,
};

export async function runWorkflowOnce(
  payload: WorkflowOncePayload,
  runtimeRunId: string,
  dispatch = dispatchFlowTrigger
) {
  return runWithFlowActivationLock(payload.flowId, async () => {
    const result = await dispatch({
      flowId: payload.flowId,
      expectedVersionId: payload.versionId,
      expectedRunAt: payload.runAt,
      expectedRuntimeRunId: runtimeRunId,
      event: "schedule",
      idempotencyKey: `workflow-once:${payload.flowId}:${payload.versionId}`,
      startSource: "cron",
      payload: { scheduled_at: payload.runAt, run_once: true },
    });
    if (
      result.outcome === "queued" ||
      result.reason === "IDEMPOTENT_DUPLICATE"
    ) {
      const { error } = await supabaseAdmin
        .from("flows")
        .update({ status: "inactive", trigger_once_run_id: null })
        .eq("id", payload.flowId)
        .eq("published_version_id", payload.versionId)
        .eq("trigger_once_run_id", runtimeRunId);
      if (error)
        throw new Error("Could not mark the one-time schedule as dispatched.");
    } else if (result.matched) {
      throw new Error(`One-time workflow was not queued: ${result.reason}`);
    }
    return result;
  });
}

export const workflowOnceTask = task({
  id: TRIGGER_TASK_IDS.workflowOnce,
  maxDuration: 60,
  retry: WORKFLOW_ONCE_RETRY,
  run: (payload: WorkflowOncePayload, { ctx }) =>
    runWorkflowOnce(payload, ctx.run.id),
  onFailure: async ({ payload, ctx }) =>
    recordWorkflowOnceFailure(payload, ctx.run.id),
});

/** Runs after exhausted dispatch attempts; never disarm a replacement. */
export async function recordWorkflowOnceFailure(
  payload: WorkflowOncePayload,
  runtimeRunId: string
) {
  return runWithFlowActivationLock(payload.flowId, async () => {
    const { error } = await supabaseAdmin
      .from("flows")
      .update({ status: "inactive", trigger_once_run_id: null })
      .eq("id", payload.flowId)
      .eq("published_version_id", payload.versionId)
      .eq("trigger_once_run_id", runtimeRunId);
    if (error)
      throw new Error("Could not record the failed one-time dispatch.");
  });
}
