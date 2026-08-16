import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BILLING_JOB_RUN_STUB_SQL,
  SANDBOX_BILLING_SANDBOX_STUB_SQL,
} from "./harness";

const databaseUrl = process.env.SANDBOX_BILLING_TEST_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe : describe.skip;

const ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "10000000-0000-4000-8000-000000000002";
const SANDBOX_ONE_ID = "10000000-0000-4000-8000-000000000003";
const SANDBOX_TWO_ID = "10000000-0000-4000-8000-000000000004";
const OPEN_RACE_SANDBOX_ID = "10000000-0000-4000-8000-000000000005";
const SHADOW_ACCOUNT_ID = "10000000-0000-4000-8000-000000000006";
const SHADOW_USER_ID = "10000000-0000-4000-8000-000000000007";
const ENFORCED_ACCOUNT_ID = "10000000-0000-4000-8000-000000000008";
const ENFORCED_USER_ID = "10000000-0000-4000-8000-000000000009";

function requireLocalTestDatabase(value: string) {
  const parsed = new URL(value);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/mogplex_test"
  ) {
    throw new Error(
      "SANDBOX_BILLING_TEST_DATABASE_URL must target local mogplex_test"
    );
  }
  return value;
}

describeWithPostgres("sandbox billing PostgreSQL concurrency", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: requireLocalTestDatabase(databaseUrl!),
      options: "-c statement_timeout=5000",
      max: 12,
    });
    await pool.query("drop schema public cascade; create schema public");
    await pool.query(`
      do $$ begin
        create role anon;
      exception when duplicate_object then null;
      end $$;
      do $$ begin
        create role authenticated;
      exception when duplicate_object then null;
      end $$;
      do $$ begin
        create role service_role;
      exception when duplicate_object then null;
      end $$;
    `);
    await pool.query(SANDBOX_BILLING_SANDBOX_STUB_SQL);
    await pool.query(BILLING_JOB_RUN_STUB_SQL);
    for (const migrationName of [
      "20260804200000_billing_foundation.sql",
      "20260804210000_atomic_billing_cancellation_expiry.sql",
      "20260805060000_billing_usage_debits.sql",
      "20260805070000_sandbox_billing_sessions.sql",
      "20260805090000_sandbox_billing_open_balance_and_close_barrier.sql",
      "20260805190000_harden_sandbox_billing_close_contract.sql",
      "20260816120000_capacity_billing_shadow_foundation.sql",
      "20260816140000_capacity_billing_shadow_state.sql",
      "20260816150000_capacity_billing_workflow_admission.sql",
    ]) {
      const migration = await readFile(
        path.resolve(
          import.meta.dirname,
          `../../neon/migrations/${migrationName}`
        ),
        "utf8"
      );
      await pool.query(migration);
    }
    await pool.query(
      `insert into billing_accounts (id, owner_type, owner_user_id)
       values ($1, 'user', $2), ($3, 'user', $4), ($5, 'user', $6)`,
      [
        ACCOUNT_ID,
        USER_ID,
        SHADOW_ACCOUNT_ID,
        SHADOW_USER_ID,
        ENFORCED_ACCOUNT_ID,
        ENFORCED_USER_ID,
      ]
    );
    await pool.query(
      `update billing_accounts
       set included_concurrency = 2, included_retained_bytes = 100
       where id = $1`,
      [SHADOW_ACCOUNT_ID]
    );
    await pool.query(
      `update billing_accounts
       set included_concurrency = 2,
           entitlement_enforcement_mode = 'enforced'
       where id = $1`,
      [ENFORCED_ACCOUNT_ID]
    );
    await pool.query(
      `select post_credit_ledger_entry(
         $1, 100, 'included', 'grant', 'grant:parallel-shadow',
         '2026-08', '{}'
       )`,
      [SHADOW_ACCOUNT_ID]
    );
    await pool.query(
      `insert into sandboxes
         (id, user_id, actor_user_id, sandbox_id, billing_source)
       values
         ($1, $4, $4, 'sbx_concurrent_1', 'platform'),
         ($2, $4, $4, 'sbx_concurrent_2', 'platform'),
         ($3, $4, $4, 'sbx_open_race', 'platform')`,
      [SANDBOX_ONE_ID, SANDBOX_TWO_ID, OPEN_RACE_SANDBOX_ID, USER_ID]
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("serializes concurrent session accruals through one account carry", async () => {
    await pool.query(
      `select post_credit_ledger_entry(
         $1, 100, 'purchased', 'topup', 'topup:concurrency', null, '{}'
       )`,
      [ACCOUNT_ID]
    );
    const opened = await Promise.all(
      [
        [SANDBOX_ONE_ID, "sbx_concurrent_1", "ses_concurrent_1"],
        [SANDBOX_TWO_ID, "sbx_concurrent_2", "ses_concurrent_2"],
      ].map(([recordId, sandboxId, sessionId]) =>
        pool.query<{ open_sandbox_billing_session: string }>(
          `select open_sandbox_billing_session(
             $1, $2, $3, $4, $5, null,
             '2026-08-05T05:00:00.000Z', 5000
           )`,
          [recordId, sandboxId, sessionId, ACCOUNT_ID, USER_ID]
        )
      )
    );

    const debits = await Promise.all(
      opened.map((result) =>
        pool.query<{ debited_cents: string }>(
          `select debited_cents from accrue_sandbox_billing_session(
             $1, '2026-08-05T05:05:00.000Z', false
           )`,
          [result.rows[0]!.open_sandbox_billing_session]
        )
      )
    );
    expect(
      debits
        .map((result) => Number(result.rows[0]!.debited_cents))
        .sort((a, b) => a - b)
    ).toEqual([2, 3]);

    const account = await pool.query<{
      sandbox_usage_remainder_units: string;
    }>(
      `select sandbox_usage_remainder_units
       from billing_accounts where id = $1`,
      [ACCOUNT_ID]
    );
    expect(Number(account.rows[0]!.sandbox_usage_remainder_units)).toBe(0);
  });

  it("allows exactly one concurrent active session per sandbox record", async () => {
    const attempts = await Promise.allSettled(
      ["ses_open_race_1", "ses_open_race_2"].map((sessionId) =>
        pool.query(
          `select open_sandbox_billing_session(
             $1, 'sbx_open_race', $2, $3, $4, null,
             '2026-08-05T06:00:00.000Z', 5000
           )`,
          [OPEN_RACE_SANDBOX_ID, sessionId, ACCOUNT_ID, USER_ID]
        )
      )
    );
    expect(
      attempts.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      attempts.filter((result) => result.status === "rejected")
    ).toHaveLength(1);

    const active = await pool.query<{ count: string }>(
      `select count(*) from sandbox_billing_sessions
       where sandbox_record_id = $1 and state in ('open', 'closing')`,
      [OPEN_RACE_SANDBOX_ID]
    );
    expect(Number(active.rows[0]!.count)).toBe(1);
  });

  it("deduplicates one provider cost across concurrent deliveries", async () => {
    const deliveries = await Promise.all(
      Array.from({ length: 12 }, () =>
        pool.query<{ posted: boolean }>(
          `select record_billing_provider_cost_event(
             'trigger.dev', 'run-concurrent-1', 'trigger', $1, null,
             80, 'USD', 80, 100, 'hosted_usage', 'capacity_v2',
             1, 'run', '2026-08-16T12:00:00.000Z', '{}', '{}'
           ) as posted`,
          [ACCOUNT_ID]
        )
      )
    );
    expect(
      deliveries.filter((delivery) => delivery.rows[0]?.posted)
    ).toHaveLength(1);

    const events = await pool.query<{ count: string }>(
      `select count(*) from billing_provider_cost_events
       where provider = 'trigger.dev'
         and provider_event_id = 'run-concurrent-1'`
    );
    expect(Number(events.rows[0]?.count)).toBe(1);
  });

  it("serializes shadow reservation, concurrency, and retained-data decisions", async () => {
    const reservations = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        pool.query<{ posted: boolean; would_admit: boolean }>(
          `select posted, would_admit
           from record_billing_shadow_reservation(
             $1, $2, $3, $4, null, 100000, '{}', 'capacity_v2',
             '2099-08-16T14:00:00.000Z', '{}'
           )`,
          [
            SHADOW_ACCOUNT_ID,
            `parallel-reservation-${index}`,
            `parallel-reserve:${index}`,
            `parallel-operation-${index}`,
          ]
        )
      )
    );
    expect(
      reservations.filter((result) => result.rows[0]?.would_admit)
    ).toHaveLength(10);
    expect(reservations.every((result) => result.rows[0]?.posted)).toBe(true);

    const leases = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        pool.query<{ posted: boolean; would_admit: boolean }>(
          `select posted, would_admit
           from record_billing_shadow_capacity_lease(
             $1, $2, $3, $4, '2026-08-16T12:00:00.000Z', '{}'
           )`,
          [
            SHADOW_ACCOUNT_ID,
            `parallel-lease-${index}`,
            `parallel-acquire:${index}`,
            `parallel-workflow-${index}`,
          ]
        )
      )
    );
    expect(leases.filter((result) => result.rows[0]?.would_admit)).toHaveLength(
      2
    );
    expect(leases.every((result) => result.rows[0]?.posted)).toBe(true);

    const retained = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        pool.query<{ posted: boolean; would_admit: boolean }>(
          `select posted, would_admit
           from record_billing_shadow_retained_data_event(
             $1, 'generated_artifact', $2, 10, $3, $4,
             '2026-08-16T12:00:00.000Z', '{}'
           )`,
          [
            SHADOW_ACCOUNT_ID,
            `parallel-artifact-${index}`,
            `parallel-retained:${index}`,
            `parallel-operation-${index}`,
          ]
        )
      )
    );
    expect(
      retained.filter((result) => result.rows[0]?.would_admit)
    ).toHaveLength(10);
    expect(retained.every((result) => result.rows[0]?.posted)).toBe(true);

    const totals = await pool.query<{
      open_reservations: string;
      active_leases: string;
      logical_bytes: string;
    }>(
      `select
         (select count(*) from billing_open_cost_reservations
          where account_id = $1) as open_reservations,
         (select count(*) from billing_active_workflow_capacity_leases
          where account_id = $1) as active_leases,
         (select logical_bytes from billing_retained_data_totals
          where account_id = $1) as logical_bytes`,
      [SHADOW_ACCOUNT_ID]
    );
    expect(totals.rows).toEqual([
      {
        open_reservations: "12",
        active_leases: "12",
        logical_bytes: "120",
      },
    ]);
  });

  it("deduplicates shadow facts across concurrent deliveries", async () => {
    const leaseDeliveries = await Promise.all(
      Array.from({ length: 12 }, () =>
        pool.query<{ posted: boolean }>(
          `select posted from record_billing_shadow_capacity_lease(
             $1, 'same-lease', 'same-acquire', 'same-root-workflow',
             '2026-08-16T12:00:00.000Z', '{}'
           )`,
          [SHADOW_ACCOUNT_ID]
        )
      )
    );
    expect(
      leaseDeliveries.filter((delivery) => delivery.rows[0]?.posted)
    ).toHaveLength(1);

    const reservationDeliveries = await Promise.all(
      Array.from({ length: 12 }, () =>
        pool.query<{ posted: boolean }>(
          `select posted from record_billing_shadow_reservation(
             $1, 'same-reservation', 'same-reserve', 'same-operation', null,
             1, '{}', 'capacity_v2', '2099-08-16T14:00:00.000Z', '{}'
           )`,
          [SHADOW_ACCOUNT_ID]
        )
      )
    );
    expect(
      reservationDeliveries.filter((delivery) => delivery.rows[0]?.posted)
    ).toHaveLength(1);

    const retainedDeliveries = await Promise.all(
      Array.from({ length: 12 }, () =>
        pool.query<{ posted: boolean }>(
          `select posted from record_billing_shadow_retained_data_event(
             $1, 'generated_artifact', 'same-artifact', 1,
             'same-retained', 'same-operation',
             '2026-08-16T12:00:00.000Z', '{}'
           )`,
          [SHADOW_ACCOUNT_ID]
        )
      )
    );
    expect(
      retainedDeliveries.filter((delivery) => delivery.rows[0]?.posted)
    ).toHaveLength(1);

    const facts = await pool.query<{
      leases: string;
      reservations: string;
      retained: string;
    }>(
      `select
         (select count(*) from billing_workflow_capacity_leases
          where lease_ref = 'same-lease') as leases,
         (select count(*) from billing_cost_reservations
          where reservation_ref = 'same-reservation') as reservations,
         (select count(*) from billing_retained_data_events
          where source_ref = 'same-retained') as retained`
    );
    expect(facts.rows).toEqual([
      { leases: "1", reservations: "1", retained: "1" },
    ]);
  });

  it("admits exactly the enforced Concurrency limit under parallel starts", async () => {
    const jobRunIds = Array.from(
      { length: 12 },
      (_, index) =>
        `10000000-0000-4000-9000-${String(index + 1).padStart(12, "0")}`
    );
    await pool.query(
      `insert into job_runs (id, status, started_at)
       select id, 'running', '2026-08-16T15:00:00.000Z'
       from unnest($1::uuid[]) as jobs(id)`,
      [jobRunIds]
    );

    const attempts = await Promise.all(
      jobRunIds.map((jobRunId, index) =>
        pool.query<{
          posted: boolean;
          admitted: boolean;
          would_admit: boolean;
        }>(
          `select posted, admitted, would_admit
           from admit_billing_workflow_capacity(
             $1, $2, $3, $4, $5,
             '2026-08-16T15:00:00.000Z', '{}'
           )`,
          [
            ENFORCED_ACCOUNT_ID,
            `parallel-admission-${index}`,
            `parallel-admission-source-${index}`,
            `parallel-admission-lease-${index}`,
            jobRunId,
          ]
        )
      )
    );
    const admittedJobRunIds = attempts.flatMap((attempt, index) =>
      attempt.rows[0]?.admitted ? [jobRunIds[index]!] : []
    );
    expect(admittedJobRunIds).toHaveLength(2);
    expect(
      attempts.filter((attempt) => attempt.rows[0]?.would_admit)
    ).toHaveLength(2);

    const recorded = await pool.query<{
      admissions: string;
      active_leases: string;
    }>(
      `select
         (select count(*) from billing_workflow_capacity_admission_events
          where account_id = $1) as admissions,
         (select count(*) from billing_active_workflow_capacity_leases
          where account_id = $1) as active_leases`,
      [ENFORCED_ACCOUNT_ID]
    );
    expect(recorded.rows).toEqual([{ admissions: "12", active_leases: "2" }]);

    await pool.query(
      `update job_runs
       set status = 'success', completed_at = '2026-08-16T15:10:00.000Z'
       where id = any($1::uuid[])`,
      [admittedJobRunIds]
    );
    const released = await pool.query<{
      active_leases: string;
      releases: string;
    }>(
      `select
         (select count(*) from billing_active_workflow_capacity_leases
          where account_id = $1) as active_leases,
         (select count(*)
          from billing_workflow_capacity_release_events release
          join billing_workflow_capacity_leases lease
            on lease.id = release.lease_id
          where lease.account_id = $1) as releases`,
      [ENFORCED_ACCOUNT_ID]
    );
    expect(released.rows).toEqual([{ active_leases: "0", releases: "2" }]);
  });

  it("deduplicates one enforced admission across parallel deliveries", async () => {
    const deliveries = await Promise.all(
      Array.from({ length: 12 }, () =>
        pool.query<{ posted: boolean; admitted: boolean }>(
          `select posted, admitted
           from admit_billing_workflow_capacity(
             $1, 'same-enforced-admission', 'same-enforced-source',
             'same-enforced-lease',
             '10000000-0000-4000-a000-000000000001',
             '2026-08-16T15:20:00.000Z', '{}'
           )`,
          [ENFORCED_ACCOUNT_ID]
        )
      )
    );
    expect(
      deliveries.filter((delivery) => delivery.rows[0]?.posted)
    ).toHaveLength(1);
    expect(deliveries.every((delivery) => delivery.rows[0]?.admitted)).toBe(
      true
    );

    const facts = await pool.query<{
      admissions: string;
      leases: string;
    }>(
      `select
         (select count(*) from billing_workflow_capacity_admission_events
          where admission_ref = 'same-enforced-admission') as admissions,
         (select count(*) from billing_workflow_capacity_leases
          where lease_ref = 'same-enforced-lease') as leases`
    );
    expect(facts.rows).toEqual([{ admissions: "1", leases: "1" }]);
  });
});
