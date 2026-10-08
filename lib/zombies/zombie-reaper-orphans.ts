import type { SupabaseClient } from "@supabase/supabase-js";
import { stopWorkers, type WorkerStopFailure } from "./zombie-reaper-stops";
import { stopIdleWorker } from "./zombie-reaper-workers";

type Client = Pick<SupabaseClient, "from">;

// A run's call can end a moment before the run row does; only look at runs
// whose call ended at least one reaper cycle ago.
const ORPHAN_GRACE_MS = 5 * 60_000;
// Older orphans predate this sweep; stopping them now would post a stale
// run-ended notice to Slack.
const ORPHAN_HORIZON_MS = 24 * 60 * 60_000;

export type OrphanCall = {
  id: string;
  user_id: string;
  runtime_command_id: string | null;
  error: string | null;
};

/**
 * Calls whose run or Control continuation is still active although the call
 * itself ended: the reaper marked the call failed but stopping its worker
 * failed or was cut short. Each one gets the stop retried.
 */
export async function findOrphanedWorkerCalls(
  client: Client,
  now: number
): Promise<OrphanCall[]> {
  const [runs, tickets] = await Promise.all([
    client
      .from("external_agent_runs")
      .select("ai_call_id")
      .in("status", ["pending", "streaming"]),
    client
      .from("control_continuations")
      .select("resume_ai_call_id")
      .in("status", ["ready", "running"]),
  ]);
  if (runs.error)
    throw new Error(`Could not read active runs: ${runs.error.message}`);
  if (tickets.error) {
    throw new Error(
      `Could not read active continuations: ${tickets.error.message}`
    );
  }
  const callIds = [
    ...((runs.data ?? []) as Array<{ ai_call_id: string | null }>).map(
      (row) => row.ai_call_id
    ),
    ...(
      (tickets.data ?? []) as Array<{ resume_ai_call_id: string | null }>
    ).map((row) => row.resume_ai_call_id),
  ].filter(Boolean);
  if (callIds.length === 0) return [];
  const { data, error } = await client
    .from("ai_calls")
    .select("id, user_id, runtime_command_id, error")
    .in("id", callIds)
    .in("status", ["success", "failed", "cancelled"])
    .lt("completed_at", new Date(now - ORPHAN_GRACE_MS).toISOString())
    .gt("completed_at", new Date(now - ORPHAN_HORIZON_MS).toISOString());
  if (error) throw new Error(`Could not read ended calls: ${error.message}`);
  return (data ?? []) as OrphanCall[];
}

/**
 * Retries the worker stop for every orphan; one failure doesn't stop the
 * rest. A sweep that can't run reports itself as one failure.
 */
export async function stopOrphanedWorkers(
  client: Client,
  now: number,
  stopWorker: typeof stopIdleWorker = stopIdleWorker
): Promise<WorkerStopFailure[]> {
  try {
    const orphans = await findOrphanedWorkerCalls(client, now);
    return await stopWorkers(
      client,
      orphans.map((call) => ({
        call,
        error: call.error ?? "The agent worker stopped without finishing.",
      })),
      stopWorker
    );
  } catch (sweepError) {
    return [
      {
        id: "orphan-sweep",
        error:
          sweepError instanceof Error ? sweepError.message : String(sweepError),
      },
    ];
  }
}
