import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ACCOUNT_ID,
  createBillingTestDb,
  seedBillingAccounts,
} from "./helpers/billing-ledger-fixtures";

describe("capacity billing customer retail cost views", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createBillingTestDb();
    await seedBillingAccounts(db);
    await db.query(
      `insert into billing_provider_cost_events (
         provider, provider_event_id, cost_source, account_id,
         shared_overhead_category,
         provider_cost_micros, normalized_cost_micros, retail_debit_micros,
         billing_treatment, pricing_rule_version, operation_ref, occurred_at
       ) values
         ('ai-gateway', 'summary-ai-1', 'ai', $1, null, 10000, 10000, 12500,
          'hosted_usage', 'capacity_v2', 'operation-1', $2),
         ('ai-gateway', 'summary-ai-2', 'ai', $1, null, 2000, 2000, 2500,
          'hosted_usage', 'capacity_v2', 'operation-1', $3),
         ('trigger', 'summary-trigger-1', 'trigger', $1, null, 4000, 4000, 5000,
          'hosted_usage', 'capacity_v2', 'operation-1', $4),
         ('vercel', 'summary-overhead-1', 'other', null,
          'platform_operations', 9000, 9000, 0,
          'shared_overhead', 'capacity_v2', null, $4)`,
      [
        ACCOUNT_ID,
        "2026-08-16T12:00:00.000Z",
        "2026-08-16T12:01:00.000Z",
        "2026-08-16T12:02:00.000Z",
      ]
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it("aggregates customer retail totals without provider or overhead fields", async () => {
    const operations = await db.query<{
      account_id: string;
      operation_ref: string;
      retail_debit_micros: number | string;
      occurred_at: string;
    }>(
      `select account_id, operation_ref, retail_debit_micros,
              occurred_at::text
       from billing_customer_retail_cost_operations`
    );
    expect(operations.rows).toHaveLength(1);
    expect(operations.rows[0]).toMatchObject({
      account_id: ACCOUNT_ID,
      operation_ref: "operation-1",
    });
    expect(Number(operations.rows[0]?.retail_debit_micros)).toBe(20_000);
    expect(new Date(operations.rows[0]!.occurred_at).toISOString()).toBe(
      "2026-08-16T12:02:00.000Z"
    );

    const items = await db.query<{
      operation_ref: string;
      cost_source: string;
      retail_debit_micros: number | string;
    }>(
      `select operation_ref, cost_source, retail_debit_micros
       from billing_customer_retail_cost_items
       order by cost_source`
    );
    expect(
      items.rows.map((item) => ({
        operation_ref: item.operation_ref,
        cost_source: item.cost_source,
        retail_debit_micros: Number(item.retail_debit_micros),
      }))
    ).toEqual([
      {
        operation_ref: "operation-1",
        cost_source: "ai",
        retail_debit_micros: 15_000,
      },
      {
        operation_ref: "operation-1",
        cost_source: "trigger",
        retail_debit_micros: 5_000,
      },
    ]);
  });

  it("keeps both retail projections service-only", async () => {
    const privileges = await db.query<{
      view_name: string;
      anon: boolean;
      authenticated: boolean;
      service_role: boolean;
    }>(
      `select view_name,
         has_table_privilege('anon', 'public.' || view_name, 'select') as anon,
         has_table_privilege(
           'authenticated', 'public.' || view_name, 'select'
         ) as authenticated,
         has_table_privilege(
           'service_role', 'public.' || view_name, 'select'
         ) as service_role
       from (values
         ('billing_customer_retail_cost_items'),
         ('billing_customer_retail_cost_operations')
       ) as views(view_name)
       order by view_name`
    );
    expect(privileges.rows).toEqual([
      {
        view_name: "billing_customer_retail_cost_items",
        anon: false,
        authenticated: false,
        service_role: true,
      },
      {
        view_name: "billing_customer_retail_cost_operations",
        anon: false,
        authenticated: false,
        service_role: true,
      },
    ]);
  });
});
