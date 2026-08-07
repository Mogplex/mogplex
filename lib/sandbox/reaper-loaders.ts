import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";
import {
  STALE_PAUSING_THRESHOLD_MS,
  SANDBOX_PAUSING_STATUS,
  PAUSED_SANDBOX_TTL_MS,
} from "@/lib/sandbox/reaper-types";
import type {
  ReaperSandboxRecord,
  AbandonedPausedSandboxRecord,
  FreshIdleState,
} from "@/lib/sandbox/reaper-types";

export async function loadActiveSandboxes(): Promise<ReaperSandboxRecord[]> {
  const select =
    "id, sandbox_id, user_id, status, health_status, exec_lock_token, persistent, created_at, last_active_at, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, repo:repos(sandbox_timeout_ms, sandbox_idle_timeout_ms, workspace:workspaces(sandbox_timeout_ms, sandbox_idle_timeout_ms))";
  const pausingCutoffIso = new Date(
    Date.now() - STALE_PAUSING_THRESHOLD_MS
  ).toISOString();
  const [activeResult, stalePausingResult] = await Promise.all([
    // Oldest first + capped: if the active set ever exceeds the cap, the
    // stalest sandboxes are still seen this sweep and the rest next sweep.
    supabaseAdmin
      .from("sandboxes")
      .select(select)
      .in("status", ["running", "installing", "creating"])
      .order("created_at", { ascending: true })
      .limit(10000),
    supabaseAdmin
      .from("sandboxes")
      .select(select)
      .eq("status", SANDBOX_PAUSING_STATUS)
      .or(`last_active_at.is.null,last_active_at.lt.${pausingCutoffIso}`)
      .limit(50),
  ]);

  if (activeResult.error) {
    throw new Error(
      `Failed to load active sandboxes: ${activeResult.error.message}`
    );
  }
  if (stalePausingResult.error) {
    throw new Error(
      `Failed to load stale pausing sandboxes: ${stalePausingResult.error.message}`
    );
  }

  return [
    ...((activeResult.data ?? []) as ReaperSandboxRecord[]),
    ...((stalePausingResult.data ?? []) as ReaperSandboxRecord[]),
  ];
}

export async function loadBusySandboxIds(): Promise<Set<string>> {
  // The busy set protects sandboxes from reaping, so it must be complete - a
  // truncated fetch could drop an in-flight sandbox from the set and let the
  // reaper stop it under an open session or streaming call. Paged to
  // exhaustion rather than capped.
  const [aiCallsRows, sessionRows, automationRows] = await Promise.all([
    fetchAllRows(
      () =>
        supabaseAdmin
          .from("ai_calls")
          .select("metadata")
          .in("status", ["pending", "streaming"]),
      "started_at",
      "active ai_calls"
    ),
    fetchAllRows(
      () =>
        supabaseAdmin
          .from("sandbox_client_sessions")
          .select("sandbox_record_id")
          .is("released_at", null),
      "attached_at",
      "active sandbox sessions"
    ),
    fetchAllRows(
      () =>
        supabaseAdmin
          .from("external_agent_runs")
          .select("sandbox_record_id")
          .in("status", ["pending", "streaming"]),
      "created_at",
      "active external agent runs"
    ),
  ]);

  return new Set([
    ...(aiCallsRows as { metadata: unknown }[])
      .flatMap((call) => {
        const metadata = call.metadata as Record<string, unknown> | null;
        return [metadata?.sandbox_record_id, metadata?.sandbox_id];
      })
      .filter(
        (sandboxRecordId): sandboxRecordId is string =>
          typeof sandboxRecordId === "string"
      ),
    ...(sessionRows as { sandbox_record_id: unknown }[])
      .map((session) => session.sandbox_record_id)
      .filter(
        (sandboxRecordId): sandboxRecordId is string =>
          typeof sandboxRecordId === "string"
      ),
    ...(automationRows as { sandbox_record_id: unknown }[])
      .map((run) => run.sandbox_record_id)
      .filter(
        (sandboxRecordId): sandboxRecordId is string =>
          typeof sandboxRecordId === "string"
      ),
  ]);
}

export async function loadFreshIdleState(
  sandboxId: string
): Promise<FreshIdleState | null> {
  const { data, error } = await supabaseAdmin
    .from("sandboxes")
    .select("last_active_at, health_status")
    .eq("id", sandboxId)
    .single();

  if (error) {
    console.warn(
      `[sandbox-reaper] Failed to refresh idle state for ${sandboxId}:`,
      error
    );
    return null;
  }

  return data as FreshIdleState | null;
}

export async function loadAbandonedPausedSandboxes(): Promise<
  AbandonedPausedSandboxRecord[]
> {
  const cutoffIso = new Date(Date.now() - PAUSED_SANDBOX_TTL_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from("sandboxes")
    .select(
      "id, sandbox_id, user_id, last_active_at, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id"
    )
    .eq("status", "paused")
    .or(`last_active_at.is.null,last_active_at.lt.${cutoffIso}`)
    .limit(50);

  if (error) {
    throw new Error(
      `Failed to load abandoned paused sandboxes: ${error.message}`
    );
  }
  return (data ?? []) as AbandonedPausedSandboxRecord[];
}
