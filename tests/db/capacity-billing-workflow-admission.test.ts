import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ACCOUNT_ID,
  CANCELLATION_ACCOUNT_ID,
  createBillingTestDb,
  seedBillingAccounts,
  USAGE_ACCOUNT_ID,
} from "./helpers/billing-ledger-fixtures";

const JOB_ONE = "20000000-0000-4000-8000-000000000001";
const JOB_TWO = "20000000-0000-4000-8000-000000000002";
const JOB_THREE = "20000000-0000-4000-8000-000000000003";
const JOB_FOUR = "20000000-0000-4000-8000-000000000004";
const ATTEMPTED_AT = "2026-08-16T15:00:00.000Z";

type AdmissionRow = {
  posted: boolean;
  admitted: boolean;
  would_admit: boolean;
  active_before: number;
  concurrency_limit: number;
  accounting_mode: string;
};

function admission(
  db: PGlite,
  input: {
    accountId: string;
    jobRunId: string;
    attempt: string;
    metadata?: string;
  }
) {
  return db.query<AdmissionRow>(
    `select * from admit_billing_workflow_capacity(
       $1, $2, $3, $4, $5, $6, $7::jsonb
     )`,
    [
      input.accountId,
      `admission:${input.jobRunId}:${input.attempt}`,
      `source:${input.jobRunId}:${input.attempt}`,
      `lease:${input.jobRunId}:${input.attempt}`,
      input.jobRunId,
      ATTEMPTED_AT,
      input.metadata ?? "{}",
    ]
  );
}

