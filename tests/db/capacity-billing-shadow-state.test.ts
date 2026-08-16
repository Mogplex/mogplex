import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ACCOUNT_ID,
  CANCELLATION_ACCOUNT_ID,
  USAGE_ACCOUNT_ID,
  createBillingTestDb,
  seedBillingAccounts,
} from "./helpers/billing-ledger-fixtures";

const OCCURRED_AT = "2026-08-16T12:00:00.000Z";
const TERMINAL_AT = "2099-08-16T13:00:00.000Z";
const EXPIRES_AT = "2099-08-16T14:00:00.000Z";

describe("capacity billing shadow state", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createBillingTestDb();
    await seedBillingAccounts(db);
    await db.query(
      `update billing_accounts
       set included_concurrency = case when id = $1 then 2 else 0 end,
           included_retained_bytes = case when id = $2 then 100 else 0 end`,
      [CANCELLATION_ACCOUNT_ID, USAGE_ACCOUNT_ID]
    );
    await db.query(
      `select post_credit_ledger_entry(
         $1, 100, 'included', 'grant', 'grant:shadow-reservation',
         '2026-08', '{}'
       )`,
      [ACCOUNT_ID]
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it("models spendable balance without changing the credit ledger", async () => {
    const first = await db.query<{
      posted: boolean;
      would_admit: boolean;
      balance_micros: string;
      open_reserved_micros: string;
      spendable_micros: string;
    }>(
      `select * from record_billing_shadow_reservation(
         $1, 'reservation-1', 'reserve:1', 'operation-1', 'workflow-1',
         600000, '{"bound":"approved"}', 'capacity_v2', $2, '{}'
       )`,
      [ACCOUNT_ID, EXPIRES_AT]
    );
    expect(first.rows).toEqual([
      {
        posted: true,
        would_admit: true,
        balance_micros: "1000000",
        open_reserved_micros: "0",
        spendable_micros: "1000000",
      },
    ]);

    await db.query(
      `update billing_accounts
       set entitlement_enforcement_mode = 'meter_only' where id = $1`,
      [ACCOUNT_ID]
    );

    const second = await db.query<{
      posted: boolean;
      would_admit: boolean;
      open_reserved_micros: string;
      spendable_micros: string;
    }>(
      `select posted, would_admit, open_reserved_micros, spendable_micros
       from record_billing_shadow_reservation(
         $1, 'reservation-2', 'reserve:2', 'operation-2', null,
         500000, '{}', 'capacity_v2', $2, '{}'
       )`,
      [ACCOUNT_ID, EXPIRES_AT]
    );
    expect(second.rows).toEqual([
      {
        posted: true,
        would_admit: false,
        open_reserved_micros: "600000",
        spendable_micros: "400000",
      },
    ]);

    const duplicate = await db.query<{ posted: boolean; would_admit: boolean }>(
      `select posted, would_admit from record_billing_shadow_reservation(
         $1, 'reservation-1', 'reserve:1', 'operation-1', 'workflow-1',
         600000, '{"bound":"approved"}', 'capacity_v2', $2, '{}'
       )`,
      [ACCOUNT_ID, EXPIRES_AT]
    );
    expect(duplicate.rows).toEqual([{ posted: false, would_admit: true }]);

    await expect(
      db.query(
        `select * from record_billing_shadow_reservation(
           $1, 'reservation-1', 'reserve:1', 'operation-changed', 'workflow-1',
           600000, '{"bound":"approved"}', 'capacity_v2', $2, '{}'
         )`,
        [ACCOUNT_ID, EXPIRES_AT]
      )
    ).rejects.toThrow(/reservation idempotency conflict/);

    const terminal = await db.query<{ posted: boolean }>(
      `select record_billing_reservation_terminal(
         'reservation-1', 'settled', 550000, 'settle:1', $1,
         '{"provider_costs":2}'
       ) as posted`,
      [TERMINAL_AT]
    );
    const terminalDuplicate = await db.query<{ posted: boolean }>(
      `select record_billing_reservation_terminal(
         'reservation-1', 'settled', 550000, 'settle:1', $1,
         '{"provider_costs":2}'
       ) as posted`,
      [TERMINAL_AT]
    );
    expect(terminal.rows).toEqual([{ posted: true }]);
    expect(terminalDuplicate.rows).toEqual([{ posted: false }]);

    await expect(
      db.query(
        `select record_billing_reservation_terminal(
           'reservation-2', 'settled', 500001, 'settle:2', $1, '{}'
         )`,
        [TERMINAL_AT]
      )
    ).rejects.toThrow(/exceeds its approved bound/);

    const state = await db.query<{
      open_count: number;
      total_cents: number;
    }>(
      `select
         (select count(*)::integer from billing_open_cost_reservations
          where account_id = $1) as open_count,
         (select total_cents from billing_balance($1)) as total_cents`,
      [ACCOUNT_ID]
    );
    expect(state.rows).toEqual([{ open_count: 1, total_cents: 100 }]);

    await db.query(
      `select record_billing_reservation_terminal(
         'reservation-2', 'expired', 0, 'repair:reservation-2', $1,
         '{"actor":"operator"}'
       )`,
      [TERMINAL_AT]
    );
    const repaired = await db.query<{ count: number }>(
      `select count(*)::integer as count
       from billing_open_cost_reservations where account_id = $1`,
      [ACCOUNT_ID]
    );
    expect(repaired.rows).toEqual([{ count: 0 }]);
  });

  it("models root-workflow concurrency and releases every terminal outcome", async () => {
    const decisions: Array<{
      posted: boolean;
      would_admit: boolean;
      active_before: number;
      concurrency_limit: number;
    }> = [];
    for (let index = 1; index <= 3; index += 1) {
      if (index === 2) {
        await db.query(
          `update billing_accounts
           set entitlement_enforcement_mode = 'meter_only' where id = $1`,
          [CANCELLATION_ACCOUNT_ID]
        );
      }
      const result = await db.query<(typeof decisions)[number]>(
        `select * from record_billing_shadow_capacity_lease(
           $1, $2, $3, $4, $5, '{}'
         )`,
        [
          CANCELLATION_ACCOUNT_ID,
          `lease-${index}`,
          `acquire:${index}`,
          `root-workflow-${index}`,
          OCCURRED_AT,
        ]
      );
      decisions.push(result.rows[0]!);
    }
    expect(decisions).toEqual([
      {
        posted: true,
        would_admit: true,
        active_before: 0,
        concurrency_limit: 2,
      },
      {
        posted: true,
        would_admit: true,
        active_before: 1,
        concurrency_limit: 2,
      },
      {
        posted: true,
        would_admit: false,
        active_before: 2,
        concurrency_limit: 2,
      },
    ]);

    const duplicate = await db.query<{ posted: boolean; would_admit: boolean }>(
      `select posted, would_admit from record_billing_shadow_capacity_lease(
         $1, 'lease-1', 'acquire:1', 'root-workflow-1', $2, '{}'
       )`,
      [CANCELLATION_ACCOUNT_ID, OCCURRED_AT]
    );
    expect(duplicate.rows).toEqual([{ posted: false, would_admit: true }]);

    for (const [leaseRef, outcome] of [
      ["lease-1", "success"],
      ["lease-2", "failure"],
      ["lease-3", "operator_repair"],
    ] as const) {
      const release = await db.query<{ posted: boolean }>(
        `select record_billing_capacity_release(
           $1, $2, $3, $4, '{}'
         ) as posted`,
        [leaseRef, outcome, `release:${leaseRef}`, TERMINAL_AT]
      );
      expect(release.rows).toEqual([{ posted: true }]);
    }

    const active = await db.query<{ count: number }>(
      `select count(*)::integer as count
       from billing_active_workflow_capacity_leases where account_id = $1`,
      [CANCELLATION_ACCOUNT_ID]
    );
    expect(active.rows).toEqual([{ count: 0 }]);

    const duplicateRelease = await db.query<{ posted: boolean }>(
      `select record_billing_capacity_release(
         'lease-1', 'success', 'release:lease-1', $1, '{}'
       ) as posted`,
      [TERMINAL_AT]
    );
    expect(duplicateRelease.rows).toEqual([{ posted: false }]);
  });

  it("tracks logical retained bytes and over-limit shadow decisions", async () => {
    const additions = [
      ["logs_events", "log-1", 60, "retained:1", true, "60"],
      ["generated_artifact", "artifact-1", 50, "retained:2", false, "110"],
      ["logs_events", "log-1", -20, "retained:3", true, "90"],
    ] as const;

    for (const [
      resourceType,
      resourceRef,
      delta,
      source,
      admits,
      total,
    ] of additions) {
      const result = await db.query<{
        posted: boolean;
        would_admit: boolean;
        logical_bytes: string;
        retained_limit_bytes: string;
      }>(
        `select * from record_billing_shadow_retained_data_event(
           $1, $2, $3, $4, $5, 'operation-retained', $6, '{}'
         )`,
        [
          USAGE_ACCOUNT_ID,
          resourceType,
          resourceRef,
          delta,
          source,
          OCCURRED_AT,
        ]
      );
      expect(result.rows).toEqual([
        {
          posted: true,
          would_admit: admits,
          logical_bytes: total,
          retained_limit_bytes: "100",
        },
      ]);
    }

    const duplicate = await db.query<{
      posted: boolean;
      logical_bytes: string;
    }>(
      `select posted, logical_bytes
       from record_billing_shadow_retained_data_event(
         $1, 'logs_events', 'log-1', -20, 'retained:3',
         'operation-retained', $2, '{}'
       )`,
      [USAGE_ACCOUNT_ID, OCCURRED_AT]
    );
    expect(duplicate.rows).toEqual([{ posted: false, logical_bytes: "90" }]);

    await expect(
      db.query(
        `select * from record_billing_shadow_retained_data_event(
           $1, 'logs_events', 'log-1', -100, 'retained:4',
           'operation-retained', $2, '{}'
         )`,
        [USAGE_ACCOUNT_ID, OCCURRED_AT]
      )
    ).rejects.toThrow(/logical bytes negative/);

    const rollups = await db.query<{
      resource_type: string;
      logical_bytes: number;
    }>(
      `select resource_type, logical_bytes
       from billing_retained_data_rollups
       where account_id = $1 order by resource_type`,
      [USAGE_ACCOUNT_ID]
    );
    expect(rollups.rows).toEqual([
      { resource_type: "generated_artifact", logical_bytes: 50 },
      { resource_type: "logs_events", logical_bytes: 40 },
    ]);
  });

  it("fails closed if an account is switched to enforcement before Gate C", async () => {
    await db.query(
      `update billing_accounts set entitlement_enforcement_mode = 'enforced'
       where id in ($1, $2, $3)`,
      [ACCOUNT_ID, CANCELLATION_ACCOUNT_ID, USAGE_ACCOUNT_ID]
    );
    await expect(
      db.query(
        `select * from record_billing_shadow_reservation(
           $1, 'enforced-reservation', 'enforced-reserve',
           'enforced-operation', null, 1, '{}', 'capacity_v2', $2, '{}'
         )`,
        [ACCOUNT_ID, EXPIRES_AT]
      )
    ).rejects.toThrow(/shadow reservation writer is disabled/);
    await expect(
      db.query(
        `select * from record_billing_shadow_capacity_lease(
           $1, 'enforced-lease', 'enforced-acquire', 'enforced-workflow',
           $2, '{}'
         )`,
        [CANCELLATION_ACCOUNT_ID, OCCURRED_AT]
      )
    ).rejects.toThrow(/shadow capacity writer is disabled/);
    await expect(
      db.query(
        `select * from record_billing_shadow_retained_data_event(
           $1, 'customer_upload', 'upload-1', 1, 'retained:enforced',
           null, $2, '{}'
         )`,
        [USAGE_ACCOUNT_ID, OCCURRED_AT]
      )
    ).rejects.toThrow(/shadow retained-data writer is disabled/);

    const enforcedFacts = await db.query<{ count: number }>(
      `select
         (select count(*) from billing_cost_reservations
          where reservation_ref = 'enforced-reservation')::integer
       + (select count(*) from billing_workflow_capacity_leases
          where lease_ref = 'enforced-lease')::integer
       + (select count(*) from billing_retained_data_events
          where source_ref = 'retained:enforced')::integer as count`
    );
    expect(enforcedFacts.rows).toEqual([{ count: 0 }]);
  });

  it("keeps source facts append-only and exposes only service RPCs", async () => {
    for (const table of [
      "billing_cost_reservations",
      "billing_cost_reservation_terminal_events",
      "billing_workflow_capacity_leases",
      "billing_workflow_capacity_release_events",
      "billing_retained_data_events",
    ]) {
      await expect(db.query(`delete from ${table}`)).rejects.toThrow(
        /append-only/
      );
    }

    const functions = [
      "public.record_billing_shadow_reservation(uuid,text,text,text,text,bigint,jsonb,text,timestamp with time zone,jsonb)",
      "public.record_billing_reservation_terminal(text,text,bigint,text,timestamp with time zone,jsonb)",
      "public.record_billing_shadow_capacity_lease(uuid,text,text,text,timestamp with time zone,jsonb)",
      "public.record_billing_capacity_release(text,text,text,timestamp with time zone,jsonb)",
      "public.record_billing_shadow_retained_data_event(uuid,text,text,bigint,text,text,timestamp with time zone,jsonb)",
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
      "billing_cost_reservations",
      "billing_cost_reservation_terminal_events",
      "billing_workflow_capacity_leases",
      "billing_workflow_capacity_release_events",
      "billing_retained_data_events",
      "billing_retained_data_rollups",
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
