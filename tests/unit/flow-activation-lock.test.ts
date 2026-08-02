import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireFlowActivationLock,
  runWithFlowActivationLock,
  type FlowActivationLockResult,
} from "../../lib/flows/activation-lock";
import { syncScheduledFlowActivation } from "../../lib/flows/activation-sync";
import { FlowServiceError } from "../../lib/flows/errors";

test("a live activation lock cannot expire while its holder is running", async () => {
  let inserted = false;
  const result = await acquireFlowActivationLock("flow-1", {
    load: async () => ({
      flow_id: "flow-1",
      lock_token: "holder-token",
      locked_at: "2000-01-01T00:00:00.000Z",
    }),
    insert: async () => {
      inserted = true;
      return { acquired: true, token: "replacement-token" };
    },
  });

  assert.deepEqual(result, { acquired: false, reason: "in_progress" });
  assert.equal(inserted, false);
});

test("a delayed failed activation cannot roll back a newer concurrent request", async () => {
  let heldToken: string | null = null;
  let firstStarted!: () => void;
  let finishFirst!: () => void;
  const firstStartedPromise = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const finishFirstPromise = new Promise<void>((resolve) => {
    finishFirst = resolve;
  });
  const acquire = async (): Promise<FlowActivationLockResult> => {
    if (heldToken) {
      return { acquired: false, reason: "in_progress" };
    }
    heldToken = crypto.randomUUID();
    return { acquired: true, token: heldToken };
  };
  const release = async (_flowId: string, token: string) => {
    if (heldToken !== token) return false;
    heldToken = null;
    return true;
  };
  const deps = {
    acquire,
    release,
    reportReleaseError: () => undefined,
  };

  const first = runWithFlowActivationLock(
    "flow-1",
    async () => {
      firstStarted();
      await finishFirstPromise;
      return syncScheduledFlowActivation({
        previousStatus: "inactive",
        nextStatus: "active",
        scheduleId: "sched-1",
        setScheduleStatus: async () => undefined,
        persistStatus: async () => {
          throw new Error("delayed database failure");
        },
      });
    },
    deps
  );
  await firstStartedPromise;

  let secondCommitted = false;
  await assert.rejects(
    runWithFlowActivationLock(
      "flow-1",
      async () => {
        secondCommitted = true;
      },
      deps
    ),
    (error) => {
      assert.ok(error instanceof FlowServiceError);
      assert.equal(error.code, "FLOW_ACTIVATION_IN_PROGRESS");
      return true;
    }
  );

  finishFirst();
  await assert.rejects(first, /delayed database failure/);
  assert.equal(secondCommitted, false);
});
