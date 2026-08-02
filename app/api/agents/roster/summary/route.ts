import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth";

export type AgentRosterSummaryItem = {
  agentId: string;
  runs24h: number;
  succeeded: number;
  failed: number;
  suppressed: number;
  tokens24h: number;
};

export type AgentRosterSummaryResponse = Record<string, AgentRosterSummaryItem>;

// Aggregated in Postgres by the agent_roster_summary RPC (migration
// 20260731011500). The previous implementation filtered job_runs by
// user_id/agent_id columns that don't exist on that table — the query 500ed
// and the roster health badges silently rendered empty. Agent and user
// attribution flow through assignments (repo -> user, agent_id) and triggers
// (user_id, agent_id); ai_calls attach to runs via job_run_id.
export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin.rpc("agent_roster_summary", {
    p_user_id: userId,
    p_since: since,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json((data as AgentRosterSummaryResponse | null) ?? {});
}
