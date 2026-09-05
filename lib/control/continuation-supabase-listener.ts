import { randomUUID } from "node:crypto";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  TableEventListener,
  TableEventPayload,
} from "@/lib/db/table-event-listener";

/** Legacy Supabase deployments need no direct PostgreSQL URL for cancellation. */
export async function createControlSupabaseListener(
  input: { userId: string; sessionId: string; continuationId: string },
  client = supabaseAdmin
): Promise<TableEventListener> {
  let notify: ((event: TableEventPayload) => void) | undefined;
  let onError: ((error: Error) => void) | undefined;
  let failure: Error | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  const channel = client.channel(
    `control-followup:${input.continuationId}:${randomUUID()}`
  );
  const end = async () => {
    if (closing) return closing;
    closed = true;
    closing = client.removeChannel(channel).then(() => undefined);
    return closing;
  };
  const onChange =
    (table: string, id: string) =>
    (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
      if (closed) return;
      const row = payload.eventType === "DELETE" ? payload.old : payload.new;
      if (row.id !== id || (row.user_id && row.user_id !== input.userId))
        return;
      // DELETE's default replica identity contains only the primary key.
      // The consumer checks the exact owner's row again before taking action.
      notify?.({ table, op: payload.eventType, id, user_id: input.userId });
    };
  for (const [table, id] of [
    ["control_sessions", input.sessionId],
    ["control_continuations", input.continuationId],
  ]) {
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table, filter: `id=eq.${id}` },
      onChange(table, id)
    );
  }
  try {
    await new Promise<void>((resolve, reject) => {
      channel.subscribe((status: string, error) => {
        if (closed) return;
        if (status === "SUBSCRIBED") {
          resolve();
          return;
        }
        if (
          status !== "CHANNEL_ERROR" &&
          status !== "TIMED_OUT" &&
          status !== "CLOSED"
        )
          return;
        failure =
          error ??
          new Error("Coordinator live status connection was interrupted.");
        onError?.(failure);
        reject(failure);
        void end().catch(() => undefined);
      });
    });
  } catch (error) {
    await end();
    throw error;
  }
  return {
    onNotification: (handler) => {
      notify = handler;
    },
    onError: (handler) => {
      onError = handler;
      if (failure) handler(failure);
    },
    end,
  };
}
