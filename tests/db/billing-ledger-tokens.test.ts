import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  TOKEN_ACCRUAL_ACCOUNT_ID,
  createBillingTestDb,
  seedBillingAccounts,
  seedSandboxes,
} from "./helpers/billing-ledger-fixtures";

describe("billing ledger token accrual", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createBillingTestDb();
    await seedBillingAccounts(db);
    await seedSandboxes(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("carries exact Gateway fractions into whole-cent token debits", async () => {
    await db.query(
      `select post_credit_ledger_entry(
         $1, 100, 'purchased', 'topup', 'topup:token-accrual', null, '{}'
       )`,
      [TOKEN_ACCRUAL_ACCOUNT_ID]
    );

    const first = await db.query<{
      posted: boolean;
      debited_cents: number;
      remainder_cost_units: number;
    }>(
      `select * from accrue_token_usage(
         $1, 499999, 'tok:exact-1', '2026-08', '{"cost_usd":0.00499999}'
       )`,
      [TOKEN_ACCRUAL_ACCOUNT_ID]
    );
    expect(first.rows).toEqual([
      {
        posted: true,
        debited_cents: 0,
        remainder_cost_units: 499_999,
      },
    ]);

    const second = await db.query<{
      posted: boolean;
      debited_cents: number;
      remainder_cost_units: number;
    }>(
      `select * from accrue_token_usage(
         $1, 500001, 'tok:exact-2', '2026-08', '{"cost_usd":0.00500001}'
       )`,
      [TOKEN_ACCRUAL_ACCOUNT_ID]
    );
    expect(second.rows).toEqual([
      { posted: true, debited_cents: 1, remainder_cost_units: 0 },
    ]);

    const third = await db.query<{
      posted: boolean;
      debited_cents: number;
      remainder_cost_units: number;
    }>(
      `select * from accrue_token_usage(
         $1, 8340000, 'tok:exact-3', '2026-08', '{"cost_usd":0.0834}'
       )`,
      [TOKEN_ACCRUAL_ACCOUNT_ID]
    );
    expect(third.rows).toEqual([
      {
        posted: true,
        debited_cents: 8,
        remainder_cost_units: 340_000,
      },
    ]);

    const duplicate = await db.query<{
      posted: boolean;
      debited_cents: number;
      remainder_cost_units: number;
    }>(
      `select * from accrue_token_usage(
         $1, 8340000, 'tok:exact-3', '2026-08', '{"cost_usd":0.0834}'
       )`,
      [TOKEN_ACCRUAL_ACCOUNT_ID]
    );
    expect(duplicate.rows).toEqual([
      {
        posted: false,
        debited_cents: 8,
        remainder_cost_units: 340_000,
      },
    ]);

    const state = await db.query<{
      purchased_cents: number;
      token_usage_remainder_cost_units: number;
      accrued_cost_units: number;
    }>(
      `select b.purchased_cents,
              a.token_usage_remainder_cost_units,
              (select sum(t.cost_units)::bigint
               from token_usage_accruals t where t.account_id = a.id)
                as accrued_cost_units
       from billing_accounts a
       cross join billing_balance(a.id) b
       where a.id = $1`,
      [TOKEN_ACCRUAL_ACCOUNT_ID]
    );
    expect(state.rows).toEqual([
      {
        purchased_cents: 91,
        token_usage_remainder_cost_units: 340_000,
        accrued_cost_units: 9_340_000,
      },
    ]);
  });

  it("restricts exact token accruals to the service role", async () => {
    const privileges = await db.query<{
      anon: boolean;
      authenticated: boolean;
      service_role: boolean;
    }>(`
      select
        has_function_privilege(
          'anon',
          'public.accrue_token_usage(uuid,bigint,text,text,jsonb)',
          'EXECUTE'
        ) as anon,
        has_function_privilege(
          'authenticated',
          'public.accrue_token_usage(uuid,bigint,text,text,jsonb)',
          'EXECUTE'
        ) as authenticated,
        has_function_privilege(
          'service_role',
          'public.accrue_token_usage(uuid,bigint,text,text,jsonb)',
          'EXECUTE'
        ) as service_role
    `);

    expect(privileges.rows).toEqual([
      { anon: false, authenticated: false, service_role: true },
    ]);
  });
});
