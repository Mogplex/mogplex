import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { finishCallAfterRuntime } from "@/lib/mogplex-api/run-runtime-store";
import {
  persistControlTerminalOutcome,
  CONTROL_TURN_INTERRUPTED,
} from "./terminal-outcome";
import { loadControlTurn, loadControlTurnCall } from "./turn-store";
import { releaseLimitClaim } from "@/lib/request-limits";
import { killRuntimeCommand } from "@/lib/mogplex-api/run-control";
import { createWorkspaceCheckpoint } from "./workspace-checkpoint";

export const controlTurnPayload = z.object({
  userId: z.string().uuid(),
  aiCallId: z.string().uuid(),
});
export type ControlTurnPayload = z.infer<typeof controlTurnPayload>;

/** Runs in a different process from the agent, including after hard exits. */
export async function reconcileControlTurn(
  payload: ControlTurnPayload,
  runtimeRunId: string,
  client = supabaseAdmin
) {
  const turn = await loadControlTurn(payload.userId, payload.aiCallId, client);
  if (!turn || (turn.runtime_run_id && turn.runtime_run_id !== runtimeRunId))
    return { status: "not_claimed" };
  let call = await loadControlTurnCall(
    payload.userId,
    payload.aiCallId,
    client
  );
  if (!call) return { status: "not_found" };
  // Sandbox commands outlive the worker process. Stop any saved command
  // before settling a crashed or cancelled run; never replay its effects.
  if (
    call.status !== "success" &&
    call.runtime_command_id &&
    typeof call.metadata?.sandbox_record_id === "string"
  ) {
    await killRuntimeCommand({
      user_id: payload.userId,
      sandbox_record_id: call.metadata.sandbox_record_id,
      runtimeCommandId: call.runtime_command_id,
    }).catch((error) =>
      console.error("[control] orphan command cleanup failed", {
        aiCallId: call!.id,
        error,
      })
    );
  }
  if (
    call.status !== "success" &&
    typeof call.metadata?.sandbox_id === "string"
  ) {
    await createWorkspaceCheckpoint(
      call,
      { sandboxId: call.metadata.sandbox_id, status: "running" },
      turn.team_id
    )("run_command");
  }
  if (["pending", "streaming"].includes(call.status)) {
    call =
      (await finishCallAfterRuntime(
        call,
        call.control_state === "active" ? "failed" : "cancelled",
        CONTROL_TURN_INTERRUPTED,
        client
      )) ??
      (await loadControlTurnCall(payload.userId, payload.aiCallId, client));
  }
  if (call?.status === "failed" || call?.status === "cancelled") {
    await persistControlTerminalOutcome(
      {
        userId: payload.userId,
        sessionId: turn.session_id,
        aiCallId: call.id,
        cancelled: call.status === "cancelled",
      },
      client
    );
  }
  if (turn.limit_claim_id)
    await releaseLimitClaim({
      userId: payload.userId,
      routeKey: "chat",
      claimId: turn.limit_claim_id,
    });
  return { status: call?.status ?? "unknown" };
}

export async function superviseControlTurn(
  payload: ControlTurnPayload,
  runtimeRunId: string,
  waitForWorker: (
    input: ControlTurnPayload & { supervisorRunId: string },
    key: string
  ) => Promise<unknown>,
  client = supabaseAdmin
) {
  const turn = await loadControlTurn(payload.userId, payload.aiCallId, client);
  const call = await loadControlTurnCall(
    payload.userId,
    payload.aiCallId,
    client
  );
  if (
    !turn ||
    !call ||
    (turn.runtime_run_id && turn.runtime_run_id !== runtimeRunId)
  )
    return { status: "not_claimed" };
  if (["pending", "streaming"].includes(call.status)) {
    await waitForWorker(
      { ...payload, supervisorRunId: runtimeRunId },
      `control-turn-worker:${runtimeRunId}`
    );
  }
  return reconcileControlTurn(payload, runtimeRunId, client);
}
