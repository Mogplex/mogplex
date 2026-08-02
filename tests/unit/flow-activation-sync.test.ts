import assert from "node:assert/strict";
import test from "node:test";
import { syncScheduledFlowActivation } from "../../lib/flows/activation-sync";
import { FlowServiceError } from "../../lib/flows/errors";

test("failed pause persistence restores an active schedule", async () => {
  const scheduleStatuses: string[] = [];

  await assert.rejects(
    syncScheduledFlowActivation({
      previousStatus: "active",
      nextStatus: "inactive",
      scheduleId: "sched-1",
      setScheduleStatus: async (_scheduleId, status) => {
        scheduleStatuses.push(status);
      },
      persistStatus: async () => {
        throw new Error("database unavailable");
      },
    }),
    (error) => {
      assert.ok(error instanceof FlowServiceError);
      assert.equal(error.code, "FLOW_STORAGE_FAILED");
      return true;
    }
  );

  assert.deepEqual(scheduleStatuses, ["inactive", "active"]);
});

test("failed resume persistence restores an inactive schedule", async () => {
  const scheduleStatuses: string[] = [];

  await assert.rejects(
    syncScheduledFlowActivation({
      previousStatus: "inactive",
      nextStatus: "active",
      scheduleId: "sched-1",
      setScheduleStatus: async (_scheduleId, status) => {
        scheduleStatuses.push(status);
      },
      persistStatus: async () => {
        throw new Error("database unavailable");
      },
    }),
    (error) => {
      assert.ok(error instanceof FlowServiceError);
      assert.equal(error.code, "FLOW_STORAGE_FAILED");
      return true;
    }
  );

  assert.deepEqual(scheduleStatuses, ["active", "inactive"]);
});

test("schedule rollback failures surface a distinct activation error", async () => {
  let scheduleUpdateCount = 0;

  await assert.rejects(
    syncScheduledFlowActivation({
      previousStatus: "inactive",
      nextStatus: "active",
      scheduleId: "sched-1",
      setScheduleStatus: async () => {
        scheduleUpdateCount += 1;
        if (scheduleUpdateCount === 2) {
          throw new Error("Trigger.dev unavailable");
        }
      },
      persistStatus: async () => {
        throw new Error("database unavailable");
      },
    }),
    (error) => {
      assert.ok(error instanceof FlowServiceError);
      assert.equal(error.code, "FLOW_ACTIVATION_ROLLBACK_FAILED");
      assert.match(error.message, /restore the workflow schedule/i);
      return true;
    }
  );

  assert.equal(scheduleUpdateCount, 2);
});
