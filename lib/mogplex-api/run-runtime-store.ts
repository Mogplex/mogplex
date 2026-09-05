import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiCall } from "@/lib/types";
import type { ExternalAgentRunRow } from "./runs-types";

export type TerminalRunStatus = "success" | "failed" | "cancelled";
type Client = Pick<SupabaseClient, "from">;

/** Preserve usage/output/command identity when an external worker disappears. */
export async function finishCallAfterRuntime(
  call: AiCall,
  status: TerminalRunStatus,
  message: string | null,
  client: Client = supabaseAdmin
): Promise<AiCall | null> {
  const completedAt = new Date();
  const { data, error } = await client
    .from("ai_calls")
    .update({
      status,
      error: message,
      completed_at: completedAt.toISOString(),
      // Legacy orphan repair can happen months later. The existing column is
      // int4; retain exact timestamps while saturating this derived duration.
      duration_ms: Math.min(
        2_147_483_647,
        Math.max(0, completedAt.getTime() - Date.parse(call.started_at))
      ),
      control_state: status === "cancelled" ? "cancelled" : "active",
    })
    .eq("id", call.id)
    .eq("user_id", call.user_id)
    .in("status", ["pending", "streaming"])
    .eq("control_state", call.control_state)
    .select("*")
    .maybeSingle();
  if (error)
    throw new Error(`Failed to finalize worker call: ${error.message}`);
  return data as AiCall | null;
}

/** A late worker result cannot overwrite a terminal run or a newer segment. */
export async function syncRunAfterRuntime(
  run: ExternalAgentRunRow,
  status: TerminalRunStatus,
  message: string | null,
  client: Client = supabaseAdmin
): Promise<ExternalAgentRunRow | null> {
  let query = client
    .from("external_agent_runs")
    .update({ status, error: message })
    .eq("id", run.id)
    .eq("user_id", run.user_id)
    .eq("ai_call_id", run.ai_call_id)
    .in("status", ["pending", "streaming"]);
  query =
    run.runtime_run_id === null
      ? query.is("runtime_run_id", null)
      : query.eq("runtime_run_id", run.runtime_run_id);
  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw new Error(`Failed to finalize worker run: ${error.message}`);
  return data as ExternalAgentRunRow | null;
}
