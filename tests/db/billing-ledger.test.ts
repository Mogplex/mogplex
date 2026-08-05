import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ACCOUNT_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const CANCELLATION_ACCOUNT_ID = "00000000-0000-4000-8000-000000000003";
const CANCELLATION_USER_ID = "00000000-0000-4000-8000-000000000004";
const USAGE_ACCOUNT_ID = "00000000-0000-4000-8000-000000000005";
const USAGE_USER_ID = "00000000-0000-4000-8000-000000000006";
const SANDBOX_ACCOUNT_ID = "00000000-0000-4000-8000-000000000007";
const SANDBOX_USER_ID = "00000000-0000-4000-8000-000000000008";
const MINIMUM_ACCOUNT_ID = "00000000-0000-4000-8000-000000000009";
const MINIMUM_USER_ID = "00000000-0000-4000-8000-000000000010";
const NEGATIVE_ACCOUNT_ID = "00000000-0000-4000-8000-000000000011";
const NEGATIVE_USER_ID = "00000000-0000-4000-8000-000000000012";
const SANDBOX_RECORD_ID = "00000000-0000-4000-8000-000000000013";
const MINIMUM_SANDBOX_ONE_ID = "00000000-0000-4000-8000-000000000014";
const MINIMUM_SANDBOX_TWO_ID = "00000000-0000-4000-8000-000000000015";
const NEGATIVE_SANDBOX_ID = "00000000-0000-4000-8000-000000000016";
const LIFECYCLE_SANDBOX_ID = "00000000-0000-4000-8000-000000000017";
const MISMATCH_SANDBOX_ID = "00000000-0000-4000-8000-000000000018";
const RECOVERY_SANDBOX_ID = "00000000-0000-4000-8000-000000000019";
const RECOVERY_CURSOR_TARGET_ID = "00000000-0000-4000-8000-000000000020";

