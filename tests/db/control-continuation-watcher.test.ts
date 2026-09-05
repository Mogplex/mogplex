import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { TableEventPayload } from "@/lib/db/table-event-listener";
import { watchControlContinuation } from "@/lib/control/continuation-watcher";
import { assertControlContinuationCurrent } from "@/lib/control/continuation-store";
import { controlContinuationDatabase } from "../support/control-continuation-database";

it.each(["neon", "supabase"] as const)(
  "%s emits owner-scoped cancellation events and interrupts the coordinator without polling",
  async (root) => {
    const f = await controlContinuationDatabase(root);
    try {
      const { continuation } = await f.rpc<{ continuation: { id: string } }>(
        "control_register_continuation",
        f.registerArgs
      );
      await f.checkpointParent();
      await f.db.query(
        "update external_agent_runs set status='success' where id=any($1)",
        [f.workerIds]
      );
      await f.rpc("control_refresh_continuation", {
        p_user_id: f.owner,
        p_continuation_id: continuation.id,
        p_parent_ai_call_id: f.parentCallId,
        p_parent_message: f.parentMessage,
      });
      await f.rpc("control_claim_continuation", {
        p_user_id: f.owner,
        p_continuation_id: continuation.id,
        p_runtime_run_id: "runtime",
      });
      const controller = new AbortController();
      let onNotification: (event: TableEventPayload) => void = (event) => {
        expect(event.table).toBeDefined();
      };
      const events: TableEventPayload[] = [];
      const unlisten = await f.db.listen("mogplex_table_events", (payload) => {
        const event = JSON.parse(payload);
        events.push(event);
        onNotification(event);
      });
      const client = f.client as unknown as Parameters<
        typeof assertControlContinuationCurrent
      >[3];
      const watcher = await watchControlContinuation(
        {
          userId: f.owner,
          sessionId: f.sessionId,
          continuationId: continuation.id,
          assertCurrent: () =>
            assertControlContinuationCurrent(
              f.owner,
              continuation.id,
              "runtime",
              client
            ),
          abort: (error) => controller.abort(error),
        },
        async () => ({
          onNotification: (handler) => {
            onNotification = handler;
          },
          onError: () => undefined,
          end: unlisten,
        })
      );
      onNotification({
        table: "control_sessions",
        op: "UPDATE",
        id: f.sessionId,
        user_id: randomUUID(),
      });
      expect(controller.signal.aborted).toBe(false);
      const aborted = new Promise<void>((resolve) =>
        controller.signal.addEventListener("abort", () => resolve(), {
          once: true,
        })
      );
      await f.db.query(
        "update control_sessions set archived=true where id=$1",
        [f.sessionId]
      );
      await aborted;
      expect(controller.signal.reason.message).toContain("superseded");
      expect(events).toContainEqual({
        table: "control_continuations",
        op: "UPDATE",
        user_id: f.owner,
        id: continuation.id,
      });
      expect(events).toContainEqual({
        table: "control_sessions",
        op: "UPDATE",
        user_id: f.owner,
        id: f.sessionId,
      });
      expect(events.every((event) => !Object.hasOwn(event, "messages"))).toBe(
        true
      );
      await watcher.end();
    } finally {
      await f.db.close();
    }
  }
);
