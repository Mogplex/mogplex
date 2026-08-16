import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ACCOUNT_ID,
  createBillingTestDb,
  seedBillingAccounts,
} from "./helpers/billing-ledger-fixtures";

const NOW = "2026-08-16T12:00:00.000Z";

describe("capacity billing shadow foundation", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createBillingTestDb();
    await seedBillingAccounts(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("starts existing accounts in shadow mode without changing credit", async () => {
    const account = await db.query<{
      plan_code: string | null;
      plan_audience: string;
      included_concurrency: number;
      included_retained_bytes: number;
      included_hosted_usage_cents: number;
      entitlement_catalog_version: string;
      entitlement_enforcement_mode: string;
    }>(
      `select plan_code,
              plan_audience,
              included_concurrency,
              included_retained_bytes,
              included_hosted_usage_cents,
              entitlement_catalog_version,
              entitlement_enforcement_mode
       from billing_accounts where id = $1`,
      [ACCOUNT_ID]
    );
    expect(account.rows).toEqual([
      {
        plan_code: null,
        plan_audience: "legacy",
        included_concurrency: 0,
        included_retained_bytes: 0,
        included_hosted_usage_cents: 0,
        entitlement_catalog_version: "capacity_v2",
        entitlement_enforcement_mode: "shadow",
      },
    ]);

    const balance = await db.query<{ total_cents: number }>(
      "select total_cents from billing_balance($1)",
      [ACCOUNT_ID]
    );
    expect(balance.rows[0]?.total_cents).toBe(0);
  });

  it("stores versioned entitlement items idempotently", async () => {
    const args = [
      ACCOUNT_ID,
      "addon-concurrency",
      "concurrency_addon",
      "capacity_v2_concurrency_10_monthly",
      2,
      20,
      0,
      0,
      NOW,
      "evt_entitlement_1",
    ];
    const first = await db.query<{ posted: boolean }>(
      `select record_billing_entitlement_item(
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '{}'
       ) as posted`,
      args
    );
    const duplicate = await db.query<{ posted: boolean }>(
      `select record_billing_entitlement_item(
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '{}'
       ) as posted`,
      args
    );
    expect(first.rows).toEqual([{ posted: true }]);
    expect(duplicate.rows).toEqual([{ posted: false }]);

    const current = await db.query<{
      item_ref: string;
      quantity: number;
      concurrency_delta: number;
    }>(
      `select item_ref, quantity, concurrency_delta
       from billing_current_entitlement_items where account_id = $1`,
      [ACCOUNT_ID]
    );
    expect(current.rows).toEqual([
      {
        item_ref: "addon-concurrency",
        quantity: 2,
        concurrency_delta: 20,
      },
    ]);

    await expect(
      db.query(
        `select record_billing_entitlement_item(
           $1, $2, $3, $4, 3, 30, 0, 0, $5, $6, '{}'
         )`,
        [
          ACCOUNT_ID,
          "addon-concurrency",
          "concurrency_addon",
          "capacity_v2_concurrency_10_monthly",
          NOW,
          "evt_entitlement_1",
        ]
      )
    ).rejects.toThrow(/entitlement item idempotency conflict/);

    await expect(
      db.query(
        `select record_billing_entitlement_item(
           $1, $2, $3, $4, 2, 20, 0, 0, $5, $6, '{"source":"changed"}'
         )`,
        [
          ACCOUNT_ID,
          "addon-concurrency",
          "concurrency_addon",
          "capacity_v2_concurrency_10_monthly",
          NOW,
          "evt_entitlement_1",
        ]
      )
    ).rejects.toThrow(/entitlement item idempotency conflict/);
  });

  it("attributes every provider cost or names shared overhead", async () => {
    const accountCosts = [
      ["ai-gateway", "ai", "hosted_usage", 10],
      ["trigger.dev", "trigger", "hosted_usage", 10],
      ["vercel", "sandbox_compute", "hosted_usage", 10],
      ["vercel", "sandbox_transfer", "hosted_usage", 10],
      ["neon", "retained_data", "capacity_revenue", 0],
      ["vercel", "vercel_function", "hosted_usage", 10],
      ["neon", "database", "hosted_usage", 10],
      ["resend", "email", "hosted_usage", 10],
      ["vercel", "object_storage", "hosted_usage", 10],
      ["vercel", "transfer", "hosted_usage", 10],
      ["sentry", "observability", "hosted_usage", 10],
      ["other-provider", "other", "hosted_usage", 10],
    ] as const;

    for (const [provider, costSource, treatment, retailDebit] of accountCosts) {
      const result = await db.query<{ posted: boolean }>(
        `select record_billing_provider_cost_event(
           $1, $2, $3, $4, null, 8, 'USD', 8, $5, $6,
           'capacity_v2', 1, 'event', $7, '{}', '{}'
         ) as posted`,
        [
          provider,
          `provider_${costSource}`,
          costSource,
          ACCOUNT_ID,
          retailDebit,
          treatment,
          NOW,
        ]
      );
      expect(result.rows[0]?.posted, costSource).toBe(true);
    }

    await db.query(
      `select record_billing_provider_cost_event(
         'vercel', 'provider_platform_maintenance', 'vercel_function', null,
         'platform_operations', 8, 'USD', 8, 0, 'shared_overhead',
         'capacity_v2', 1, 'invocation', $1, '{}', '{}'
       )`,
      [NOW]
    );

    const ownership = await db.query<{
      total: number;
      attributed: number;
      shared: number;
    }>(`
      select count(*)::integer as total,
             count(*) filter (where account_id is not null)::integer
               as attributed,
             count(*) filter (
               where shared_overhead_category = 'platform_operations'
             )::integer as shared
      from billing_provider_cost_events
    `);
    expect(ownership.rows).toEqual([{ total: 13, attributed: 12, shared: 1 }]);

    const duplicate = await db.query<{ posted: boolean }>(
      `select record_billing_provider_cost_event(
         'ai-gateway', 'provider_ai', 'ai', $1, null,
         8, 'USD', 8, 10, 'hosted_usage', 'capacity_v2',
         1, 'event', $2, '{}', '{}'
       ) as posted`,
      [ACCOUNT_ID, NOW]
    );
    expect(duplicate.rows).toEqual([{ posted: false }]);

    await expect(
      db.query(
        `select record_billing_provider_cost_event(
           'ai-gateway', 'provider_ai', 'ai', $1, null,
           9, 'USD', 9, 12, 'hosted_usage', 'capacity_v2',
           1, 'event', $2, '{}', '{}'
         )`,
        [ACCOUNT_ID, NOW]
      )
    ).rejects.toThrow(/provider cost idempotency conflict/);

    await expect(
      db.query(
        `select record_billing_provider_cost_event(
           'ai-gateway', 'provider_ai', 'ai', $1, null,
           8, 'USD', 8, 10, 'hosted_usage', 'capacity_v2',
           2, 'event', $2, '{"operationRef":"changed"}', '{}'
         )`,
        [ACCOUNT_ID, NOW]
      )
    ).rejects.toThrow(/provider cost idempotency conflict/);

    const ledger = await db.query<{ count: number }>(
      "select count(*)::integer as count from credit_ledger"
    );
    expect(ledger.rows).toEqual([{ count: 0 }]);
  });

  it("keeps entitlement and provider facts append-only", async () => {
    await expect(
      db.query(
        `update billing_provider_cost_events set provider_cost_micros = 1
         where provider = 'ai-gateway' and provider_event_id = 'provider_ai'`
      )
    ).rejects.toThrow(/append-only/);
    await expect(
      db.query(
        `delete from billing_entitlement_items
         where source_event_id = 'evt_entitlement_1'`
      )
    ).rejects.toThrow(/append-only/);
  });

  it("restricts shadow writes to least-privilege RPCs", async () => {
    const functions = [
      "public.record_billing_entitlement_item(uuid,text,text,text,integer,integer,bigint,bigint,timestamp with time zone,text,jsonb)",
      "public.record_billing_provider_cost_event(text,text,text,uuid,text,bigint,text,bigint,bigint,text,text,numeric,text,timestamp with time zone,jsonb,jsonb)",
    ];
    for (const signature of functions) {
      const privileges = await db.query<{
        anon: boolean;
        authenticated: boolean;
        service_role: boolean;
      }>(
        `select
           has_function_privilege('anon', $1, 'execute') as anon,
           has_function_privilege('authenticated', $1, 'execute')
             as authenticated,
           has_function_privilege('service_role', $1, 'execute')
             as service_role`,
        [signature]
      );
      expect(privileges.rows[0], signature).toEqual({
        anon: false,
        authenticated: false,
        service_role: true,
      });
    }

    for (const table of [
      "billing_entitlement_items",
      "billing_provider_cost_events",
    ]) {
      const privileges = await db.query<{
        can_select: boolean;
        can_insert: boolean;
        can_update: boolean;
        can_delete: boolean;
      }>(
        `select
           has_table_privilege('service_role', $1, 'select') as can_select,
           has_table_privilege('service_role', $1, 'insert') as can_insert,
           has_table_privilege('service_role', $1, 'update') as can_update,
           has_table_privilege('service_role', $1, 'delete') as can_delete`,
        [`public.${table}`]
      );
      expect(privileges.rows[0], table).toEqual({
        can_select: true,
        can_insert: false,
        can_update: false,
        can_delete: false,
      });
    }
  });
});
