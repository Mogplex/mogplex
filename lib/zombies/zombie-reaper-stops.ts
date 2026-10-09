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

export type WorkerStopResult = {
  failures: WorkerStopFailure[];
  /** Calls where stopIdleWorker returned false (no active worker to stop). */
  notFound: string[];
};

/** Stops the worker behind each call; returns failures and calls with no worker. */
export async function stopWorkers(
  client: Pick<SupabaseClient, "from">,
  stops: readonly WorkerStop[],
  stopWorker: typeof stopIdleWorker = stopIdleWorker
): Promise<WorkerStopResult> {
  const failures: WorkerStopFailure[] = [];
  const notFound: string[] = [];
  await forEachConcurrently(stops, REAPER_CONCURRENCY, async (stop) => {
    try {
      const stopped = await stopWorker({
        client,
        call: stop.call,
        error: stop.error,
      });
      if (!stopped) {
        console.warn(
          "[zombie-reaper] no active worker to stop for idle call",
          stop.call.id
        );
        notFound.push(stop.call.id);
      }
    } catch (stopError) {
      failures.push({
        id: stop.call.id,
        error:
          stopError instanceof Error ? stopError.message : String(stopError),
      });
    }
  });
  return { failures, notFound };
}

/** Records stop results (failures and not-found) in the cycle summary and Sentry. */
export function reportStopResults(
  summary: ZombieReaperTableSummary,
  result: WorkerStopResult
) {
  for (const failure of result.failures) {
    console.error("[zombie-reaper] could not stop idle worker", failure);
    summary.results.push({
      table: "ai_calls",
      id: failure.id,
      ageMs: null,
      action: "worker_stop_failed",
      detail: failure.error,
    });
  }
  for (const id of result.notFound) {
    summary.results.push({
      table: "ai_calls",
      id,
      ageMs: null,
      action: "worker_not_found",
      detail: "No active worker backing this call",
    });
  }
  if (result.failures.length === 0) return;
  try {
    Sentry.captureMessage("[zombie-reaper] could not stop idle workers", {
      level: "warning",
      tags: { table: "ai_calls" },
      extra: { failures: result.failures },
    });
  } catch (captureError) {
    console.error("[zombie-reaper] Sentry capture failed", captureError);
  }
}
