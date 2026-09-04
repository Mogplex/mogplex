/**
 * Database access for external agent runs, shared by the fresh-run
 * (run-execution.ts) and resume (run-resume.ts) paths.
 */
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs";
import type { ExternalAgentRunUpdate } from "@/lib/mogplex-api/run-execution-finalize";

async function getSupabaseAdmin() {
  const mod = await import("@/lib/supabase/admin");
  return mod.supabaseAdmin;
}

export async function loadRunForExecution(
  runId: string,
  userId: string
): Promise<ExternalAgentRunRow | null> {
  const supabaseAdmin = await getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("external_agent_runs")
    .select("*")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load external agent run: ${error.message}`);
  }

  return (data as ExternalAgentRunRow | null) ?? null;
}

export async function updateExternalAgentRun(
  userId: string,
  runId: string,
  update: ExternalAgentRunUpdate
): Promise<ExternalAgentRunRow> {
  const supabaseAdmin = await getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("external_agent_runs")
    .update(update)
    .eq("user_id", userId)
    .eq("id", runId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(
      error?.message || `Failed to update external agent run ${runId}`
    );
  }

  return data as ExternalAgentRunRow;
}
