import { supabaseAdmin } from "@/lib/supabase/admin";
import { createEmptyUserAutomationScope } from "@/lib/user-automation-scope";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs-types";
import type { AiCall, AiCallEvent, ObservabilityJobDetail } from "@/lib/types";
import {
  attachAgentRunAiCalls,
  buildAgentRunObservabilityJob,
} from "./agent-run-jobs";

export async function loadAgentRunDetail(
  userId: string,
  id: string,
  client = supabaseAdmin
): Promise<ObservabilityJobDetail | null> {
  const { data: run, error } = await client
    .from("external_agent_runs")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Failed to load agent run");
  if (!run) return null;
  const [repoResult, callResult] = await Promise.all([
    client
      .from("repos")
      .select("id,full_name,user_id,github_installation_id")
      .eq("id", run.repo_id)
      .eq("user_id", userId)
      .maybeSingle(),
    client
      .from("ai_calls")
      .select("*")
      .eq("id", run.ai_call_id)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (repoResult.error || callResult.error)
    throw new Error("Failed to load run context");
  const scope = createEmptyUserAutomationScope();
  if (repoResult.data) scope.reposById.set(repoResult.data.id, repoResult.data);
  const job = buildAgentRunObservabilityJob(scope, run as ExternalAgentRunRow);
  const call = callResult.data as AiCall | null;
  const { data: events, error: eventsError } = call
    ? await client
        .from("ai_call_events")
        .select("*")
        .eq("ai_call_id", call.id)
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
    : { data: [], error: null };
  if (eventsError) throw new Error("Failed to load run activity");
  await attachAgentRunAiCalls([job], {
    loadAiCalls: async () => (call ? [call] : []),
  });
  return {
    ...job,
    dispatch_events: [],
    review_findings: [],
    ai_calls: call
      ? [{ ...call, events: (events ?? []) as AiCallEvent[] }]
      : [],
  };
}
