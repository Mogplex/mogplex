import assert from "node:assert/strict";
import test from "node:test";
import { runWorkflowSchedule } from "../../trigger/workflow-schedule";

test("scheduled workflow dispatch keys each expected occurrence exactly once", async () => {
  const calls: unknown[] = [];
  const output = await runWorkflowSchedule(
    {
      scheduleId: "sched_123",
      externalId: "flow-1",
      timestamp: new Date("2026-07-23T13:00:00.000Z"),
      lastTimestamp: new Date("2026-07-22T13:00:00.000Z"),
      timezone: "America/New_York",
    },
    async (input) => {
      calls.push(input);
      return {
        matched: true,
        outcome: "queued",
        jobRunId: "run-1",
        started: true,
        reason: null,
      };
    }
  );

  assert.equal(output.flowId, "flow-1");
  assert.deepEqual(calls, [
    {
      flowId: "flow-1",
      event: "schedule",
      idempotencyKey: "workflow-schedule:sched_123:2026-07-23T13:00:00.000Z",
      startSource: "cron",
      payload: {
        scheduled_at: "2026-07-23T13:00:00.000Z",
        previous_scheduled_at: "2026-07-22T13:00:00.000Z",
        timezone: "America/New_York",
        schedule_id: "sched_123",
      },
    },
  ]);
});

test("scheduled workflow rejects payloads without a flow external id", async () => {
  await assert.rejects(
    runWorkflowSchedule({
      scheduleId: "sched_123",
      timestamp: new Date("2026-07-23T13:00:00.000Z"),
      timezone: "UTC",
    }),
    /missing its flow externalId/i
  );
});
