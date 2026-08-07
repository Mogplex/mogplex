import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ACCOUNT_ID,
  USAGE_ACCOUNT_ID,
  createBillingTestDb,
  seedBillingAccounts,
  seedSandboxes,
} from "./helpers/billing-ledger-fixtures";

describe("billing ledger usage debits", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createBillingTestDb();
    await seedBillingAccounts(db);
    await seedSandboxes(db);
  });

  afterAll(async () => {
    await db.close();
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
