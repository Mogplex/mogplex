import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ControlChatRequestBody } from "@/app/api/control/chat/_lib/types";
import type { AiCall } from "@/lib/types";

export type ControlTurn = {
  ai_call_id: string;
  user_id: string;
  session_id: string;
  request_context: ControlChatRequestBody;
  team_id: string | null;
  limit_claim_id: string | null;
  runtime_run_id: string | null;
  claimed_at: string | null;
};

export async function loadControlTurn(
  userId: string,
  callId: string,
  client = supabaseAdmin
) {
  const { data, error } = await client
    .from("control_turns")
    .select("*")
    .eq("user_id", userId)
    .eq("ai_call_id", callId)
    .maybeSingle();
  if (error) throw new Error("Could not load the saved Control turn.");
  return data as ControlTurn | null;
}

export async function loadControlTurnCall(
  userId: string,
  callId: string,
  client = supabaseAdmin
) {
  const { data, error } = await client
    .from("ai_calls")
    .select("*")
    .eq("user_id", userId)
    .eq("id", callId)
    .maybeSingle();
  if (error) throw new Error("Could not load the Control run.");
  return data as AiCall | null;
}

/** A second delivery cannot restart a worker whose effects may already exist. */
export async function claimControlTurn(
  userId: string,
  callId: string,
  runtimeRunId: string,
  client = supabaseAdmin
) {
  const call = await loadControlTurnCall(userId, callId, client);
  if (
    !call ||
    !["pending", "streaming"].includes(call.status) ||
    call.control_state !== "active"
  )
    return null;
  const { data, error } = await client
    .from("control_turns")
    .update({
      runtime_run_id: runtimeRunId,
      claimed_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("ai_call_id", callId)
    .is("claimed_at", null)
    .or(`runtime_run_id.is.null,runtime_run_id.eq.${runtimeRunId}`)
    .select("*")
    .maybeSingle();
  if (error) throw new Error("Could not claim the Control turn.");
  return data as ControlTurn | null;
}

export async function assertControlTurnCurrent(
  turn: ControlTurn,
  runtimeRunId: string,
  client = supabaseAdmin
) {
  const [saved, call, session] = await Promise.all([
    loadControlTurn(turn.user_id, turn.ai_call_id, client),
    loadControlTurnCall(turn.user_id, turn.ai_call_id, client),
    client
      .from("control_sessions")
      .select("id,archived,repo_id")
      .eq("id", turn.session_id)
      .eq("user_id", turn.user_id)
      .maybeSingle(),
  ]);
  if (
    saved?.runtime_run_id !== runtimeRunId ||
    !call ||
    !["pending", "streaming"].includes(call.status) ||
    call.control_state !== "active" ||
    session.error ||
    !session.data ||
    session.data.archived ||
    (session.data.repo_id ?? null) !== (turn.request_context.repoId ?? null)
  )
    throw new Error(
      "This Control turn stopped or its conversation changed. No further action is authorized."
    );
}
