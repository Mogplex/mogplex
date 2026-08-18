import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  TOKEN_ACCRUAL_ACCOUNT_ID,
  applyBillingMigration,
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

    const customerCosts = await db.query<{
      operation_ref: string;
      retail_debit_micros: number;
    }>(
      `select operation_ref, retail_debit_micros
       from billing_customer_retail_cost_operations
       where account_id = $1
       order by operation_ref`,
      [TOKEN_ACCRUAL_ACCOUNT_ID]
    );
    expect(customerCosts.rows).toEqual([
      { operation_ref: "exact-1", retail_debit_micros: 5_000 },
      { operation_ref: "exact-2", retail_debit_micros: 5_001 },
      { operation_ref: "exact-3", retail_debit_micros: 83_400 },
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

  it("backfills existing token accruals without posting another debit", async () => {
    const historicalDb = await createBillingTestDb({
      includeTokenCostEvents: false,
    });
    try {
      await seedBillingAccounts(historicalDb);
      const aiCallId = "00000000-0000-4000-8000-000000000099";
      await historicalDb.query(
        `insert into ai_calls (id, type, metadata)
         values ($1, 'pr_review', $2)`,
        [
          aiCallId,
          JSON.stringify({
            repo_full_name: "Mogplex/mogplex",
            pr_number: 285,
          }),
        ]
      );
      await historicalDb.query(
        `select post_credit_ledger_entry(
           $1, 100, 'purchased', 'topup', 'topup:historical', null, '{}'
         )`,
        [TOKEN_ACCRUAL_ACCOUNT_ID]
      );
      await historicalDb.query(
        `select * from accrue_token_usage(
           $1, 3380846, 'tok:historical', '2026-08', $2
         )`,
        [TOKEN_ACCRUAL_ACCOUNT_ID, JSON.stringify({ ai_call_id: aiCallId })]
      );

      await applyBillingMigration(
        historicalDb,
        "20260818193000_token_usage_customer_cost_events.sql"
      );

      const result = await historicalDb.query<{
        description: string;
        retail_debit_micros: number;
        remaining_cents: number;
      }>(
        `select operation.description,
                operation.retail_debit_micros,
                balance.purchased_cents as remaining_cents
         from billing_customer_retail_cost_operations operation
         cross join billing_balance($1) balance
         where operation.account_id = $1`,
        [TOKEN_ACCRUAL_ACCOUNT_ID]
      );
      expect(result.rows).toEqual([
        {
          description: "Code review · Mogplex/mogplex #285",
          retail_debit_micros: 33_809,
          remaining_cents: 97,
        },
      ]);
    } finally {
      await historicalDb.close();
    }
  });
});
