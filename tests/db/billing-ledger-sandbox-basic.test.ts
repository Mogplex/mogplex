import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MINIMUM_ACCOUNT_ID,
  MINIMUM_SANDBOX_ONE_ID,
  MINIMUM_SANDBOX_TWO_ID,
  MINIMUM_USER_ID,
  MISMATCH_SANDBOX_ID,
  NEGATIVE_ACCOUNT_ID,
  NEGATIVE_SANDBOX_ID,
  NEGATIVE_USER_ID,
  SANDBOX_ACCOUNT_ID,
  SANDBOX_RECORD_ID,
  SANDBOX_USER_ID,
  createBillingTestDb,
  seedBillingAccounts,
  seedSandboxes,
} from "./helpers/billing-ledger-fixtures";

describe("billing ledger sandbox basic", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createBillingTestDb();
    await seedBillingAccounts(db);
    await seedSandboxes(db);
  });

  afterAll(async () => {
    await db.close();
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
});
