import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.SANDBOX_BILLING_TEST_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe : describe.skip;

const ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "10000000-0000-4000-8000-000000000002";
const SANDBOX_ONE_ID = "10000000-0000-4000-8000-000000000003";
const SANDBOX_TWO_ID = "10000000-0000-4000-8000-000000000004";
const OPEN_RACE_SANDBOX_ID = "10000000-0000-4000-8000-000000000005";

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
      max: 4,
    });
    await pool.query("drop schema public cascade; create schema public");
    await pool.query(`
      create table public.sandboxes (
        id uuid primary key,
        user_id uuid not null,
        actor_user_id uuid,
        product_team_id uuid,
        sandbox_id text not null,
        billing_source text
      )
    `);
    for (const migrationName of [
      "20260804200000_billing_foundation.sql",
      "20260804210000_atomic_billing_cancellation_expiry.sql",
      "20260805060000_billing_usage_debits.sql",
      "20260805070000_sandbox_billing_sessions.sql",
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
       values ($1, 'user', $2)`,
      [ACCOUNT_ID, USER_ID]
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
});
