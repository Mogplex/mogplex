import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteFlowSchedule,
  upsertFlowSchedule,
} from "../../lib/flows/schedule-manager";

const config = {
  cron: "0 9 * * 1-5",
  timezone: "America/New_York",
};

test("schedule upsert updates a stored Trigger.dev schedule", async () => {
  const creates: unknown[] = [];
  const updates: unknown[] = [];
  const scheduleApi = {
    create: (input: unknown) => {
      creates.push(input);
      return Promise.resolve({ id: "sched-created" });
    },
    update: (scheduleId: string, input: unknown) => {
      updates.push({ scheduleId, input });
      return Promise.resolve({ id: scheduleId });
    },
    del: () => Promise.resolve({ id: "unused" }),
  };

  const scheduleId = await upsertFlowSchedule(
    "flow-1",
    config,
    "sched-existing",
    scheduleApi as never
  );

  assert.equal(scheduleId, "sched-existing");
  assert.equal(creates.length, 0);
  assert.deepEqual(updates, [
    {
      scheduleId: "sched-existing",
      input: {
        task: "dispatch-workflow-schedule",
        cron: config.cron,
        timezone: config.timezone,
        externalId: "flow-1",
      },
    },
  ]);
});

test("schedule upsert recreates a missing stored schedule", async () => {
  const scheduleApi = {
    update: () =>
      Promise.reject(Object.assign(new Error("missing"), { status: 404 })),
    create: () => Promise.resolve({ id: "sched-recreated" }),
    del: () => Promise.resolve({ id: "unused" }),
  };

  assert.equal(
    await upsertFlowSchedule(
      "flow-1",
      config,
      "sched-stale",
      scheduleApi as never
    ),
    "sched-recreated"
  );
});

test("schedule deletion is idempotent only for missing schedules", async () => {
  const missingApi = {
    del: () =>
      Promise.reject(Object.assign(new Error("missing"), { status: 404 })),
  };
  await deleteFlowSchedule("sched-missing", missingApi as never);

  const unavailableApi = {
    del: () =>
      Promise.reject(Object.assign(new Error("unavailable"), { status: 503 })),
  };
  await assert.rejects(
    deleteFlowSchedule("sched-live", unavailableApi as never),
    /unavailable/
  );
});
