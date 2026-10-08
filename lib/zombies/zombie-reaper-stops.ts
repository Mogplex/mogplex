import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ZombieReaperTableSummary } from "./zombie-reaper-types";
import { stopIdleWorker } from "./zombie-reaper-workers";

// The scheduled reaper has 240 seconds per cycle. Stops and activity reads
// hit the network, so they run a few at a time instead of one by one or all
// at once; anything a cut-short cycle misses is retried by the next one.
export const REAPER_CONCURRENCY = 5;

/** Runs `fn` over `items` with at most `limit` in flight. */
export async function forEachConcurrently<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>
) {
  let next = 0;
  const lanes = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next];
        next += 1;
        await fn(item);
      }
    }
  );
  await Promise.all(lanes);
}

export type WorkerStop = {
  call: { id: string; user_id: string; runtime_command_id?: string | null };
  error: string;
};

export type WorkerStopFailure = { id: string; error: string };

/** Stops the worker behind each call; returns the stops that threw. */
export async function stopWorkers(
  client: Pick<SupabaseClient, "from">,
  stops: readonly WorkerStop[],
  stopWorker: typeof stopIdleWorker = stopIdleWorker
): Promise<WorkerStopFailure[]> {
  const failures: WorkerStopFailure[] = [];
  await forEachConcurrently(stops, REAPER_CONCURRENCY, async (stop) => {
    try {
      await stopWorker({ client, call: stop.call, error: stop.error });
    } catch (stopError) {
      failures.push({
        id: stop.call.id,
        error:
          stopError instanceof Error ? stopError.message : String(stopError),
      });
    }
  });
  return failures;
}

/** Records failed stops in the cycle summary and Sentry; the next cycle retries them. */
export function reportStopFailures(
  summary: ZombieReaperTableSummary,
  failures: readonly WorkerStopFailure[]
) {
  for (const failure of failures) {
    console.error("[zombie-reaper] could not stop idle worker", failure);
    summary.results.push({
      table: "ai_calls",
      id: failure.id,
      ageMs: null,
      action: "worker_stop_failed",
      detail: failure.error,
    });
  }
  if (failures.length === 0) return;
  try {
    Sentry.captureMessage("[zombie-reaper] could not stop idle workers", {
      level: "warning",
      tags: { table: "ai_calls" },
      extra: { failures },
    });
  } catch (captureError) {
    console.error("[zombie-reaper] Sentry capture failed", captureError);
  }
}
