import { supabaseAdmin } from "@/lib/supabase/admin";
import { readSlackRunControlsMetadata } from "@/lib/slack/run-controls";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs-types";
import type { RunWorkspaceContext } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadRunGuidance } from "@/lib/slack/run-guidance-store";

export async function loadWorkspaceRun(
  userId: string,
  runId: string,
  client: Pick<SupabaseClient, "from"> = supabaseAdmin
) {
  const { data, error } = await client
    .from("external_agent_runs")
    .select("*")
    .eq("user_id", userId)
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new Error("Could not load run");
  return data as ExternalAgentRunRow | null;
}

export function canGuideRun(run: ExternalAgentRunRow) {
  return (
    run.harness === "mogplex" &&
    run.metadata.slack_guidance_enabled === true &&
    typeof run.metadata.slack_user_id === "string" &&
    Boolean(readSlackRunControlsMetadata(run.metadata))
  );
}

export async function loadRunWorkspace(
  userId: string,
  runId: string,
  client: Pick<SupabaseClient, "from"> = supabaseAdmin
): Promise<RunWorkspaceContext | null> {
  const run = await loadWorkspaceRun(userId, runId, client);
  if (!run) return null;
  // The owned run authorizes its repo reference. Never serialize repo secrets.
  const { data: repo, error } = await client
    .from("repos")
    .select("id,user_id,full_name,created_at,default_branch,root_directory")
    .eq("id", run.repo_id)
    .maybeSingle();
  if (error) throw new Error("Could not load run repository");
  if (!repo) return null;
  let sandboxRecordId: string | null = null;
  if (run.sandbox_record_id) {
    const { data: sandbox, error: sandboxError } = await client
      .from("sandboxes")
      .select("id")
      .eq("id", run.sandbox_record_id)
      .eq("user_id", userId)
      .eq("repo_id", run.repo_id)
      .eq("working_branch", run.working_branch)
      .maybeSingle();
    if (sandboxError) throw new Error("Could not load run sandbox");
    sandboxRecordId = sandbox?.id ?? null;
  }
  return {
    runId: run.id,
    aiCallId: run.ai_call_id,
    status: run.status,
    prompt: run.prompt,
    repo: {
      ...repo,
      created_at: String(repo.created_at),
      root_directory: run.root_directory,
    },
    sandboxRecordId,
    workingBranch: run.working_branch,
    canGuide: canGuideRun(run),
    guidance: canGuideRun(run)
      ? (await loadRunGuidance(run, client, true)).map(
          ({ id, body, status }) => ({ id, body, status })
        )
      : [],
  };
}
