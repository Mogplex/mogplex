import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  ACTIVE_CONTROL_CHAT_STALE_THRESHOLD_MS,
  ACTIVE_CHAT_STALE_THRESHOLD_MS,
  ACTIVE_INTERACTIVE_STALE_THRESHOLD_MS,
  PREPARED_HARNESS_STALE_THRESHOLD_MS,
  isStaleLiveInteractiveCall,
  liveCallIdleThresholdMs,
} from "@/lib/interactive-runs";
import type { AiCall } from "@/lib/types/ai";
import { loadLatestCallActivity } from "./ai-call-activity";
import { stopOrphanedWorkers } from "./zombie-reaper-orphans";
import {
  reportStopFailures,
  stopWorkers,
  type WorkerStop,
} from "./zombie-reaper-stops";
import {
  type ZombieReaperTableSummary,
  safeAgeMs,
} from "./zombie-reaper-types";
import { stopIdleWorker } from "./zombie-reaper-workers";

export function idleStopMessage(thresholdMs: number) {
  const minutes = Math.round(thresholdMs / 60_000);
  return `Stopped after ${minutes} minutes with no progress.`;
}

const AI_CALL_CHAT_PAGE_LIMIT = 200;
const AI_CALL_INTERACTIVE_PAGE_LIMIT = 100;

type AiCallZombieRow = {
  id: string;
  type: string;
  status: string;
  started_at: string;
  user_id: string;
  conversation_id: string | null;
  repo_id: string | null;
  runtime_command_id?: string | null;
  metadata: Record<string, unknown> | null;
};

/** Separate scans keep long-running workers from crowding out dead browser
 * turns. Control has its own metadata-based scan because its calls may be
 * recorded as either chat or agent. The predicate checks the hosted deadline.
 */
type AiCallSelectResult =
  | { ok: true; rows: AiCallZombieRow[] }
  | { ok: false; error: string };

async function selectAiCallZombies(
  now: number,
  client: typeof supabaseAdmin
): Promise<AiCallSelectResult> {
  const controlCutoffIso = new Date(
    now - ACTIVE_CONTROL_CHAT_STALE_THRESHOLD_MS
  ).toISOString();
  const chatCutoffIso = new Date(
    now - ACTIVE_CHAT_STALE_THRESHOLD_MS
  ).toISOString();
  const interactiveCutoffIso = new Date(
    now - ACTIVE_INTERACTIVE_STALE_THRESHOLD_MS
  ).toISOString();
  const preparedCutoffIso = new Date(
    now - PREPARED_HARNESS_STALE_THRESHOLD_MS
  ).toISOString();

  const selection =
    "id, type, status, started_at, user_id, conversation_id, repo_id, runtime_command_id, metadata";

  const [controlResult, chatResult, interactiveResult, preparedResult] =
    await Promise.all([
      client
        .from("ai_calls")
        .select(selection)
        .contains("metadata", { surface: "control" })
        .in("status", ["pending", "streaming"])
        .lt("started_at", controlCutoffIso)
        .order("started_at", { ascending: true })
        .limit(AI_CALL_CHAT_PAGE_LIMIT),
      client
        .from("ai_calls")
        .select(selection)
        .eq("type", "chat")
        .in("status", ["pending", "streaming"])
        .lt("started_at", chatCutoffIso)
        .order("started_at", { ascending: true })
        .limit(AI_CALL_CHAT_PAGE_LIMIT),
      client
        .from("ai_calls")
        .select(selection)
        .neq("type", "chat")
        .in("status", ["pending", "streaming"])
        .lt("started_at", interactiveCutoffIso)
        .order("started_at", { ascending: true })
        .limit(AI_CALL_INTERACTIVE_PAGE_LIMIT),
      client
        .from("ai_calls")
        .select(selection)
        .in("status", ["pending", "streaming"])
        .contains("metadata", { prepared: true })
        .lt("started_at", preparedCutoffIso)
        .order("started_at", { ascending: true })
        .limit(AI_CALL_INTERACTIVE_PAGE_LIMIT),
    ]);

  if (controlResult.error)
    return { ok: false, error: controlResult.error.message };
  if (chatResult.error) return { ok: false, error: chatResult.error.message };
  if (interactiveResult.error)
    return { ok: false, error: interactiveResult.error.message };
  if (preparedResult.error)
    return { ok: false, error: preparedResult.error.message };

  const unique = new Map<string, AiCallZombieRow>();
  for (const row of [
    ...((controlResult.data ?? []) as AiCallZombieRow[]),
    ...((chatResult.data ?? []) as AiCallZombieRow[]),
    ...((interactiveResult.data ?? []) as AiCallZombieRow[]),
    ...((preparedResult.data ?? []) as AiCallZombieRow[]),
  ]) {
    unique.set(row.id, row);
  }

  // Retained Trigger workers predate control_runtime. Their durable ticket
  // identifies the hosted execution without trusting client metadata or
  // shortening the lifetime of a still-running previous-release worker.
  const legacyIds = [...unique.values()]
    .filter(
      (row) =>
        row.metadata?.surface === "control" && !row.metadata.control_runtime
    )
    .map((row) => row.id);
  for (const id of legacyIds) {
    const call = unique.get(id)!;
    call.metadata = { ...call.metadata, control_runtime: "request" };
  }
  if (legacyIds.length > 0) {
    const { data: continuations, error } = await client
      .from("control_continuations")
      .select("resume_ai_call_id, user_id")
      .in("resume_ai_call_id", legacyIds);
    if (error) return { ok: false, error: error.message };
    for (const ticket of continuations ?? []) {
      const call = unique.get(ticket.resume_ai_call_id);
      if (call && call.user_id === ticket.user_id) {
        call.metadata = { ...call.metadata, control_runtime: "background" };
      }
    }
  }

  return {
    ok: true,
    rows: [...unique.values()],
  };
}

