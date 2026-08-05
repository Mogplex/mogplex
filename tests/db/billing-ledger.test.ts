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

describe("billing ledger migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    for (const migrationName of [
      "20260804200000_billing_foundation.sql",
      "20260804210000_atomic_billing_cancellation_expiry.sql",
      "20260805060000_billing_usage_debits.sql",
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
       values ($1, 'user', $2), ($3, 'user', $4), ($5, 'user', $6)`,
      [
        ACCOUNT_ID,
        USER_ID,
        CANCELLATION_ACCOUNT_ID,
        CANCELLATION_USER_ID,
        USAGE_ACCOUNT_ID,
        USAGE_USER_ID,
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
});
