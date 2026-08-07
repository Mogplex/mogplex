import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ACCOUNT_ID,
  CANCELLATION_ACCOUNT_ID,
  createBillingTestDb,
  seedBillingAccounts,
  seedSandboxes,
} from "./helpers/billing-ledger-fixtures";

describe("billing ledger grants", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createBillingTestDb();
    await seedBillingAccounts(db);
    await seedSandboxes(db);
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
});