describe("capacity billing workflow admission", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createBillingTestDb();
    await seedBillingAccounts(db);
    await db.query(
      `update billing_accounts
       set included_concurrency = 1
       where id in ($1, $2)`,
      [ACCOUNT_ID, CANCELLATION_ACCOUNT_ID]
    );
    await db.query(
      `insert into job_runs (id, status, started_at)
       values ($1, 'running', $5), ($2, 'running', $5),
              ($3, 'running', $5), ($4, 'running', $5)`,
      [JOB_ONE, JOB_TWO, JOB_THREE, JOB_FOUR, ATTEMPTED_AT]
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it("records shadow pressure without blocking work", async () => {
    const first = await admission(db, {
      accountId: ACCOUNT_ID,
      jobRunId: JOB_ONE,
      attempt: "one",
    });
    const second = await admission(db, {
      accountId: ACCOUNT_ID,
      jobRunId: JOB_TWO,
      attempt: "one",
    });

    expect(first.rows).toEqual([
      {
        posted: true,
        admitted: true,
        would_admit: true,
        active_before: 0,
        concurrency_limit: 1,
        accounting_mode: "shadow",
      },
    ]);
    expect(second.rows).toEqual([
      {
        posted: true,
        admitted: true,
        would_admit: false,
        active_before: 1,
        concurrency_limit: 1,
        accounting_mode: "shadow",
      },
    ]);

    const active = await db.query<{ count: number }>(
      `select count(*)::integer as count
       from billing_active_workflow_capacity_leases
       where account_id = $1`,
      [ACCOUNT_ID]
    );
    expect(active.rows).toEqual([{ count: 2 }]);
  });

  it("releases a lease in the same transaction as a terminal job update", async () => {
    await db.query(
      `update job_runs
       set status = 'success', completed_at = $2
       where id = $1`,
      [JOB_ONE, "2026-08-16T15:10:00.000Z"]
    );

    const release = await db.query<{
      terminal_outcome: string;
      source_ref: string;
    }>(
      `select release.terminal_outcome, release.source_ref
       from billing_workflow_capacity_release_events release
       join billing_workflow_capacity_leases lease
         on lease.id = release.lease_id
       where lease.root_workflow_ref = $1`,
      [JOB_ONE]
    );
    expect(release.rows).toHaveLength(1);
    expect(release.rows[0]?.terminal_outcome).toBe("success");
    expect(release.rows[0]?.source_ref).toMatch(/^job-terminal:/);
  });

  it("atomically rolls back a claimed job and permits a later attempt", async () => {
    const rolledBack = await db.query<{
      reset: boolean;
      lease_released: boolean;
    }>(
      `select * from rollback_billing_automation_job_start(
         $1, 'dispatch-failed:job-two', $2, '{"provider":"trigger"}'
       )`,
      [JOB_TWO, "2026-08-16T15:11:00.000Z"]
    );
    expect(rolledBack.rows).toEqual([{ reset: true, lease_released: true }]);

    const job = await db.query<{ status: string; started_at: string | null }>(
      `select status, started_at from job_runs where id = $1`,
      [JOB_TWO]
    );
    expect(job.rows).toEqual([{ status: "pending", started_at: null }]);

    await db.query(
      `update job_runs set status = 'running', started_at = $2 where id = $1`,
      [JOB_TWO, "2026-08-16T15:12:00.000Z"]
    );
    const retry = await admission(db, {
      accountId: ACCOUNT_ID,
      jobRunId: JOB_TWO,
      attempt: "two",
    });
    expect(retry.rows[0]).toMatchObject({ posted: true, admitted: true });

    const historical = await db.query<{ count: number }>(
      `select count(*)::integer as count
       from billing_workflow_capacity_leases
       where root_workflow_ref = $1`,
      [JOB_TWO]
    );
    expect(historical.rows).toEqual([{ count: 2 }]);
  });

  it("blocks only enforced accounts and records rejected decisions", async () => {
    await db.query(
      `update billing_accounts
       set entitlement_enforcement_mode = 'enforced'
       where id = $1`,
      [CANCELLATION_ACCOUNT_ID]
    );

    const first = await admission(db, {
      accountId: CANCELLATION_ACCOUNT_ID,
      jobRunId: JOB_THREE,
      attempt: "one",
    });
    const blocked = await admission(db, {
      accountId: CANCELLATION_ACCOUNT_ID,
      jobRunId: JOB_FOUR,
      attempt: "one",
    });

    expect(first.rows[0]).toMatchObject({
      admitted: true,
      would_admit: true,
      accounting_mode: "enforced",
    });
    expect(blocked.rows[0]).toMatchObject({
      admitted: false,
      would_admit: false,
      active_before: 1,
      concurrency_limit: 1,
      accounting_mode: "enforced",
    });

    const rejectedLease = await db.query<{ count: number }>(
      `select count(*)::integer as count
       from billing_workflow_capacity_leases
       where root_workflow_ref = $1`,
      [JOB_FOUR]
    );
    expect(rejectedLease.rows).toEqual([{ count: 0 }]);

    const duplicate = await admission(db, {
      accountId: CANCELLATION_ACCOUNT_ID,
      jobRunId: JOB_FOUR,
      attempt: "one",
    });
    expect(duplicate.rows[0]).toMatchObject({
      posted: false,
      admitted: false,
    });

    await expect(
      admission(db, {
        accountId: CANCELLATION_ACCOUNT_ID,
        jobRunId: JOB_FOUR,
        attempt: "one",
        metadata: '{"changed":true}',
      })
    ).rejects.toThrow(/capacity admission idempotency conflict/);
  });

  it("classifies timeout and operator repair terminal paths", async () => {
    await db.query(
      `update job_runs
       set status = 'failed', error = 'provider request timed out',
           completed_at = $2
       where id = $1`,
      [JOB_THREE, "2026-08-16T15:20:00.000Z"]
    );
    const timeout = await db.query<{ terminal_outcome: string }>(
      `select release.terminal_outcome
       from billing_workflow_capacity_release_events release
       join billing_workflow_capacity_leases lease
         on lease.id = release.lease_id
       where lease.root_workflow_ref = $1`,
      [JOB_THREE]
    );
    expect(timeout.rows).toEqual([{ terminal_outcome: "timeout" }]);

    await db.query(
      `select * from rollback_billing_automation_job_start(
         $1, 'blocked-reset:job-four', $2, '{}'
       )`,
      [JOB_FOUR, "2026-08-16T15:21:00.000Z"]
    );
    await db.query(
      `update job_runs
       set status = 'running', started_at = $2 where id = $1`,
      [JOB_FOUR, "2026-08-16T15:22:00.000Z"]
    );
    await admission(db, {
      accountId: CANCELLATION_ACCOUNT_ID,
      jobRunId: JOB_FOUR,
      attempt: "two",
    });
    await db.query(
      `update job_runs
       set status = 'failed', error = 'RECONCILED_MISSING_RUNTIME_HANDLE',
           completed_at = $2
       where id = $1`,
      [JOB_FOUR, "2026-08-16T15:23:00.000Z"]
    );
    const repaired = await db.query<{ terminal_outcome: string }>(
      `select release.terminal_outcome
       from billing_workflow_capacity_release_events release
       join billing_workflow_capacity_leases lease
         on lease.id = release.lease_id
       where lease.root_workflow_ref = $1
       order by release.id desc
       limit 1`,
      [JOB_FOUR]
    );
    expect(repaired.rows).toEqual([{ terminal_outcome: "operator_repair" }]);
  });

  it("preserves shadow-writer idempotency while allowing a released root to retry", async () => {
    const first = await db.query<{ posted: boolean }>(
      `select posted from record_billing_shadow_capacity_lease(
         $1, 'legacy-lease-one', 'legacy-source-one', 'legacy-root',
         $2, '{}'
       )`,
      [USAGE_ACCOUNT_ID, ATTEMPTED_AT]
    );
    expect(first.rows).toEqual([{ posted: true }]);

    await expect(
      db.query(
        `select * from record_billing_shadow_capacity_lease(
           $1, 'legacy-lease-conflict', 'legacy-source-conflict',
           'legacy-root', $2, '{}'
         )`,
        [USAGE_ACCOUNT_ID, ATTEMPTED_AT]
      )
    ).rejects.toThrow(/capacity lease idempotency conflict/);

    await db.query(
      `select record_billing_capacity_release(
         'legacy-lease-one', 'failure', 'legacy-release-one', $1, '{}'
       )`,
      ["2026-08-16T15:30:00.000Z"]
    );
    const retry = await db.query<{ posted: boolean }>(
      `select posted from record_billing_shadow_capacity_lease(
         $1, 'legacy-lease-two', 'legacy-source-two', 'legacy-root',
         $2, '{}'
       )`,
      [USAGE_ACCOUNT_ID, "2026-08-16T15:31:00.000Z"]
    );
    expect(retry.rows).toEqual([{ posted: true }]);
  });

  it("keeps admission facts append-only and service-only", async () => {
    await expect(
      db.query(
        `update billing_workflow_capacity_admission_events
         set metadata = '{"changed":true}'`
      )
    ).rejects.toThrow(/append-only/);

    const privileges = await db.query<{
      anon: boolean;
      authenticated: boolean;
      service_role: boolean;
    }>(
      `select
         has_function_privilege(
           'anon',
           'public.admit_billing_workflow_capacity(uuid,text,text,text,text,timestamp with time zone,jsonb)',
           'execute'
         ) as anon,
         has_function_privilege(
           'authenticated',
           'public.admit_billing_workflow_capacity(uuid,text,text,text,text,timestamp with time zone,jsonb)',
           'execute'
         ) as authenticated,
         has_function_privilege(
           'service_role',
           'public.admit_billing_workflow_capacity(uuid,text,text,text,text,timestamp with time zone,jsonb)',
           'execute'
         ) as service_role`
    );
    expect(privileges.rows).toEqual([
      { anon: false, authenticated: false, service_role: true },
    ]);
  });
});
