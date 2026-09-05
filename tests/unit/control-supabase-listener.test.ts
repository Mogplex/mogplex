import assert from "node:assert/strict";
import test from "node:test";
import { createControlSupabaseListener } from "../../lib/control/continuation-supabase-listener";
import type { TableEventPayload } from "../../lib/db/table-event-listener";
import { supabaseRealtimeSocket } from "../support/supabase-realtime-socket";

const scope = {
  userId: "owner",
  sessionId: "session",
  continuationId: "ticket",
};
test("real Supabase subscription delivers only exact owned resources and tears down", async () => {
  const f = supabaseRealtimeSocket();
  const listener = await createControlSupabaseListener(scope, f.client);
  const events: TableEventPayload[] = [];
  listener.onNotification((event) => events.push(event));
  try {
    f.emit("control_sessions", { id: "session", user_id: "other" });
    f.emit("control_sessions", { id: "different", user_id: "owner" });
    assert.deepEqual(events, []);
    f.emit("control_sessions", {
      id: "session",
      user_id: "owner",
      messages: ["private"],
    });
    f.emit("control_continuations", { id: "ticket" }, "DELETE");
    assert.deepEqual(events, [
      {
        table: "control_sessions",
        op: "UPDATE",
        id: "session",
        user_id: "owner",
      },
      {
        table: "control_continuations",
        op: "DELETE",
        id: "ticket",
        user_id: "owner",
      },
    ]);
  } finally {
    await listener.end();
  }
  assert.equal(f.leaves, 1);
  assert.equal(f.client.getChannels().length, 0);
  await listener.end();
  assert.equal(f.leaves, 1);
});

test("failed Supabase subscriptions reject and do not keep a reconnecting channel", async () => {
  const f = supabaseRealtimeSocket({ rejectJoin: true });
  await assert.rejects(
    createControlSupabaseListener(scope, f.client),
    /subscription refused/
  );
  assert.equal(f.client.getChannels().length, 0);
});

test("a dropped subscription interrupts the consumer and closes its channel", async () => {
  const f = supabaseRealtimeSocket();
  const listener = await createControlSupabaseListener(scope, f.client);
  const failed = new Promise<Error>((resolve) => listener.onError(resolve));
  f.disconnect();
  assert.ok(await failed);
  await listener.end();
  assert.equal(f.client.getChannels().length, 0);
});
