import { supabaseAdmin } from "@/lib/supabase/admin";

export type MogplexApiSandbox = {
  id: string;
  sandbox_id: string | null;
  repo_id: string;
  status: string;
  base_branch: string;
  working_branch: string;
  root_directory: string | null;
  preview_url: string | null;
  created_at: string;
  last_active_at: string;
  error: string | null;
};

export type MogplexApiSandboxLogs = {
  sandbox: MogplexApiSandbox & {
    install_log: string | null;
    dev_log: string | null;
  };
  lifecycle_events: Array<{
    id: string;
    event_type: string;
    decision_code: string | null;
    worker_run_id: string | null;
    payload: Record<string, unknown>;
    created_at: string;
  }>;
};

export type ListMogplexApiSandboxesOptions = {
  repoId?: string | null;
  status?: string | null;
  limit?: number;
};

export async function listMogplexApiSandboxes(
  userId: string,
  options: ListMogplexApiSandboxesOptions = {}
): Promise<MogplexApiSandbox[]> {
  let query = supabaseAdmin
    .from("sandboxes")
    .select(
      "id, sandbox_id, repo_id, status, base_branch, working_branch, root_directory, preview_url, created_at, last_active_at, error"
    )
    .eq("user_id", userId)
    .order("last_active_at", { ascending: false })
    .limit(options.limit ?? 100);

  if (options.repoId) {
    query = query.eq("repo_id", options.repoId);
  }
  if (options.status) {
    query = query.eq("status", options.status);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as MogplexApiSandbox[];
}

export async function getMogplexApiSandboxLogs(
  userId: string,
  sandboxRecordId: string
): Promise<MogplexApiSandboxLogs | null> {
  const { data: sandbox, error } = await supabaseAdmin
    .from("sandboxes")
    .select(
      "id, sandbox_id, repo_id, status, base_branch, working_branch, root_directory, preview_url, created_at, last_active_at, error, install_log, dev_log"
    )
    .eq("id", sandboxRecordId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!sandbox) return null;

  const { data: events, error: eventsError } = await supabaseAdmin
    .from("sandbox_lifecycle_events")
    .select("id, event_type, decision_code, worker_run_id, payload, created_at")
    .eq("sandbox_record_id", sandboxRecordId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (eventsError) throw new Error(eventsError.message);

  return {
    sandbox: sandbox as MogplexApiSandbox & {
      install_log: string | null;
      dev_log: string | null;
    },
    lifecycle_events: (events ??
      []) as MogplexApiSandboxLogs["lifecycle_events"],
  };
}