/** Marks one idle call failed and records why; false if it was already finished. */
async function markIdleCallFailed(
  client: typeof supabaseAdmin,
  input: {
    row: AiCallZombieRow;
    error: string;
    ageMs: number | null;
    now: number;
    lastActivityAt: string | null;
  }
) {
  const { row, error, ageMs, now, lastActivityAt } = input;
  const completedAt = new Date(now).toISOString();

  const { data: updated, error: updateError } = await client
    .from("ai_calls")
    .update({
      status: "failed",
      error,
      completed_at: completedAt,
    })
    .eq("id", row.id)
    .in("status", ["pending", "streaming"])
    .select("id")
    .maybeSingle();

  if (updateError) {
    console.error("[zombie-reaper] failed to mark ai_call as failed", {
      id: row.id,
      error: updateError.message,
    });
    return false;
  }

  if (!updated) return false; // Another reaper or finalizer already finished it.

  // Best-effort terminal event so the observability pane shows the
  // reap explicitly rather than a silent status flip.
  const { error: eventError } = await client.from("ai_call_events").insert({
    ai_call_id: row.id,
    user_id: row.user_id,
    conversation_id: row.conversation_id,
    repo_id: row.repo_id,
    event_type: "failed",
    message: error,
    payload: {
      age_ms: ageMs,
      last_activity_at: lastActivityAt,
      source: "zombie-row-reaper",
    },
  });

  if (eventError) {
    console.error("[zombie-reaper] failed to append ai_call_events row", {
      id: row.id,
      error: eventError.message,
    });
  }
  return true;
}

export async function reapStaleAiCalls(
  client = supabaseAdmin,
  stopWorker: typeof stopIdleWorker = stopIdleWorker
): Promise<ZombieReaperTableSummary> {
  const summary: ZombieReaperTableSummary = {
    table: "ai_calls",
    scanned: 0,
    reaped: 0,
    results: [],
    error: null,
  };

  const now = Date.now();
  // Retry stops a previous cycle could not finish before reaping more.
  reportStopFailures(
    summary,
    await stopOrphanedWorkers(client, now, stopWorker)
  );

  const candidatesResult = await selectAiCallZombies(now, client);
  if (!candidatesResult.ok) {
    summary.error = candidatesResult.error;
    return summary;
  }

  const candidates = candidatesResult.rows;
  summary.scanned = candidates.length;
  // The age scan only finds calls old enough to have been idle that long;
  // whether they actually were is decided by their newest event.
  const activity = await loadLatestCallActivity(
    client,
    candidates.map((row) => row.id)
  );

  const stops: WorkerStop[] = [];
  for (const row of candidates) {
    const lastActivityAt = activity.get(row.id);
    const call = {
      type: row.type as AiCall["type"],
      status: row.status as AiCall["status"],
      started_at: row.started_at,
      metadata: row.metadata ?? {},
    };
    if (
      lastActivityAt === undefined ||
      !isStaleLiveInteractiveCall(call, now, lastActivityAt)
    ) {
      continue;
    }
    const error = idleStopMessage(liveCallIdleThresholdMs(call));
    const ageMs = safeAgeMs(row.started_at, now);
    if (
      !(await markIdleCallFailed(client, {
        row,
        error,
        ageMs,
        now,
        lastActivityAt,
      }))
    ) {
      continue;
    }

    stops.push({ call: row, error });
    summary.reaped += 1;
    summary.results.push({
      table: "ai_calls",
      id: row.id,
      ageMs,
      action: "marked_failed",
      detail: row.type,
    });
  }

  reportStopFailures(summary, await stopWorkers(client, stops, stopWorker));
  return summary;
}
