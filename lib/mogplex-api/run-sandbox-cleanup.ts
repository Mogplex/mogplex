import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  loadSandboxRecord,
  resolveVmCredentials,
} from "@/lib/sandbox/auto-pause-deps";
import { stopSandbox } from "@/lib/sandbox/reaper-stop";
import { updateSandboxRecord } from "@/lib/sandbox/records";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SandboxAutoPauseRecord } from "@/lib/sandbox/auto-pause-types";
import type { ExternalAgentRunRow } from "./runs-types";

type ClaimedSandbox = SandboxAutoPauseRecord & { last_active_at: string };

export async function claimTerminalRunSandboxPause(
  run: ExternalAgentRunRow,
  client: Pick<SupabaseClient, "rpc"> = supabaseAdmin
): Promise<ClaimedSandbox | null> {
  const { data, error } = await client.rpc("claim_terminal_run_sandbox_pause", {
    p_run_id: run.id,
    p_user_id: run.user_id,
    p_ai_call_id: run.ai_call_id,
    p_runtime_run_id: run.runtime_run_id,
  });
  if (error) throw new Error("Could not claim completed run sandbox cleanup");
  return (data?.[0] as ClaimedSandbox | undefined) ?? null;
}

const defaultDeps = {
  loadSandbox: loadSandboxRecord,
  resolveCredentials: resolveVmCredentials,
  claim: claimTerminalRunSandboxPause,
  stop: stopSandbox,
  updateSandbox: updateSandboxRecord,
};

/** Runs in the surviving supervisor, including after a hard worker timeout. */
export async function cleanupTerminalRunSandbox(
  run: ExternalAgentRunRow,
  overrides: Partial<typeof defaultDeps> = {}
): Promise<void> {
  if (
    !run.create_branch ||
    run.worktree_id ||
    !run.sandbox_record_id ||
    !["success", "failed", "cancelled"].includes(run.status)
  )
    return;
  const deps = { ...defaultDeps, ...overrides };
  const record = await deps.loadSandbox(run.sandbox_record_id);
  if (
    record?.user_id !== run.user_id ||
    record.repo_id !== run.repo_id ||
    record.sandbox_id !== run.sandbox_id ||
    record.status !== "running" ||
    !record.persistent
  )
    return;
  const credentials = await deps.resolveCredentials(record);
  if (!credentials) throw new Error("Could not resolve completed run sandbox");
  const claimed = await deps.claim(run);
  if (!claimed) return;
  const result = await deps.stop(
    { ...claimed, status: "pausing" },
    { ok: true, ...credentials },
    { onSuccessAction: "stopped_idle", fromStatuses: "pausing" }
  );
  if (!result.stopped) {
    // Restore the original activity timestamp so the durable supervisor can
    // retry cleanup without making the run look newly active.
    await deps.updateSandbox(
      claimed.id,
      {
        status: "running",
        health_status: claimed.health_status,
        stop_reason: null,
        last_active_at: claimed.last_active_at,
      },
      { expectedSandboxId: claimed.sandbox_id, fromStatuses: "pausing" }
    );
    throw new Error("Could not pause completed run sandbox");
  }
}
