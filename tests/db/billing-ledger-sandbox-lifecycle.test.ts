import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LIFECYCLE_SANDBOX_ID,
  MINIMUM_ACCOUNT_ID,
  MINIMUM_SANDBOX_ONE_ID,
  MINIMUM_USER_ID,
  NEGATIVE_ACCOUNT_ID,
  NEGATIVE_SANDBOX_ID,
  NEGATIVE_USER_ID,
  RECOVERY_CURSOR_TARGET_ID,
  RECOVERY_SANDBOX_ID,
  SANDBOX_ACCOUNT_ID,
  SANDBOX_USER_ID,
  createBillingTestDb,
  seedBillingAccounts,
  seedSandboxes,
} from "./helpers/billing-ledger-fixtures";

describe("billing ledger sandbox lifecycle", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createBillingTestDb();
    await seedBillingAccounts(db);
    await seedSandboxes(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("supports two-phase close recovery and an unmetered finalization", async () => {
    await db.query(
      `select post_credit_ledger_entry(
         $1, 100, 'purchased', 'topup', 'topup:lifecycle', null, '{}'
       )`,
      [SANDBOX_ACCOUNT_ID]
    );
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
    ).rejects.toMatchObject({
      code: "MP001",
      message: expect.stringContaining("positive billing balance required"),
    });
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
    await db.query(
      `select post_credit_ledger_entry(
         $1, 100, 'purchased', 'topup', 'topup:close-barrier', null, '{}'
       )`,
      [MINIMUM_ACCOUNT_ID]
    );
    const opened = await db.query<{ open_sandbox_billing_session: string }>(
      `select open_sandbox_billing_session(
         $1, 'sbx_min_1', 'ses_close_barrier', $2, $3, null,
         '2026-08-05T08:00:00.000Z', 5000
       )`,
      [MINIMUM_SANDBOX_ONE_ID, MINIMUM_ACCOUNT_ID, MINIMUM_USER_ID]
    );
    const sessionId = opened.rows[0]!.open_sandbox_billing_session;
    const requested = await db.query<{
      request_sandbox_billing_session_close: number;
    }>("select request_sandbox_billing_session_close($1)", [sessionId]);
    const generation = requested.rows[0]!.request_sandbox_billing_session_close;
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

    await db.query(
      `select * from accrue_sandbox_billing_session(
         $1, '2026-08-05T08:05:00.000Z', true, $2
       )`,
      [sessionId, generation]
    );
    const terminalRetry = await db.query<{
      request_sandbox_billing_session_close: number;
    }>("select request_sandbox_billing_session_close($1)", [sessionId]);
    expect(terminalRetry.rows[0]!.request_sandbox_billing_session_close).toBe(
      generation
    );

    await expect(
      db.query("select request_sandbox_billing_session_close($1)", [
        "00000000-0000-4000-8000-ffffffffffff",
      ])
    ).rejects.toThrow(/not found/);
    await expect(
      db.query(
        `select open_sandbox_billing_session(
           $1, 'sbx_min_1', 'ses_close_barrier', $2, $3, null,
           '2026-08-05T08:00:00.000Z', 5000
         )`,
        [MINIMUM_SANDBOX_ONE_ID, MINIMUM_ACCOUNT_ID, MINIMUM_USER_ID]
      )
    ).rejects.toThrow(/already closed/);
  });
});
