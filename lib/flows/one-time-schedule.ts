import { runs, tasks } from "@trigger.dev/sdk/v3";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import { isValidRunAt } from "./one-time-config";

export async function cancelOneTimeSchedule(runId: string | null | undefined) {
  if (!runId) return;
  try {
    await runs.cancel(runId);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      error.status === 404
    )
      return;
    throw error;
  }
}

export async function armOneTimeSchedule(input: {
  flowId: string;
  userId: string;
  versionId: string;
  runAt: string;
  previousRunId?: string | null;
}) {
  // Callers check the future timestamp before changing publication state.
  // If provider I/O made that valid timestamp become due, dispatch now.
  if (!isValidRunAt(input.runAt))
    throw new Error("Run once requires a valid ISO timestamp.");
  await cancelOneTimeSchedule(input.previousRunId);
  const handle = await tasks.trigger(
    TRIGGER_TASK_IDS.workflowOnce,
    {
      flowId: input.flowId,
      versionId: input.versionId,
      runAt: new Date(input.runAt).toISOString(),
    },
    Date.parse(input.runAt) > Date.now() ? { delay: new Date(input.runAt) } : {}
  );
  const { error } = await supabaseAdmin
    .from("flows")
    .update({ trigger_once_run_id: handle.id })
    .eq("id", input.flowId)
    .eq("user_id", input.userId);
  if (error) {
    await cancelOneTimeSchedule(handle.id);
    throw new Error("Could not save the one-time schedule.");
  }
  return handle.id;
}
