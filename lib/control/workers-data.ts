import { supabaseAdmin } from "@/lib/supabase/admin";
import { presentMogplexApiRunEvent } from "@/lib/mogplex-api/run-control";
import type { MogplexApiRunStatus } from "@/lib/mogplex-api/runs-types";
import type { AiCallEvent } from "@/lib/types";
import { workerFailureMessage, type ControlWorker } from "./workers";

/** Read-only status: a worktree being active does not mean its worker is running. */
export async function loadControlWorkers(
  userId: string,
  sessionId: string,
  client = supabaseAdmin
): Promise<ControlWorker[] | null> {
  const session = await client
    .from("control_sessions")
    .select("orchestration_run_id")
    .eq("user_id", userId)
    .eq("id", sessionId)
    .maybeSingle();
  if (session.error) throw new Error("Could not load mission");
  if (!session.data) return null;
  if (!session.data.orchestration_run_id) return [];
  const worktrees = await client
    .from("orchestration_worktrees")
    .select("id,branch_name")
    .eq("user_id", userId)
    .eq("run_id", session.data.orchestration_run_id)
    .order("created_at", { ascending: true });
  if (worktrees.error) throw new Error("Could not load mission worktrees");
  const workers = await Promise.all(
    (worktrees.data ?? []).map(
      async (worktree): Promise<ControlWorker | null> => {
        const result = await client
          .from("external_agent_runs")
          .select("id,ai_call_id,status,error,updated_at")
          .eq("user_id", userId)
          .eq("worktree_id", worktree.id)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (result.error) throw new Error("Could not load worker status");
        const run = result.data;
        if (!run) return null;
        // A recent activity window, not an execution limit. Full history stays in run details.
        const activity = await client
          .from("ai_call_events")
          .select("*")
          .eq("user_id", userId)
          .eq("ai_call_id", run.ai_call_id)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(100);
        if (activity.error) throw new Error("Could not load worker activity");
        const events = ((activity.data ?? []) as AiCallEvent[])
          .reverse()
          .map(presentMogplexApiRunEvent);
        const status = run.status as MogplexApiRunStatus;
        return {
          id: run.id,
          worktreeId: worktree.id,
          branch: worktree.branch_name,
          status,
          error: workerFailureMessage(status, run.error, events),
          updatedAt: run.updated_at,
          events,
        };
      }
    )
  );
  return workers.filter((worker): worker is ControlWorker => worker !== null);
}
