import { presentMogplexApiRunEvent } from "@/lib/mogplex-api/run-control";
import type { AiCallEvent } from "@/lib/types";

async function getSupabaseAdmin() {
  const mod = await import("@/lib/supabase/admin");
  return mod.supabaseAdmin;
}

export async function loadMogplexApiRunEvent(input: {
  userId: string;
  runId: string;
  eventId: string;
}) {
  const supabaseAdmin = await getSupabaseAdmin();
  const { data: run, error: runError } = await supabaseAdmin
    .from("external_agent_runs")
    .select("ai_call_id")
    .eq("id", input.runId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (runError) {
    throw new Error(`Failed to load external agent run: ${runError.message}`);
  }
  if (!run) return null;

  const { data: event, error: eventError } = await supabaseAdmin
    .from("ai_call_events")
    .select("*")
    .eq("id", input.eventId)
    .eq("ai_call_id", run.ai_call_id)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (eventError) {
    throw new Error(`Failed to load run event: ${eventError.message}`);
  }
  return event ? presentMogplexApiRunEvent(event as AiCallEvent) : null;
}
