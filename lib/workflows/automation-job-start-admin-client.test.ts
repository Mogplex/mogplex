import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { startAutomationJobRun } from "@/lib/workflows/automation-job-start";

type FakeQuery = {
  data: unknown;
  error: null;
  select: (columns: string) => FakeQuery;
  eq: (column: string, value: unknown) => FakeQuery;
  in: (column: string, values: unknown[]) => FakeQuery;
  update: (values: Record<string, unknown>) => FakeQuery;
  insert: (values: Record<string, unknown>) => FakeQuery;
  limit: (value: number) => FakeQuery;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
};

function buildAdminClient(
  operations: string[],
  claim?: { claimed: boolean; reason: string | null },
  capacityAdmitted = true
): SupabaseClient {
  const resolvedClaim = claim ?? {
    claimed: false,
    reason: "INSTALLATION_CONCURRENCY_LIMIT",
  };
  return {
    rpc: async (name: string) => {
      operations.push(`rpc:${name}`);
      if (name === "record_job_run_start_attempt") {
        return {
          data: [
            {
              found: true,
              attempted_at: "2026-08-15T12:00:00.000Z",
            },
          ],
          error: null,
        };
      }
      if (name === "admit_billing_workflow_capacity") {
        return {
          data: [
            {
              posted: true,
              admitted: capacityAdmitted,
              would_admit: capacityAdmitted,
              active_before: capacityAdmitted ? 0 : 1,
              concurrency_limit: 1,
              accounting_mode: capacityAdmitted ? "shadow" : "enforced",
            },
          ],
          error: null,
        };
      }
      if (name === "rollback_billing_automation_job_start") {
        return {
          data: [{ reset: true, lease_released: capacityAdmitted }],
          error: null,
        };
      }
      assert.equal(name, "claim_automation_job_run");
      return {
        data: [
          {
            ...resolvedClaim,
            status: resolvedClaim.claimed ? "running" : "pending",
            started_at: "2026-08-15T12:00:00.000Z",
          },
        ],
        error: null,
      };
    },
    from: (table: string) => {
      operations.push(`from:${table}`);
      let selectedColumns = "";
      const query: FakeQuery = {
        data: null,
        error: null,
        select: (columns) => {
          selectedColumns = columns;
          return query;
        },
        eq: () => query,
        in: () => {
          if (table === "triggers") {
            query.data = [
              {
                id: "trigger-1",
                installation_id: 42,
                event: "push",
              },
            ];
          }
          return query;
        },
        update: (values) => {
          if ("status" in values) {
            operations.push(`update:${table}:status`);
          }
          if ("last_start_error" in values) {
            operations.push(`update:${table}:last_start_error`);
          }
          return query;
        },
        insert: () => query,
        limit: () => query,
        maybeSingle: async () => {
          if (table === "repos") {
            return {
              data: {
                user_id: "user-1",
                product_team_id: null,
              },
              error: null,
            };
          }
          if (table === "billing_accounts") {
            return {
              data: {
                id: "account-1",
                owner_type: "user",
                owner_user_id: "user-1",
                product_team_id: null,
              },
              error: null,
            };
          }
          if (table === "triggers") {
            return {
              data: {
                id: "trigger-1",
                user_id: "user-1",
                installation_id: 42,
                event: "push",
              },
              error: null,
            };
          }
          if (selectedColumns.includes("runtime_provider")) {
            return {
              data: {
                id: "job-1",
                status: "pending",
                runtime_provider: null,
                runtime_run_id: null,
                workflow_run_id: null,
                cancel_requested_at: null,
                cancelled_at: null,
              },
              error: null,
            };
          }
          return {
            data: {
              id: "job-1",
              assignment_id: null,
              trigger_id: "trigger-1",
              flow_id: null,
              flow_version_id: null,
              retry_of_job_run_id: null,
              status: "pending",
              created_at: "2026-08-15T11:00:00.000Z",
              metadata: {},
            },
            error: null,
          };
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

test("startAutomationJobRun uses its scoped admin client when deferring", async () => {
  const operations: string[] = [];
  const adminClient = buildAdminClient(operations);

  const result = await startAutomationJobRun("job-1", "repair", adminClient);

  assert.deepEqual(result, {
    started: false,
    deferred: true,
    status: "pending",
    reason: "INSTALLATION_CONCURRENCY_LIMIT",
  });
  assert.deepEqual(
    new Set(operations),
    new Set([
      "from:job_runs",
      "from:triggers",
      "rpc:record_job_run_start_attempt",
      "rpc:claim_automation_job_run",
      "update:job_runs:last_start_error",
      "from:automation_dispatch_events",
    ])
  );
});

test("startAutomationJobRun keeps rollback queries on the scoped client", async () => {
  vi.stubEnv("TRIGGER_SECRET_KEY", "");
  vi.stubEnv("TRIGGER_PROJECT_REF", "");
  const operations: string[] = [];
  const adminClient = buildAdminClient(operations, {
    claimed: true,
    reason: null,
  });

  await assert.rejects(
    startAutomationJobRun("job-1", "repair", adminClient),
    /Trigger.dev runtime is not configured/
  );

  assert.equal(operations.includes("update:job_runs:status"), false);
  assert.equal(
    operations.includes("rpc:rollback_billing_automation_job_start"),
    true
  );
  assert.equal(operations.includes("update:job_runs:last_start_error"), true);
  assert.equal(operations.includes("from:automation_dispatch_events"), true);
});

test("startAutomationJobRun defers an enforced account when Concurrency is full", async () => {
  const operations: string[] = [];
  const adminClient = buildAdminClient(
    operations,
    { claimed: true, reason: null },
    false
  );

  const result = await startAutomationJobRun("job-1", "repair", adminClient);

  assert.deepEqual(result, {
    started: false,
    deferred: true,
    status: "pending",
    reason: "ACCOUNT_CONCURRENCY_LIMIT",
  });
  assert.equal(
    operations.includes("rpc:admit_billing_workflow_capacity"),
    true
  );
  assert.equal(
    operations.includes("rpc:rollback_billing_automation_job_start"),
    true
  );
  assert.equal(operations.includes("from:automation_dispatch_events"), true);
});
