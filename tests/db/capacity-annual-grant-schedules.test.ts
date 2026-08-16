import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ACCOUNT_ID,
  CANCELLATION_ACCOUNT_ID,
  MINIMUM_ACCOUNT_ID,
  NEGATIVE_ACCOUNT_ID,
  createBillingTestDb,
  seedBillingAccounts,
} from "./helpers/billing-ledger-fixtures";

const SUBSCRIPTION_ID = "sub_capacity_annual";

function annualSnapshot(input: {
  code: "pro" | "plus";
  lookupKey: string;
  concurrency: number;
  retained: number;
  hosted: number;
}) {
  return {
    catalogVersion: "capacity_v2",
    subscriptionId: SUBSCRIPTION_ID,
    cancellation: false,
    plan: {
      code: input.code,
      priceLookupKey: input.lookupKey,
      maxNamedUsers: 1,
      concurrency: input.concurrency,
      retainedDataBytes: input.retained,
      hostedUsageCents: input.hosted,
      periodAnchor: "2026-08-01",
    },
    items: [
      {
        itemRef: "si_plan",
        itemKind: "plan",
        priceLookupKey: input.lookupKey,
        quantity: 1,
        concurrencyDelta: input.concurrency,
        retainedDataBytesDelta: input.retained,
        hostedUsageCentsDelta: input.hosted,
      },
    ],
  };
}

const PRO_ANNUAL = annualSnapshot({
  code: "pro",
  lookupKey: "capacity_v2_pro_annual",
  concurrency: 5,
  retained: 1_000_000_000,
  hosted: 500,
});

const PLUS_ANNUAL = annualSnapshot({
  code: "plus",
  lookupKey: "capacity_v2_plus_annual",
  concurrency: 25,
  retained: 5_000_000_000,
  hosted: 2_500,
});

async function project(
  db: PGlite,
  accountId: string,
  eventId: string,
  value: unknown
) {
  await db.query(
    `select * from apply_billing_capacity_entitlement_snapshot(
       $1, $2, $3, now(), $4::jsonb
     )`,
    [accountId, SUBSCRIPTION_ID, eventId, JSON.stringify(value)]
  );
}

async function insertSchedule(
  db: PGlite,
  input: {
    accountId: string;
    entitlementVersion?: number;
    lookupKey?: string;
    includedUsageCents?: number;
    status?: "pending" | "cancel_pending";
    due?: "past" | "future";
  }
) {
  const result = await db.query<{ id: string }>(
    `insert into billing_annual_grant_schedules (
       account_id, stripe_subscription_id, entitlement_version,
       price_lookup_key, included_usage_cents, cycle_started_at,
       grant_offset, grant_period, due_at, source_event_id, status
     ) values (
       $1, $2, $3, $4, $5, now() - interval '1 month', 1,
       to_char(
         now() ${input.due === "future" ? "+ interval '1 month'" : "- interval '1 minute'"},
         'YYYY-MM'
       ),
       now() ${input.due === "future" ? "+ interval '1 month'" : "- interval '1 minute'"},
       'evt_invoice', $6
     ) returning id`,
    [
      input.accountId,
      SUBSCRIPTION_ID,
      input.entitlementVersion ?? 1,
      input.lookupKey ?? "capacity_v2_pro_annual",
      input.includedUsageCents ?? 500,
      input.status ?? "pending",
    ]
  );
  return result.rows[0]!.id;
}