describe("billing ledger migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create table public.sandboxes (
        id uuid primary key,
        user_id uuid not null,
        actor_user_id uuid,
        product_team_id uuid,
        sandbox_id text not null,
        billing_source text,
        status text not null default 'stopped',
        last_active_at timestamptz not null default now()
      )
    `);
    for (const migrationName of [
      "20260804200000_billing_foundation.sql",
      "20260804210000_atomic_billing_cancellation_expiry.sql",
      "20260805060000_billing_usage_debits.sql",
      "20260805070000_sandbox_billing_sessions.sql",
      "20260805090000_sandbox_billing_open_balance_and_close_barrier.sql",
    ]) {
      const migration = await readFile(
        path.resolve(
          import.meta.dirname,
          `../../neon/migrations/${migrationName}`
        ),
        "utf8"
      );
      await db.exec(migration);
    }
    await db.query(
      `insert into billing_accounts (id, owner_type, owner_user_id)
       values ($1, 'user', $2), ($3, 'user', $4), ($5, 'user', $6),
              ($7, 'user', $8), ($9, 'user', $10), ($11, 'user', $12)`,
      [
        ACCOUNT_ID,
        USER_ID,
        CANCELLATION_ACCOUNT_ID,
        CANCELLATION_USER_ID,
        USAGE_ACCOUNT_ID,
        USAGE_USER_ID,
        SANDBOX_ACCOUNT_ID,
        SANDBOX_USER_ID,
        MINIMUM_ACCOUNT_ID,
        MINIMUM_USER_ID,
        NEGATIVE_ACCOUNT_ID,
        NEGATIVE_USER_ID,
      ]
    );
    await db.query(
      `insert into sandboxes
         (id, user_id, actor_user_id, product_team_id, sandbox_id, billing_source)
       values
         ($1, $2, $2, null, 'sbx_provider_1', 'platform'),
         ($3, $4, $4, null, 'sbx_min_1', 'platform'),
         ($5, $4, $4, null, 'sbx_min_2', 'platform'),
         ($6, $7, $7, null, 'sbx_negative', 'platform'),
         ($8, $2, $2, null, 'sbx_lifecycle', 'platform'),
         ($9, $2, $2, null, 'sbx_mismatch', 'user_vercel_project')`,
      [
        SANDBOX_RECORD_ID,
        SANDBOX_USER_ID,
        MINIMUM_SANDBOX_ONE_ID,
        MINIMUM_USER_ID,
        MINIMUM_SANDBOX_TWO_ID,
        NEGATIVE_SANDBOX_ID,
        NEGATIVE_USER_ID,
        LIFECYCLE_SANDBOX_ID,
        MISMATCH_SANDBOX_ID,
      ]
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it("atomically grants the new period and expires prior included credit", async () => {
    await db.query(
      `select post_credit_ledger_entry(
         $1, 350, 'included', 'grant', 'grant:prior', '2026-07', '{}'
       )`,
      [ACCOUNT_ID]
    );

    const result = await db.query<{
      posted: boolean;
      expired_cents: number;
    }>(
      `select * from post_billing_period_grant(
         $1, 2000, 'grant:acct:2026-08:sub_1',
         'grantexp:acct:2026-08:sub_1', '2026-08', '{"invoice":"in_1"}'
       )`,
      [ACCOUNT_ID]
    );

    expect(result.rows).toEqual([{ posted: true, expired_cents: 350 }]);
    const balance = await db.query<{ included_cents: number }>(
      "select included_cents from billing_balance($1)",
      [ACCOUNT_ID]
    );
    expect(balance.rows[0]?.included_cents).toBe(2000);
  });

  it("deduplicates redelivery but grants a new same-month subscription", async () => {
    const duplicate = await db.query<{ posted: boolean }>(
      `select posted from post_billing_period_grant(
         $1, 2000, 'grant:acct:2026-08:sub_1',
         'grantexp:acct:2026-08:sub_1', '2026-08', '{}'
       )`,
      [ACCOUNT_ID]
    );
    expect(duplicate.rows[0]?.posted).toBe(false);

    await db.query(
      `select post_credit_ledger_entry(
         $1, -2000, 'included', 'grant_expiry',
         'grantexp:acct:cancel:sub_1', null, '{}'
       )`,
      [ACCOUNT_ID]
    );
    const resubscribe = await db.query<{
      posted: boolean;
      expired_cents: number;
    }>(
      `select * from post_billing_period_grant(
         $1, 2000, 'grant:acct:2026-08:sub_2',
         'grantexp:acct:2026-08:sub_2', '2026-08', '{}'
       )`,
      [ACCOUNT_ID]
    );
    expect(resubscribe.rows).toEqual([{ posted: true, expired_cents: 0 }]);

    const balance = await db.query<{ included_cents: number }>(
      "select included_cents from billing_balance($1)",
      [ACCOUNT_ID]
    );
    expect(balance.rows[0]?.included_cents).toBe(2000);
  });

  it("expires cancellation credit atomically and deduplicates redelivery", async () => {
    await db.query(
      `select post_credit_ledger_entry(
         $1, 2000, 'included', 'grant', 'grant:cancel-test', '2026-08', '{}'
       )`,
      [CANCELLATION_ACCOUNT_ID]
    );
    const expiry = await db.query<{ expire_billing_included_credit: number }>(
      "select expire_billing_included_credit($1, 'grantexp:acct:cancel:sub_2')",
      [CANCELLATION_ACCOUNT_ID]
    );
    expect(expiry.rows[0]?.expire_billing_included_credit).toBe(2000);

    const duplicate = await db.query<{
      expire_billing_included_credit: number;
    }>(
      "select expire_billing_included_credit($1, 'grantexp:acct:cancel:sub_2')",
      [CANCELLATION_ACCOUNT_ID]
    );
    expect(duplicate.rows[0]?.expire_billing_included_credit).toBe(0);

    const account = await db.query<{
      subscription_checkout_generation: number;
    }>(
      "select subscription_checkout_generation from billing_accounts where id = $1",
      [CANCELLATION_ACCOUNT_ID]
    );
    expect(account.rows[0]?.subscription_checkout_generation).toBe(1);

    const balance = await db.query<{ included_cents: number }>(
      "select included_cents from billing_balance($1)",
      [CANCELLATION_ACCOUNT_ID]
    );
    expect(balance.rows[0]?.included_cents).toBe(0);
  });

  it("attributes delayed usage to its explicit billing period", async () => {
    await db.query(
      `select post_credit_ledger_entry(
         $1, -125, 'purchased', 'usage_tokens',
         'usage:delayed', '1999-12', '{}'
       )`,
      [ACCOUNT_ID]
    );

    const spend = await db.query<{ billing_monthly_spend: number }>(
      "select billing_monthly_spend($1, '1999-12')",
      [ACCOUNT_ID]
    );
    expect(spend.rows[0]?.billing_monthly_spend).toBe(125);
  });

  it("burns included credit before purchased credit and deduplicates usage", async () => {
    await db.query(
      `select post_credit_ledger_entry(
         $1, 75, 'included', 'grant', 'grant:usage', '2026-08', '{}'
       )`,
      [USAGE_ACCOUNT_ID]
    );
    await db.query(
      `select post_credit_ledger_entry(
         $1, 100, 'purchased', 'topup', 'topup:usage', null, '{}'
       )`,
      [USAGE_ACCOUNT_ID]
    );

    const debit = await db.query<{
      posted: boolean;
      debited_cents: number;
      included_debited_cents: number;
      purchased_debited_cents: number;
    }>(
      `select * from post_billing_usage_debit(
         $1, 125, 'usage_tokens', 'tok:call-1', '2026-08',
         '{"ai_call_id":"call-1"}'
       )`,
      [USAGE_ACCOUNT_ID]
    );
    expect(debit.rows).toEqual([
      {
        posted: true,
        debited_cents: 125,
        included_debited_cents: 75,
        purchased_debited_cents: 50,
      },
    ]);

    const duplicate = await db.query<{
      posted: boolean;
      debited_cents: number;
    }>(
      `select posted, debited_cents from post_billing_usage_debit(
         $1, 125, 'usage_tokens', 'tok:call-1', '2026-08', '{}'
       )`,
      [USAGE_ACCOUNT_ID]
    );
    expect(duplicate.rows).toEqual([{ posted: false, debited_cents: 0 }]);

    const balance = await db.query<{
      included_cents: number;
      purchased_cents: number;
      total_cents: number;
    }>("select * from billing_balance($1)", [USAGE_ACCOUNT_ID]);
    expect(balance.rows).toEqual([
      { included_cents: 0, purchased_cents: 50, total_cents: 50 },
    ]);
  });

  it("allows an in-flight usage debit to finish into a negative balance", async () => {
    const debit = await db.query<{
      posted: boolean;
      debited_cents: number;
      included_debited_cents: number;
      purchased_debited_cents: number;
    }>(
      `select * from post_billing_usage_debit(
         $1, 80, 'usage_tokens', 'tok:call-2', '2026-08', '{}'
       )`,
      [USAGE_ACCOUNT_ID]
    );
    expect(debit.rows).toEqual([
      {
        posted: true,
        debited_cents: 80,
        included_debited_cents: 0,
        purchased_debited_cents: 80,
      },
    ]);

    const balance = await db.query<{ total_cents: number }>(
      "select total_cents from billing_balance($1)",
      [USAGE_ACCOUNT_ID]
    );
    expect(balance.rows[0]?.total_cents).toBe(-30);
  });

  it("carries half-cent sandbox usage exactly across five-minute accruals", async () => {
    await db.query(
      `select post_credit_ledger_entry(
         $1, 100, 'purchased', 'topup', 'topup:sandbox', null, '{}'
       )`,
      [SANDBOX_ACCOUNT_ID]
    );
    const opened = await db.query<{ open_sandbox_billing_session: string }>(
      `select open_sandbox_billing_session(
         $1, 'sbx_provider_1', 'ses_provider_1', $2, $3, null,
         '2026-08-05T00:00:00.000Z', 5000
       )`,
      [SANDBOX_RECORD_ID, SANDBOX_ACCOUNT_ID, SANDBOX_USER_ID]
    );
    const sessionId = opened.rows[0]!.open_sandbox_billing_session;
    expect(sessionId).toBeTruthy();

    const duplicateOpen = await db.query<{
      open_sandbox_billing_session: string;
    }>(
      `select open_sandbox_billing_session(
         $1, 'sbx_provider_1', 'ses_provider_1', $2, $3, null,
         '2026-08-05T00:00:00.000Z', 5000
       )`,
      [SANDBOX_RECORD_ID, SANDBOX_ACCOUNT_ID, SANDBOX_USER_ID]
    );
    expect(duplicateOpen.rows[0]?.open_sandbox_billing_session).toBe(sessionId);
    await expect(
      db.query(
        `select open_sandbox_billing_session(
           $1, 'sbx_provider_1', 'ses_provider_1', $2, $3, null,
           '2026-08-05T00:00:01.000Z', 5000
         )`,
        [SANDBOX_RECORD_ID, SANDBOX_ACCOUNT_ID, SANDBOX_USER_ID]
      )
    ).rejects.toThrow(/billing identity mismatch/);
    await expect(
      db.query(
        `select open_sandbox_billing_session(
           $1, 'sbx_provider_1', 'ses_provider_other', $2, $3, null,
           '2026-08-05T00:00:00.000Z', 5000
         )`,
        [SANDBOX_RECORD_ID, SANDBOX_ACCOUNT_ID, SANDBOX_USER_ID]
      )
    ).rejects.toThrow(/already has an active billing session/);

    const first = await db.query<{
      accrued: boolean;
      debited_cents: number;
    }>(
      `select accrued, debited_cents
       from accrue_sandbox_billing_session(
         $1, '2026-08-05T00:05:00.000Z', false
       )`,
      [sessionId]
    );
    expect(first.rows).toEqual([{ accrued: true, debited_cents: 2 }]);

    const duplicateAccrual = await db.query<{
      accrued: boolean;
      debited_cents: number;
    }>(
      `select accrued, debited_cents
       from accrue_sandbox_billing_session(
         $1, '2026-08-05T00:05:00.000Z', false
       )`,
      [sessionId]
    );
    expect(duplicateAccrual.rows).toEqual([
      { accrued: false, debited_cents: 0 },
    ]);

    const second = await db.query<{
      accrued: boolean;
      debited_cents: number;
    }>(
      `select accrued, debited_cents
       from accrue_sandbox_billing_session(
         $1, '2026-08-05T00:10:00.000Z', false
       )`,
      [sessionId]
    );
    expect(second.rows).toEqual([{ accrued: true, debited_cents: 3 }]);

    const account = await db.query<{
      sandbox_usage_remainder_units: number;
    }>(
      `select sandbox_usage_remainder_units
       from billing_accounts where id = $1`,
      [SANDBOX_ACCOUNT_ID]
    );
    expect(account.rows[0]?.sandbox_usage_remainder_units).toBe(0);

    const session = await db.query<{
      usage_units: number;
      billed_cents: number;
      accrual_seq: number;
    }>(
      `select usage_units, billed_cents, accrual_seq
       from sandbox_billing_sessions where id = $1`,
      [sessionId]
    );
    expect(session.rows).toEqual([
      { usage_units: 3_000_000_000, billed_cents: 5, accrual_seq: 2 },
    ]);

    const balance = await db.query<{ total_cents: number }>(
      "select total_cents from billing_balance($1)",
      [SANDBOX_ACCOUNT_ID]
    );
    expect(balance.rows[0]?.total_cents).toBe(95);
  });

  it("rejects initial sandbox billing identity mismatches", async () => {
    const open = (overrides: {
      providerId?: string;
      accountId?: string;
      actorUserId?: string;
      productTeamId?: string | null;
    }) =>
      db.query(
        `select open_sandbox_billing_session(
           $1, $2, 'ses_mismatch', $3, $4, $5,
           '2026-08-05T00:00:00.000Z', 5000
         )`,
        [
          MISMATCH_SANDBOX_ID,
          overrides.providerId ?? "sbx_mismatch",
          overrides.accountId ?? SANDBOX_ACCOUNT_ID,
          overrides.actorUserId ?? SANDBOX_USER_ID,
          overrides.productTeamId ?? null,
        ]
      );

    await expect(open({})).rejects.toThrow(/not platform billed/);
    await db.query(
      "update sandboxes set billing_source = 'platform' where id = $1",
      [MISMATCH_SANDBOX_ID]
    );
    await expect(open({ providerId: "sbx_wrong" })).rejects.toThrow(
      /provider id mismatch/
    );
    await expect(open({ actorUserId: MINIMUM_USER_ID })).rejects.toThrow(
      /actor mismatch/
    );
    await expect(open({ productTeamId: MINIMUM_USER_ID })).rejects.toThrow(
      /product team mismatch/
    );
    await expect(open({ accountId: MINIMUM_ACCOUNT_ID })).rejects.toThrow(
      /personal scope mismatch/
    );
  });

  it("combines one-minute minimum carry across short provider sessions", async () => {
    await db.query(
      `select post_credit_ledger_entry(
         $1, 100, 'purchased', 'topup', 'topup:sandbox-minimum', null, '{}'
       )`,
      [MINIMUM_ACCOUNT_ID]
    );
    const firstOpen = await db.query<{
      open_sandbox_billing_session: string;
    }>(
      `select open_sandbox_billing_session(
         $1, 'sbx_min_1', 'ses_min_1', $2, $3, null,
         '2026-08-05T01:00:00.000Z', 5000
       )`,
      [MINIMUM_SANDBOX_ONE_ID, MINIMUM_ACCOUNT_ID, MINIMUM_USER_ID]
    );
    const firstSessionId = firstOpen.rows[0]?.open_sandbox_billing_session;
    const firstClose = await db.query<{
      request_sandbox_billing_session_close: number;
    }>("select request_sandbox_billing_session_close($1)", [firstSessionId]);
    const firstFinal = await db.query<{ debited_cents: number }>(
      `select debited_cents from accrue_sandbox_billing_session(
         $1, '2026-08-05T01:00:10.000Z', true, $2
       )`,
      [
        firstSessionId,
        firstClose.rows[0]?.request_sandbox_billing_session_close,
      ]
    );
    expect(firstFinal.rows[0]?.debited_cents).toBe(0);

    const secondOpen = await db.query<{
      open_sandbox_billing_session: string;
    }>(
      `select open_sandbox_billing_session(
         $1, 'sbx_min_2', 'ses_min_2', $2, $3, null,
         '2026-08-05T02:00:00.000Z', 5000
       )`,
      [MINIMUM_SANDBOX_TWO_ID, MINIMUM_ACCOUNT_ID, MINIMUM_USER_ID]
    );
    const secondSessionId = secondOpen.rows[0]?.open_sandbox_billing_session;
    const secondClose = await db.query<{
      request_sandbox_billing_session_close: number;
    }>("select request_sandbox_billing_session_close($1)", [secondSessionId]);
    const secondFinal = await db.query<{ debited_cents: number }>(
      `select debited_cents from accrue_sandbox_billing_session(
         $1, '2026-08-05T02:00:10.000Z', true, $2
       )`,
      [
        secondSessionId,
        secondClose.rows[0]?.request_sandbox_billing_session_close,
      ]
    );
    expect(secondFinal.rows[0]?.debited_cents).toBe(1);

    const sessions = await db.query<{
      state: string;
      billed_cents: number;
      duration_ms: number;
    }>(
      `select state, billed_cents,
              (extract(epoch from (ended_at - started_at)) * 1000)::bigint as duration_ms
       from sandbox_billing_sessions
       where account_id = $1 order by started_at`,
      [MINIMUM_ACCOUNT_ID]
    );
    expect(sessions.rows).toEqual([
      { state: "closed", billed_cents: 0, duration_ms: 60_000 },
      { state: "closed", billed_cents: 1, duration_ms: 60_000 },
    ]);
  });

  it("uses included credit first and permits the final sandbox debit drift", async () => {
    await db.query(
      `select post_credit_ledger_entry(
         $1, 1, 'included', 'grant', 'grant:sandbox-negative', '2026-08', '{}'
       )`,
      [NEGATIVE_ACCOUNT_ID]
    );
    const opened = await db.query<{ open_sandbox_billing_session: string }>(
      `select open_sandbox_billing_session(
         $1, 'sbx_negative', 'ses_negative', $2, $3, null,
         '2026-08-05T03:00:00.000Z', 5000
       )`,
      [NEGATIVE_SANDBOX_ID, NEGATIVE_ACCOUNT_ID, NEGATIVE_USER_ID]
    );
    const sessionId = opened.rows[0]?.open_sandbox_billing_session;
    const close = await db.query<{
      request_sandbox_billing_session_close: number;
    }>("select request_sandbox_billing_session_close($1)", [sessionId]);
    await db.query(
      `select * from accrue_sandbox_billing_session(
         $1, '2026-08-05T03:05:00.000Z', true, $2
       )`,
      [sessionId, close.rows[0]?.request_sandbox_billing_session_close]
    );

    const balance = await db.query<{
      included_cents: number;
      purchased_cents: number;
      total_cents: number;
    }>("select * from billing_balance($1)", [NEGATIVE_ACCOUNT_ID]);
    expect(balance.rows).toEqual([
      { included_cents: 0, purchased_cents: -1, total_cents: -1 },
    ]);
  });

  it("prevents sandbox deletion while an active billing session exists", async () => {
    await expect(
      db.query("delete from sandboxes where id = $1", [SANDBOX_RECORD_ID])
    ).rejects.toThrow();

    const session = await db.query<{ id: string }>(
      `select id from sandbox_billing_sessions
       where sandbox_record_id = $1 and state = 'open'`,
      [SANDBOX_RECORD_ID]
    );
    const close = await db.query<{
      request_sandbox_billing_session_close: number;
    }>("select request_sandbox_billing_session_close($1)", [
      session.rows[0]?.id,
    ]);
    await db.query(
      `select * from accrue_sandbox_billing_session(
         $1, '2026-08-05T00:10:00.000Z', true, $2
       )`,
      [
        session.rows[0]?.id,
        close.rows[0]?.request_sandbox_billing_session_close,
      ]
    );
    await db.query("delete from sandboxes where id = $1", [SANDBOX_RECORD_ID]);

    const retained = await db.query<{ state: string }>(
      "select state from sandbox_billing_sessions where id = $1",
      [session.rows[0]?.id]
    );
    expect(retained.rows).toEqual([{ state: "closed" }]);
  });

  it("supports two-phase close recovery and an unmetered finalization", async () => {
    const opened = await db.query<{ open_sandbox_billing_session: string }>(
      `select open_sandbox_billing_session(
         $1, 'sbx_lifecycle', 'ses_lifecycle', $2, $3, null,
         '2026-08-05T04:00:00.000Z', 5000
       )`,
      [LIFECYCLE_SANDBOX_ID, SANDBOX_ACCOUNT_ID, SANDBOX_USER_ID]
    );
    const sessionId = opened.rows[0]?.open_sandbox_billing_session;

    const requested = await db.query<{
      request_sandbox_billing_session_close: number;
    }>(
      `select request_sandbox_billing_session_close(
         $1, '2026-08-05T04:00:05.000Z'
       )`,
      [sessionId]
    );
    const firstGeneration =
      requested.rows[0]!.request_sandbox_billing_session_close;
    expect(firstGeneration).toBe(1);
    const duplicateRequest = await db.query<{
      request_sandbox_billing_session_close: number;
    }>("select request_sandbox_billing_session_close($1)", [sessionId]);
    expect(
      duplicateRequest.rows[0]!.request_sandbox_billing_session_close
    ).toBe(firstGeneration);

    const reopened = await db.query<{
      reopen_sandbox_billing_session: boolean;
    }>("select reopen_sandbox_billing_session($1, $2)", [
      sessionId,
      firstGeneration,
    ]);
    expect(reopened.rows[0]!.reopen_sandbox_billing_session).toBe(true);

    const staleMetered = await db.query<{
      accrued: boolean;
      session_state: string;
    }>(
      `select accrued, session_state from accrue_sandbox_billing_session(
         $1, '2026-08-05T04:00:10.000Z', true, $2
       )`,
      [sessionId, firstGeneration]
    );
    expect(staleMetered.rows).toEqual([
      { accrued: false, session_state: "open" },
    ]);
    const staleUnmetered = await db.query<{
      finalize_sandbox_billing_session_unmetered: boolean;
    }>(
      `select finalize_sandbox_billing_session_unmetered(
         $1, '2026-08-05T04:00:10.000Z', $2
       )`,
      [sessionId, firstGeneration]
    );
    expect(
      staleUnmetered.rows[0]!.finalize_sandbox_billing_session_unmetered
    ).toBe(false);

    const secondRequest = await db.query<{
      request_sandbox_billing_session_close: number;
    }>(
      `select request_sandbox_billing_session_close(
         $1, '2026-08-05T04:00:05.000Z'
       )`,
      [sessionId]
    );
    const secondGeneration =
      secondRequest.rows[0]!.request_sandbox_billing_session_close;
    expect(secondGeneration).toBe(2);
    const staleSecondAttempt = await db.query<{
      accrued: boolean;
      session_state: string;
    }>(
      `select accrued, session_state from accrue_sandbox_billing_session(
         $1, '2026-08-05T04:00:10.000Z', true, $2
       )`,
      [sessionId, firstGeneration]
    );
    expect(staleSecondAttempt.rows).toEqual([
      { accrued: false, session_state: "closing" },
    ]);
    const finalized = await db.query<{
      finalize_sandbox_billing_session_unmetered: boolean;
    }>(
      `select finalize_sandbox_billing_session_unmetered(
         $1, '2026-08-05T04:00:10.000Z', $2
       )`,
      [sessionId, secondGeneration]
    );
    expect(finalized.rows[0]!.finalize_sandbox_billing_session_unmetered).toBe(
      true
    );

    const session = await db.query<{
      state: string;
      close_requested_at: Date | null;
      ended_at: Date;
      usage_units: number;
    }>(
      `select state, close_requested_at, ended_at, usage_units
       from sandbox_billing_sessions where id = $1`,
      [sessionId]
    );
    expect(session.rows[0]!.state).toBe("closed_unmetered");
    expect(session.rows[0]!.close_requested_at!.toISOString()).toBe(
      "2026-08-05T04:00:05.000Z"
    );
    expect(session.rows[0]!.ended_at.toISOString()).toBe(
      "2026-08-05T04:00:10.000Z"
    );
    expect(session.rows[0]!.usage_units).toBe(0);

    await expect(
      db.query(
        `select open_sandbox_billing_session(
           $1, 'sbx_lifecycle', 'ses_lifecycle', $2, $3, null,
           '2026-08-05T04:00:00.000Z', 5000
         )`,
        [LIFECYCLE_SANDBOX_ID, SANDBOX_ACCOUNT_ID, SANDBOX_USER_ID]
      )
    ).rejects.toThrow(/billing row is already closed/);
  });

  it("requires positive balance when a sandbox billing session opens", async () => {
    await expect(
      db.query(
        `select open_sandbox_billing_session(
           $1, 'sbx_negative', 'ses_zero_balance', $2, $3, null,
           '2026-08-05T07:00:00.000Z', 5000
         )`,
        [NEGATIVE_SANDBOX_ID, NEGATIVE_ACCOUNT_ID, NEGATIVE_USER_ID]
      )
    ).rejects.toThrow(/positive billing balance required/);
  });

  it("recovery candidates exclude more than one full batch of metered rows", async () => {
    await db.query(
      `insert into sandboxes (
         id, user_id, actor_user_id, product_team_id, sandbox_id,
         billing_source, status, last_active_at
       )
       select gen_random_uuid(), $1, $1, null,
              'batch_metered_' || candidate::text, 'platform', 'running', now()
       from generate_series(1, 251) candidate`,
      [SANDBOX_USER_ID]
    );
    await db.query(
      `insert into sandbox_billing_sessions (
         sandbox_record_id, vercel_sandbox_id, vercel_session_id, account_id,
         actor_user_id, started_at, metered_through_at,
         rate_micro_usd_per_minute
       )
       select id, sandbox_id, 'session_' || sandbox_id, $1, $2,
              now(), now(), 5000
       from sandboxes
       where sandbox_id like 'batch_metered_%'`,
      [SANDBOX_ACCOUNT_ID, SANDBOX_USER_ID]
    );
    await db.query(
      `insert into sandboxes (
         id, user_id, actor_user_id, product_team_id, sandbox_id,
         billing_source, status, last_active_at
       ) values (
         $1, $2, $2, null, 'batch_unmetered', 'platform', 'running',
         '2026-08-05T00:00:00.000Z'
       )`,
      [RECOVERY_SANDBOX_ID, SANDBOX_USER_ID]
    );

    const candidates = await db.query<{ id: string; sandbox_id: string }>(
      "select id, sandbox_id from list_unmetered_platform_sandboxes(250)"
    );
    expect(candidates.rows).toEqual([
      { id: RECOVERY_SANDBOX_ID, sandbox_id: "batch_unmetered" },
    ]);
  });

  it("recovery cursor advances past a full batch of skipped candidates", async () => {
    await db.query(
      `insert into sandboxes (
         id, user_id, actor_user_id, product_team_id, sandbox_id,
         billing_source, status, last_active_at
       )
       select gen_random_uuid(), $1, $1, null,
              'cursor_skipped_' || candidate::text, 'platform', 'paused',
              '2026-08-05T12:00:00.000Z'
       from generate_series(1, 251) candidate`,
      [SANDBOX_USER_ID]
    );
    await db.query(
      `insert into sandboxes (
         id, user_id, actor_user_id, product_team_id, sandbox_id,
         billing_source, status, last_active_at
       ) values (
         $1, $2, $2, null, 'cursor_older_live', 'platform', 'running',
         '2026-08-05T00:00:00.000Z'
       )`,
      [RECOVERY_CURSOR_TARGET_ID, SANDBOX_USER_ID]
    );

    const first = await db.query<{ id: string }>(
      "select id from list_unmetered_platform_sandboxes(250)"
    );
    expect(first.rows.some((row) => row.id === RECOVERY_CURSOR_TARGET_ID)).toBe(
      false
    );

    const second = await db.query<{ id: string }>(
      "select id from list_unmetered_platform_sandboxes(250)"
    );
    expect(
      second.rows.some((row) => row.id === RECOVERY_CURSOR_TARGET_ID)
    ).toBe(true);
  });

  it("makes request-close a barrier against non-final accrual", async () => {
    const opened = await db.query<{ open_sandbox_billing_session: string }>(
      `select open_sandbox_billing_session(
         $1, 'sbx_min_1', 'ses_close_barrier', $2, $3, null,
         '2026-08-05T08:00:00.000Z', 5000
       )`,
      [MINIMUM_SANDBOX_ONE_ID, MINIMUM_ACCOUNT_ID, MINIMUM_USER_ID]
    );
    const sessionId = opened.rows[0]!.open_sandbox_billing_session;
    await db.query("select request_sandbox_billing_session_close($1)", [
      sessionId,
    ]);
    const accrued = await db.query<{
      accrued: boolean;
      debited_cents: number;
      session_state: string;
    }>(
      `select accrued, debited_cents, session_state
       from accrue_sandbox_billing_session(
         $1, '2026-08-05T08:05:00.000Z', false
       )`,
      [sessionId]
    );
    expect(accrued.rows).toEqual([
      { accrued: false, debited_cents: 0, session_state: "closing" },
    ]);
  });
});
