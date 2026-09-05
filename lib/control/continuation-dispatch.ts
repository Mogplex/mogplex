import { supabaseAdmin } from "@/lib/supabase/admin";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import {
  continuationsForWorker,
  refreshControlContinuation,
  type ControlContinuation,
} from "./continuation-store";

async function triggerContinuation(
  ticket: ControlContinuation
): Promise<{ id: string }> {
  const { tasks } = await import("@trigger.dev/sdk/v3");
  return tasks.trigger(
    TRIGGER_TASK_IDS.controlContinuation,
    {
      userId: ticket.user_id,
      continuationId: ticket.id,
    },
    { idempotencyKey: `control-continuation:${ticket.id}`, maxAttempts: 1 }
  );
}

/** Delivery may repeat; the Trigger key and SQL execution claim both dedupe it.
 * Waiting is represented by a DB row, not a polling loop or expiring timer. */
export async function dispatchControlContinuation(
  userId: string,
  id: string,
  deps: {
    client?: typeof supabaseAdmin;
    trigger?: typeof triggerContinuation;
  } = {}
) {
  const client = deps.client ?? supabaseAdmin;
  const ticket = await refreshControlContinuation({ userId, id }, client);
  if (ticket?.status !== "ready") return ticket;
  try {
    const runtime = await (deps.trigger ?? triggerContinuation)(ticket);
    const { error } = await client
      .from("control_continuations")
      .update({
        runtime_run_id: runtime.id,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", userId)
      .eq("status", "ready");
    if (error)
      throw new Error("Could not save the queued coordinator runtime.");
  } catch {
    // Keep it ready for an explicit delivery retry; never claim that a failed
    // dispatch started a coordinator. Worker supervisors retry this delivery.
    await client
      .from("control_continuations")
      .update({
        error:
          "The coordinator follow-up could not be queued. Retry from Control.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", userId)
      .eq("status", "ready");
    throw new Error("Could not queue the coordinator follow-up.");
  }
  return ticket;
}

export async function notifyControlWorkerCompletion(
  userId: string,
  workerId: string,
  deps: {
    client?: typeof supabaseAdmin;
    trigger?: typeof triggerContinuation;
  } = {}
) {
  const tickets = await continuationsForWorker(userId, workerId, deps.client);
  await Promise.all(
    tickets.map((ticket) =>
      dispatchControlContinuation(userId, ticket.id, deps)
    )
  );
}
