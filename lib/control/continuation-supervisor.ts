import { controlContinuationPayload } from "./continuation-runtime";
import type { ControlContinuationPayload } from "./continuation-runtime";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { finishCallAfterRuntime } from "@/lib/mogplex-api/run-runtime-store";
import type { AiCall } from "@/lib/types";
import {
  loadControlContinuation,
  recordControlContinuationFailure,
} from "./continuation-store";

/** Runs outside the worker process, including after its hard timeout/crash. */
export async function reconcileControlContinuationWorker(
  payload: ControlContinuationPayload,
  supervisorRunId: string,
  timedOut = false,
  client = supabaseAdmin
) {
  const ticket = await loadControlContinuation(
    payload.userId,
    payload.continuationId,
    client
  );
  if (
    !ticket ||
    (ticket.runtime_run_id && ticket.runtime_run_id !== supervisorRunId)
  )
    return { status: "not_claimed" };
  if (["finished", "needs_input", "waiting"].includes(ticket.status))
    return { status: ticket.status };
  const error = timedOut
    ? "The coordinator reached its time limit. Saved output is available; it was not replayed."
    : "The coordinator follow-up stopped before finishing. Review its saved output before continuing; it was not replayed.";
  if (ticket.resume_ai_call_id) {
    const { data: call, error: callError } = await client
      .from("ai_calls")
      .select("*")
      .eq("id", ticket.resume_ai_call_id)
      .eq("user_id", payload.userId)
      .maybeSingle();
    if (callError)
      throw new Error("Could not load the stopped coordinator call.");
    if (call && ["pending", "streaming"].includes(call.status)) {
      const cancelled =
        ticket.status === "cancelled" || call.control_state !== "active";
      const updated = await finishCallAfterRuntime(
        call as AiCall,
        cancelled ? "cancelled" : "failed",
        cancelled ? null : error,
        client
      );
      if (!updated)
        throw new Error("Coordinator call changed during finalization.");
    }
  }
  const updated = await recordControlContinuationFailure(
    {
      userId: payload.userId,
      id: ticket.id,
      runtimeRunId: supervisorRunId,
      timedOut,
    },
    client
  );
  return { status: updated?.status ?? ticket.status };
}

export async function superviseControlContinuation(
  raw: ControlContinuationPayload,
  supervisorRunId: string,
  deps: {
    client?: typeof supabaseAdmin;
    waitForWorker: (
      payload: ControlContinuationPayload & { supervisorRunId: string },
      idempotencyKey: string
    ) => Promise<{ ok: boolean; error?: unknown }>;
  }
) {
  const payload = controlContinuationPayload.parse(raw);
  const client = deps.client ?? supabaseAdmin;
  const before = await loadControlContinuation(
    payload.userId,
    payload.continuationId,
    client
  );
  if (
    !before ||
    (before.runtime_run_id && before.runtime_run_id !== supervisorRunId)
  )
    return { status: "not_claimed" };
  if (!["ready", "running"].includes(before.status))
    return reconcileControlContinuationWorker(
      payload,
      supervisorRunId,
      false,
      client
    );
  // The parent is checkpointed during this wait, which consumes no maxDuration.
  // Delivery retries reuse one child; the SQL execution claim also prevents replay.
  const result = await deps.waitForWorker(
    { ...payload, supervisorRunId },
    `control-worker:${supervisorRunId}`
  );
  const timedOut =
    !result.ok &&
    result.error !== null &&
    typeof result.error === "object" &&
    "code" in result.error &&
    result.error.code === "MAX_DURATION_EXCEEDED";
  return reconcileControlContinuationWorker(
    payload,
    supervisorRunId,
    timedOut,
    client
  );
}
