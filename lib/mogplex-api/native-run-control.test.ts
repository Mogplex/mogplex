import assert from "node:assert/strict";
import { test } from "vitest";
import { createNativeRunControl } from "./native-run-control";
import type { TableEventPayload } from "../db/table-event-listener";
import { buildAiCall } from "../../tests/unit/helpers/mogplex-api-runs-fixtures";

test("native cancellation observes the initial row and subsequent scoped database events", async () => {
  let call = buildAiCall();
  let notify: (event: TableEventPayload) => void = () => {};
  let closed = false;
  const control = await createNativeRunControl(call.user_id, call.id, {
    createListener: async () => ({
      onNotification(handler) {
        notify = handler;
      },
      onError() {},
      async end() {
        closed = true;
      },
    }),
    loadCall: async () => call,
  });
  call = { ...call, control_state: "cancel_requested" };
  notify({
    table: "ai_calls",
    op: "UPDATE",
    id: "other",
    user_id: call.user_id,
  });
  await Promise.resolve();
  assert.equal(control.signal.aborted, false);
  const aborted = new Promise<void>((resolve) =>
    control.signal.addEventListener("abort", () => resolve(), { once: true })
  );
  notify({
    table: "ai_calls",
    op: "UPDATE",
    id: call.id,
    user_id: call.user_id,
  });
  await aborted;
  assert.equal(control.isCancelled(), true);
  await control.close();
  assert.equal(closed, true);
});

test("native cancellation before subscription completes prevents startup", async () => {
  const control = await createNativeRunControl("user-123", "call-1", {
    createListener: async () => ({
      onNotification() {},
      onError() {},
      async end() {},
    }),
    loadCall: async () => buildAiCall({ control_state: "cancel_requested" }),
  });
  assert.equal(control.signal.aborted, true);
  assert.equal(control.isCancelled(), true);
  await control.close();
});
