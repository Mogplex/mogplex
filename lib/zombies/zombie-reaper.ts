/**
 * Zombie-row reaper system.
 *
 * This module re-exports all public types and functions from the split
 * implementation files to maintain backward compatibility with existing
 * imports from "@/lib/zombies/zombie-reaper".
 *
 * Implementation is split across:
 *   - zombie-reaper-types.ts       — Type definitions and shared constants
 *   - zombie-reaper-ai-calls.ts    — AI calls reaper
 *   - zombie-reaper-repos.ts       — Snapshot locks reaper
 *   - zombie-reaper-jobs.ts        — Job runs reaper
 *   - zombie-reaper-sandboxes.ts   — Exec locks reaper
 *   - zombie-reaper-connections.ts — Connection tests reaper
 */

import * as Sentry from "@sentry/nextjs";
import type {
  ZombieReaperResult,
  ZombieReaperTableSummary,
  ZombieReaperSummary,
  ZombieReaperRunnerDeps,
} from "./zombie-reaper-types";
import { reapStaleAiCalls } from "./zombie-reaper-ai-calls";
import { reapStaleSnapshotLocks } from "./zombie-reaper-repos";
import { reapStaleJobRuns } from "./zombie-reaper-jobs";
import { reapStaleExecLocks } from "./zombie-reaper-sandboxes";
import { reapStaleConnectionTests } from "./zombie-reaper-connections";

// Re-export types
export {
  type ZombieReaperResult,
  type ZombieReaperTableSummary,
  type ZombieReaperSummary,
  ZombieReaperRunError,
  type ZombieReaperRunnerDeps,
} from "./zombie-reaper-types";

// Re-export sandbox-related exports for direct access
export {
  ACTIVE_SANDBOX_STATUSES_FOR_LOCK,
  classifyExecLockZombie,
} from "./zombie-reaper-sandboxes";

// Re-export connection-related exports for direct access
export {
  CONNECTION_TEST_STALE_MS,
  classifyConnectionTestZombie,
} from "./zombie-reaper-connections";

function defaultCaptureWarning(
  message: string,
  extra: Record<string, unknown>
) {
  // Surface non-error warnings to Sentry only when something was
  // actually reaped — quiet cycles must not spam the dashboard.
  Sentry.captureMessage(message, {
    level: "warning",
    extra,
  });
}

const defaultZombieReaperDeps: ZombieReaperRunnerDeps = {
  reapStaleAiCalls,
  reapStaleSnapshotLocks,
  reapStaleJobRuns,
  reapStaleExecLocks,
  reapStaleConnectionTests,
  captureWarning: defaultCaptureWarning,
};

export function createZombieReaperRunner(
  overrides: Partial<ZombieReaperRunnerDeps> = {}
) {
  const deps: ZombieReaperRunnerDeps = {
    ...defaultZombieReaperDeps,
    ...overrides,
  };

  // Pair each reaper with its fallback table label in one place so
  // the index-based mapping below can't drift if a future reaper is
  // inserted or reordered. Without this, a misplaced new reaper
  // would silently mislabel a rejection's table summary.
  const reapers: Array<{
    table: ZombieReaperResult["table"];
    run: () => Promise<ZombieReaperTableSummary>;
  }> = [
    { table: "ai_calls", run: deps.reapStaleAiCalls },
    { table: "repos", run: deps.reapStaleSnapshotLocks },
    { table: "job_runs", run: deps.reapStaleJobRuns },
    { table: "sandboxes", run: deps.reapStaleExecLocks },
    { table: "connections", run: deps.reapStaleConnectionTests },
  ];

  return async function runZombieReaper(): Promise<ZombieReaperSummary> {
    const settled = await Promise.allSettled(reapers.map((r) => r.run()));

    const tables: ZombieReaperTableSummary[] = settled.map((outcome, index) => {
      if (outcome.status === "fulfilled") return outcome.value;
      return {
        table: reapers[index]?.table ?? "ai_calls",
        scanned: 0,
        reaped: 0,
        results: [],
        error:
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason),
      };
    });

    const processed = tables.reduce((sum, t) => sum + t.scanned, 0);
    const reaped = tables.reduce((sum, t) => sum + t.reaped, 0);
    const errors = tables
      .filter((t) => t.error)
      .map((t) => `${t.table}: ${t.error}`);
    const breakdown = tables
      .map((t) => `${t.table}=${t.reaped}/${t.scanned}`)
      .join(" ");
    const message =
      errors.length > 0
        ? `[zombie-reaper] reaped ${reaped} (${breakdown}); errors: ${errors.join("; ")}`
        : `[zombie-reaper] reaped ${reaped} (${breakdown})`;

    if (reaped > 0) {
      try {
        deps.captureWarning("[zombie-reaper] reaped stale rows", {
          reaped,
          processed,
          tables: tables.map((t) => ({
            table: t.table,
            scanned: t.scanned,
            reaped: t.reaped,
            error: t.error,
            sample_ids: t.results.slice(0, 5).map((r) => r.id),
          })),
        });
      } catch (captureError) {
        console.error("[zombie-reaper] sentry capture failed", captureError);
      }
    }

    return { processed, reaped, message, tables };
  };
}

export const runZombieReaper = createZombieReaperRunner();

const HTTP_RESPONSE_SAMPLE_LIMIT = 5;

/**
 * HTTP shape of the reaper summary. The route is gated by
 * requireMachineApiAuth, but any infrastructure that logs response
 * bodies (proxies, Vercel response logs, error trackers) would
 * otherwise pick up the full list of internal row primary keys.
 * Truncate to a small sample so ops debugging stays useful without
 * leaking unbounded id lists into log surfaces.
 */
export function buildZombieReaperResponse(summary: ZombieReaperSummary) {
  return {
    processed: summary.processed,
    reaped: summary.reaped,
    message: summary.message,
    tables: summary.tables.map((t) => ({
      table: t.table,
      scanned: t.scanned,
      reaped: t.reaped,
      error: t.error,
      sample_ids: t.results
        .slice(0, HTTP_RESPONSE_SAMPLE_LIMIT)
        .map((r) => r.id),
    })),
  };
}
