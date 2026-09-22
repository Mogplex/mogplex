import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgrestShim, type Queryable } from "@/lib/db/postgrest-shim";
import { findBillingAccountForScope } from "@/lib/billing/accounts";
import { accrueTokenUsage } from "@/lib/billing/ledger";
import { recordShadowProviderCost } from "@/lib/billing/shadow-ledger";
import {
  meterReconciledTokenUsage,
  type TokenUsageMeteringInput,
} from "@/lib/billing/token-usage";
import {
  createBillingTestDb,
  seedBillingAccounts,
  TOKEN_ACCRUAL_ACCOUNT_ID,
  TOKEN_ACCRUAL_USER_ID,
} from "./helpers/billing-ledger-fixtures";

describe("AI overhead ledger integration", () => {
  let db: PGlite;
  let client: SupabaseClient;
  beforeAll(async () => {
    db = await createBillingTestDb();
    await seedBillingAccounts(db);
    const queryable: Queryable = {
      query: async (text, values) => {
        const result = await db.query<Record<string, unknown>>(text, values);
        return {
          rows: result.rows,
          rowCount: result.affectedRows ?? result.rows.length,
        };
      },
    };
    client = createPostgrestShim(queryable) as unknown as SupabaseClient;
    await db.query(
      "select post_credit_ledger_entry($1,100,'purchased','topup','overhead:test-funds',null,'{}')",
      [TOKEN_ACCRUAL_ACCOUNT_ID]
    );
  });
  afterAll(async () => {
    await db.close();
  });

  function input(id: string): TokenUsageMeteringInput {
    return {
      aiCallId: id,
      userId: TOKEN_ACCRUAL_USER_ID,
      model: "test-model",
      costUsd: 0.0834,
      completedAt: "2026-08-01T00:00:00.000Z",
      generationIds: ["gen-1"],
      metadata: null,
    };
  }
  function deps(allowPlatformAi: boolean) {
    return {
      loadExplicitPlatformAccess: async () => ({
        allowPlatformAi,
        allowPlatformSandbox: false,
      }),
      findBillingAccountForScope: (
        scope: Parameters<typeof findBillingAccountForScope>[0]
      ) => findBillingAccountForScope(scope, client),
      accrueTokenUsage: (event: Parameters<typeof accrueTokenUsage>[0]) =>
        accrueTokenUsage(event, client),
      recordProviderCost: (
        event: Parameters<typeof recordShadowProviderCost>[0]
      ) => recordShadowProviderCost(event, client),
    };
  }

  it.each([
    [true, "allowlisted"],
    [false, "before_billing_account"],
  ] as const)(
    "persists %s overhead exactly once without customer costs or credit debits",
    async (exempt, reason) => {
      const call = input(`overhead-${reason}`);
      const first = await meterReconciledTokenUsage(call, deps(exempt));
      expect(first).toMatchObject({ reason, amountCents: 0, metered: false });
      expect(await meterReconciledTokenUsage(call, deps(exempt))).toEqual(
        first
      );
      const facts = await db.query(
        `select account_id, shared_overhead_category, normalized_cost_micros,
        retail_debit_micros, billing_treatment, metadata->>'user_id' as user_id
        from billing_provider_cost_events where provider_event_id=$1`,
        [`tok:${call.aiCallId}`]
      );
      expect(facts.rows).toEqual([
        {
          account_id: null,
          shared_overhead_category: "platform_operations",
          normalized_cost_micros: 83_400,
          retail_debit_micros: 0,
          billing_treatment: "shared_overhead",
          user_id: TOKEN_ACCRUAL_USER_ID,
        },
      ]);
      expect(
        (await db.query("select * from token_usage_accruals")).rows
      ).toEqual([]);
      expect(
        (
          await db.query(
            "select * from billing_customer_retail_cost_operations"
          )
        ).rows
      ).toEqual([]);
      expect(
        (
          await db.query("select purchased_cents from billing_balance($1)", [
            TOKEN_ACCRUAL_ACCOUNT_ID,
          ])
        ).rows
      ).toEqual([{ purchased_cents: 100 }]);
    }
  );

  it("keeps billed calls on the single existing passthrough fact", async () => {
    const call = {
      ...input("paid-call"),
      completedAt: "2099-08-01T00:00:00.000Z",
    };
    expect((await meterReconciledTokenUsage(call, deps(false))).reason).toBe(
      "posted"
    );
    expect((await meterReconciledTokenUsage(call, deps(false))).reason).toBe(
      "duplicate"
    );
    expect(
      (
        await db.query(
          "select normalized_cost_micros,retail_debit_micros,billing_treatment from billing_provider_cost_events where operation_ref='paid-call'"
        )
      ).rows
    ).toEqual([
      {
        normalized_cost_micros: 83_400,
        retail_debit_micros: 83_400,
        billing_treatment: "hosted_usage",
      },
    ]);
    expect(
      (
        await db.query("select purchased_cents from billing_balance($1)", [
          TOKEN_ACCRUAL_ACCOUNT_ID,
        ])
      ).rows
    ).toEqual([{ purchased_cents: 92 }]);
  });
});
