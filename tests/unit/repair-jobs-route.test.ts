import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRepairJobsGetHandler } from "../../app/api/cron/repair-jobs/route";

function buildPendingJobsClient() {
  const jobs = [
    {
      id: "job-1",
      status: "pending",
      created_at: "2026-08-15T10:00:00.000Z",
      started_at: null,
      last_start_attempt_at: null,
    },
    {
      id: "job-2",
      status: "pending",
      created_at: "2026-08-15T10:01:00.000Z",
      started_at: null,
      last_start_attempt_at: null,
    },
  ];
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    limit: async () => ({ data: jobs, error: null }),
  };
  return {
    from: (table: string) => {
      assert.equal(table, "job_runs");
      return query;
    },
  } as unknown as SupabaseClient;
}

test("repair-jobs keeps loading and nested starts inside one admin connection", async () => {
  const adminClient = buildPendingJobsClient();
  const startedJobIds: string[] = [];
  const startClients: SupabaseClient[] = [];
  let connectionRuns = 0;
  let insideConnection = false;
  const handler = createRepairJobsGetHandler({
    requireMachineApiAuth: () => null,
    withSupabaseAdminConnection: async (operation) => {
      connectionRuns += 1;
      insideConnection = true;
      try {
        return await operation(adminClient);
      } finally {
        insideConnection = false;
      }
    },
    isRepairablePendingJob: () => true,
    startAutomationJobRun: async (jobRunId, _source, client) => {
      assert.equal(insideConnection, true);
      assert.ok(client);
      startedJobIds.push(jobRunId);
      startClients.push(client);
      return {
        started: true,
        status: "running",
        runtimeProvider: "trigger",
        runtimeRunId: `run-${jobRunId}`,
      };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/cron/repair-jobs")
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(connectionRuns, 1);
  assert.deepEqual(startedJobIds, ["job-1", "job-2"]);
  assert.deepEqual(startClients, [adminClient, adminClient]);
  assert.equal(body.scanned, 2);
  assert.equal(body.started, 2);
  assert.equal(body.failed, 0);
});

test("repair-jobs returns consistent counters for an empty batch", async () => {
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    limit: async () => ({ data: [], error: null }),
  };
  const adminClient = {
    from: () => query,
  } as unknown as SupabaseClient;
  const handler = createRepairJobsGetHandler({
    requireMachineApiAuth: () => null,
    withSupabaseAdminConnection: (operation) => operation(adminClient),
  });

  const response = await handler(
    new Request("http://localhost/api/cron/repair-jobs")
  );

  assert.deepEqual(await response.json(), {
    message: "No stale pending jobs",
    scanned: 0,
    started: 0,
    deferred: 0,
    failed: 0,
  });
});
