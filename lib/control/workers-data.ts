import { supabaseAdmin } from "@/lib/supabase/admin";
import { presentMogplexApiRunEvent } from "@/lib/mogplex-api/run-control";
import type { MogplexApiRunStatus } from "@/lib/mogplex-api/runs-types";
import type { AiCallEvent } from "@/lib/types";
import { workerFailureMessage, type ControlWorker } from "./workers";

type WorkerActivityRow = {
  id: string;
  worktree_id: string;
  branch: string;
  status: MogplexApiRunStatus;
  error: string | null;
  updated_at: string;
  events: AiCallEvent[];
};

/** One owner-scoped snapshot, independent of the number of mission workers. */
export async function loadControlWorkers(
  userId: string,
  sessionId: string,
  client = supabaseAdmin,
  options: { includeEvents?: boolean } = {}
): Promise<ControlWorker[] | null> {
  const { data, error } = await client.rpc("control_mission_workers", {
    p_user_id: userId,
    p_session_id: sessionId,
    p_include_events: options.includeEvents !== false,
  });
  if (error) throw new Error("Could not load mission workers");
  if (data === null) return null;
  return (data as WorkerActivityRow[]).map((row) => {
    const events = row.events.map(presentMogplexApiRunEvent);
    return {
      id: row.id,
      worktreeId: row.worktree_id,
      branch: row.branch,
      status: row.status,
      error: workerFailureMessage(row.status, row.error, events),
      updatedAt: row.updated_at,
      events,
    };
  });
}
