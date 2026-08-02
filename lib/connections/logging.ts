import { supabaseAdmin } from "@/lib/supabase/admin";

type ConnectionEvent =
  | "connection_created"
  | "connection_create_failed"
  | "connection_test_started"
  | "connection_test_succeeded"
  | "connection_test_failed"
  | "connection_test_persist_failed"
  | "connection_override_changed"
  | "connection_runtime_skipped"
  | "connection_runtime_load_failed";

/**
 * Where a failure was observed. Persisted to connection_events.surface
 * for the 24h aggregation surface in /api/observability/stats (PR B).
 *
 * - `chat`    — runtime tool load from app/api/chat (lib/agents/tools.ts)
 * - `harness` — runtime tool load from sandbox harness (lib/harness/mcp-config.ts)
 * - `test`    — manual Test invocation from the connections UI
 * - `reaper`  — cleared by zombie-row-reaper after a stuck testing row
 */
export type ConnectionEventSurface = "chat" | "harness" | "test" | "reaper";

type ConnectionLogDetails = {
  userId?: string;
  repoId?: string | null;
  connectionId?: string;
  presetId?: string | null;
  connectionType?: string | null;
  authType?: string | null;
  healthStatus?: string;
  httpStatus?: number;
  toolCount?: number;
  reason?: string;
  /**
   * Required for events that persist to connection_events. Console-only
   * events (creates, successes, override toggles) ignore this field.
   * See `EVENT_TO_DB_TYPE` for which events persist.
   */
  surface?: ConnectionEventSurface;
  /**
   * Optional join to ai_calls. Set when the failure happened inside a
   * specific chat or harness run so the event row links back to the
   * call that triggered it.
   */
  aiCallId?: string;
  /**
   * Surface-specific extras merged into the persisted payload column.
   * Used by the zombie-reaper to record `{ age_ms, source }` without
   * widening the strongly-typed core fields. Keys here override
   * core-payload fields with the same name — caller's responsibility.
   */
  payloadExtras?: Record<string, unknown>;
};

type PersistedConnectionEventType =
  | "runtime_load_failed"
  | "test_failed"
  | "test_persist_failed";

/**
 * Subset of `ConnectionEvent` that gets a row in connection_events.
 * Successful loads, manual test-started markers, override toggles,
 * and create-failed (which has no connection_id yet) stay
 * console-only. The surface PR (B) adds 24h aggregations from the
 * persisted set; the broader log line is still searchable in Vercel
 * runtime logs for events that don't make sense to persist per-row.
 */
const EVENT_TO_DB_TYPE: Partial<
  Record<ConnectionEvent, PersistedConnectionEventType>
> = {
  connection_runtime_load_failed: "runtime_load_failed",
  connection_test_failed: "test_failed",
  connection_test_persist_failed: "test_persist_failed",
};

export type ConnectionEventInsert = {
  connection_id: string;
  user_id: string;
  event_type: PersistedConnectionEventType;
  surface: ConnectionEventSurface;
  ai_call_id: string | null;
  message: string | null;
  payload: Record<string, unknown>;
};

/**
 * Pure helper exposed for unit testing. Returns the row that should be
 * inserted into connection_events for this log invocation, or null when
 * the event is console-only OR the call site didn't carry the fields
 * the table requires (connection_id, user_id, surface). A logger call
 * that intends to persist must always provide all three; returning null
 * — rather than throwing — keeps the observability path strictly
 * non-blocking for callers.
 */
export function buildConnectionEventInsert(
  event: ConnectionEvent,
  details: ConnectionLogDetails
): ConnectionEventInsert | null {
  const dbType = EVENT_TO_DB_TYPE[event];
  // Event is intentionally console-only (creates, successes,
  // override toggles, runtime_skipped). Silent skip is correct.
  if (!dbType) return null;

  if (!details.connectionId || !details.userId || !details.surface) {
    // The event TYPE is meant to persist but the call site didn't
    // carry the fields the table requires. This is a call-site bug
    // (forgot to thread userId / surface) — emit a loud warning
    // pointing at it so the gap doesn't silently accumulate as
    // future call sites are added. Returning null still keeps the
    // observability path non-blocking.
    console.warn(
      "[connections] persistable event missing required fields — falling back to console-only",
      {
        event,
        hasConnectionId: Boolean(details.connectionId),
        hasUserId: Boolean(details.userId),
        hasSurface: Boolean(details.surface),
      }
    );
    return null;
  }

  return {
    connection_id: details.connectionId,
    user_id: details.userId,
    event_type: dbType,
    surface: details.surface,
    ai_call_id: details.aiCallId ?? null,
    message: details.reason ?? null,
    payload: {
      preset: details.presetId ?? null,
      connection_type: details.connectionType ?? null,
      auth_type: details.authType ?? null,
      health_status: details.healthStatus ?? null,
      http_status: details.httpStatus ?? null,
      tool_count: details.toolCount ?? null,
      repo_id: details.repoId ?? null,
      ...details.payloadExtras,
    },
  };
}

async function persistConnectionEvent(
  insert: ConnectionEventInsert
): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from("connection_events")
      .insert(insert);
    if (error) {
      console.error("[connections] failed to persist event", {
        event_type: insert.event_type,
        connection_id: insert.connection_id,
        error: error.message,
      });
    }
  } catch (err) {
    console.error("[connections] failed to persist event (threw)", {
      event_type: insert.event_type,
      connection_id: insert.connection_id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function logConnectionEvent(
  event: ConnectionEvent,
  details: ConnectionLogDetails
) {
  console.info(
    "[connections]",
    JSON.stringify({
      event,
      ts: new Date().toISOString(),
      ...details,
    })
  );

  const insert = buildConnectionEventInsert(event, details);
  if (!insert) return;

  // Fire-and-forget: every existing call site treats logConnectionEvent
  // as void (none of them await). The persist step must never block or
  // throw back to the caller; failures are surfaced via console.error
  // inside persistConnectionEvent so they show up in runtime logs.
  //
  // Trailing .catch instead of `void` is defense-in-depth: in the
  // happy path, persistConnectionEvent's outer try/catch already
  // absorbs both synchronous throws from supabaseAdmin.from(...) and
  // rejected awaits from .insert(...). But `void X()` would surface
  // any future code path that throws BEFORE entering the try block
  // (e.g. a refactor that adds a guard above the try) as an
  // unhandled rejection — and Node 18+ terminates the process on
  // unhandled rejections by default. logConnectionEvent fires inside
  // defaultReapStaleConnectionTests's tight loop, so an
  // unhandled-rejection crash there would abort the whole reaper run.
  // The .catch keeps the contract robust against that class of
  // refactor without changing the happy-path behaviour.
  persistConnectionEvent(insert).catch((err) => {
    console.error("[connections] persist threw unexpectedly", {
      event_type: insert.event_type,
      connection_id: insert.connection_id,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