describe("capacity annual included-usage schedules", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createBillingTestDb();
    await seedBillingAccounts(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("posts a due grant and completes the schedule atomically", async () => {
    await project(db, ACCOUNT_ID, "evt_pro", PRO_ANNUAL);
    const scheduleId = await insertSchedule(db, { accountId: ACCOUNT_ID });

    const applied = await db.query<{
      eligible: boolean;
      posted: boolean;
      duplicate: boolean;
      cancelled: boolean;
    }>("select * from apply_billing_annual_grant_schedule($1)", [scheduleId]);
    expect(applied.rows[0]).toMatchObject({
      eligible: true,
      posted: true,
      duplicate: false,
      cancelled: false,
    });

    const schedule = await db.query<{
      status: string;
      completed: boolean;
    }>(
      `select status, completed_at is not null as completed
       from billing_annual_grant_schedules where id = $1`,
      [scheduleId]
    );
    expect(schedule.rows).toEqual([{ status: "completed", completed: true }]);

    const ledger = await db.query<{
      delta_cents: number;
      kind: string;
      source: string;
    }>(
      `select delta_cents, kind, metadata->>'source' as source
       from credit_ledger where account_id = $1`,
      [ACCOUNT_ID]
    );
    expect(ledger.rows).toEqual([
      {
        delta_cents: 500,
        kind: "grant",
        source: "capacity_annual_schedule",
      },
    ]);

    const duplicate = await db.query<{
      eligible: boolean;
      posted: boolean;
      duplicate: boolean;
    }>("select * from apply_billing_annual_grant_schedule($1)", [scheduleId]);
    expect(duplicate.rows[0]).toMatchObject({
      eligible: true,
      posted: false,
      duplicate: true,
    });
  });

  it("cancels a schedule after a newer entitlement projection", async () => {
    await project(db, CANCELLATION_ACCOUNT_ID, "evt_old", PRO_ANNUAL);
    const scheduleId = await insertSchedule(db, {
      accountId: CANCELLATION_ACCOUNT_ID,
    });
    await project(db, CANCELLATION_ACCOUNT_ID, "evt_new", PLUS_ANNUAL);

    const result = await db.query<{
      eligible: boolean;
      posted: boolean;
      cancelled: boolean;
    }>("select * from apply_billing_annual_grant_schedule($1)", [scheduleId]);
    expect(result.rows[0]).toMatchObject({
      eligible: false,
      posted: false,
      cancelled: true,
    });
    const ledger = await db.query<{ count: number }>(
      `select count(*)::integer as count from credit_ledger
       where account_id = $1`,
      [CANCELLATION_ACCOUNT_ID]
    );
    expect(ledger.rows).toEqual([{ count: 0 }]);
  });

  it("never applies a schedule already waiting for provider cancellation", async () => {
    await project(db, MINIMUM_ACCOUNT_ID, "evt_cancel_pending", PRO_ANNUAL);
    const scheduleId = await insertSchedule(db, {
      accountId: MINIMUM_ACCOUNT_ID,
      status: "cancel_pending",
    });

    const result = await db.query<{
      eligible: boolean;
      cancelled: boolean;
    }>("select * from apply_billing_annual_grant_schedule($1)", [scheduleId]);
    expect(result.rows[0]).toMatchObject({ eligible: false, cancelled: true });
  });

  it("fails closed when Trigger invokes a schedule before its due time", async () => {
    await project(db, NEGATIVE_ACCOUNT_ID, "evt_early", PRO_ANNUAL);
    const scheduleId = await insertSchedule(db, {
      accountId: NEGATIVE_ACCOUNT_ID,
      due: "future",
    });

    await expect(
      db.query("select * from apply_billing_annual_grant_schedule($1)", [
        scheduleId,
      ])
    ).rejects.toThrow(/is not due/);
  });

  it("keeps schedule rows and the grant RPC service-only", async () => {
    const privileges = await db.query<{
      anon_table: boolean;
      authenticated_table: boolean;
      anon_rpc: boolean;
      authenticated_rpc: boolean;
      service_role_rpc: boolean;
    }>(
      `select
         has_table_privilege(
           'anon', 'public.billing_annual_grant_schedules', 'select'
         ) as anon_table,
         has_table_privilege(
           'authenticated', 'public.billing_annual_grant_schedules', 'select'
         ) as authenticated_table,
         has_function_privilege(
           'anon',
           'public.apply_billing_annual_grant_schedule(uuid)', 'execute'
         ) as anon_rpc,
         has_function_privilege(
           'authenticated',
           'public.apply_billing_annual_grant_schedule(uuid)', 'execute'
         ) as authenticated_rpc,
         has_function_privilege(
           'service_role',
           'public.apply_billing_annual_grant_schedule(uuid)', 'execute'
         ) as service_role_rpc`
    );
    expect(privileges.rows).toEqual([
      {
        anon_table: false,
        authenticated_table: false,
        anon_rpc: false,
        authenticated_rpc: false,
        service_role_rpc: true,
      },
    ]);
  });
});
