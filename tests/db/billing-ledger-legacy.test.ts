import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LEGACY_RECOVERY_ACCOUNT_ID,
  LEGACY_ROUNDUP_ACCOUNT_ID,
  LEGACY_TOKEN_ACCOUNT_ID,
  createBillingTestDb,
  seedBillingAccounts,
  seedSandboxes,
} from "./helpers/billing-ledger-fixtures";

describe("billing ledger legacy recovery", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createBillingTestDb();
    await seedBillingAccounts(db);
    await seedSandboxes(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("recovers a legacy rounded debit without charging the call twice", async () => {
    await db.query(
      `select post_credit_ledger_entry(
         $1, 100, 'purchased', 'topup', 'topup:legacy-token', null, '{}'
       )`,
      [LEGACY_TOKEN_ACCOUNT_ID]
    );
    await db.query(
      `select * from post_billing_usage_debit(
         $1, 8, 'usage_tokens', 'tok:legacy-call', '2026-08',
         '{"cost_usd":0.0834}'
       )`,
      [LEGACY_TOKEN_ACCOUNT_ID]
    );

    const recovered = await db.query<{
      posted: boolean;
      debited_cents: number;
      remainder_cost_units: number;
    }>(
      `select * from accrue_token_usage(
         $1, 8340000, 'tok:legacy-call', '2026-08',
         '{"cost_usd":0.0834}'
       )`,
      [LEGACY_TOKEN_ACCOUNT_ID]
    );
    expect(recovered.rows).toEqual([
      {
        posted: true,
        debited_cents: 8,
        remainder_cost_units: 340_000,
      },
    ]);

    const state = await db.query<{
      purchased_cents: number;
      usage_debit_cents: number;
      accrual_count: number;
    }>(
      `select b.purchased_cents,
              (select -sum(delta_cents)::bigint
               from credit_ledger
               where account_id = a.id and kind = 'usage_tokens')
                as usage_debit_cents,
              (select count(*)::integer
               from token_usage_accruals
               where account_id = a.id) as accrual_count
       from billing_accounts a
       cross join billing_balance(a.id) b
       where a.id = $1`,
      [LEGACY_TOKEN_ACCOUNT_ID]
    );
    expect(state.rows).toEqual([
      { purchased_cents: 92, usage_debit_cents: 8, accrual_count: 1 },
    ]);
  });

  it("carries a legacy round-up forward as exact paid usage", async () => {
    await db.query(
      `select post_credit_ledger_entry(
         $1, 100, 'purchased', 'topup', 'topup:legacy-roundup', null, '{}'
       )`,
      [LEGACY_ROUNDUP_ACCOUNT_ID]
    );
    await db.query(
      `select * from post_billing_usage_debit(
         $1, 9, 'usage_tokens', 'tok:legacy-roundup', '2026-08', '{}'
       )`,
      [LEGACY_ROUNDUP_ACCOUNT_ID]
    );

    const recovered = await db.query<{
      debited_cents: number;
      remainder_cost_units: number;
    }>(
      `select debited_cents, remainder_cost_units from accrue_token_usage(
         $1, 8700000, 'tok:legacy-roundup', '2026-08', '{}'
       )`,
      [LEGACY_ROUNDUP_ACCOUNT_ID]
    );
    expect(recovered.rows).toEqual([
      { debited_cents: 9, remainder_cost_units: -300_000 },
    ]);

    const offset = await db.query<{
      debited_cents: number;
      remainder_cost_units: number;
    }>(
      `select debited_cents, remainder_cost_units from accrue_token_usage(
         $1, 300000, 'tok:legacy-roundup-offset', '2026-08', '{}'
       )`,
      [LEGACY_ROUNDUP_ACCOUNT_ID]
    );
    expect(offset.rows).toEqual([
      { debited_cents: 0, remainder_cost_units: 0 },
    ]);

    const balance = await db.query<{ purchased_cents: number }>(
      "select purchased_cents from billing_balance($1)",
      [LEGACY_ROUNDUP_ACCOUNT_ID]
    );
    expect(balance.rows).toEqual([{ purchased_cents: 91 }]);
  });

  it("posts only the exact remainder missing from a legacy rounded debit", async () => {
    await db.query(
      `select post_credit_ledger_entry(
         $1, 100, 'purchased', 'topup', 'topup:legacy-recovery', null, '{}'
       )`,
      [LEGACY_RECOVERY_ACCOUNT_ID]
    );
    await db.query(
      `select * from accrue_token_usage(
         $1, 900000, 'tok:legacy-recovery-warmup', '2026-08', '{}'
       )`,
      [LEGACY_RECOVERY_ACCOUNT_ID]
    );
    await db.query(
      `select * from post_billing_usage_debit(
         $1, 1, 'usage_tokens', 'tok:legacy-recovery', '2026-08', '{}'
       )`,
      [LEGACY_RECOVERY_ACCOUNT_ID]
    );

    const recovered = await db.query<{
      debited_cents: number;
      remainder_cost_units: number;
    }>(
      `select debited_cents, remainder_cost_units from accrue_token_usage(
         $1, 1490000, 'tok:legacy-recovery', '2026-08', '{}'
       )`,
      [LEGACY_RECOVERY_ACCOUNT_ID]
    );
    expect(recovered.rows).toEqual([
      { debited_cents: 2, remainder_cost_units: 390_000 },
    ]);

    const state = await db.query<{
      purchased_cents: number;
      usage_debit_cents: number;
    }>(
      `select b.purchased_cents,
              (select -sum(delta_cents)::bigint
               from credit_ledger
               where account_id = a.id and kind = 'usage_tokens')
                as usage_debit_cents
       from billing_accounts a
       cross join billing_balance(a.id) b
       where a.id = $1`,
      [LEGACY_RECOVERY_ACCOUNT_ID]
    );
    expect(state.rows).toEqual([{ purchased_cents: 98, usage_debit_cents: 2 }]);
  });
});
