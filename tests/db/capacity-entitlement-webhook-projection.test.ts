import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ACCOUNT_ID,
  CANCELLATION_ACCOUNT_ID,
  MINIMUM_ACCOUNT_ID,
  NEGATIVE_ACCOUNT_ID,
  SANDBOX_ACCOUNT_ID,
  USAGE_ACCOUNT_ID,
  createBillingTestDb,
  seedBillingAccounts,
} from "./helpers/billing-ledger-fixtures";

function planItem(
  lookupKey: string,
  concurrency: number,
  retained: number,
  hosted: number
) {
  return {
    itemRef: "si_plan",
    itemKind: "plan",
    priceLookupKey: lookupKey,
    quantity: 1,
    concurrencyDelta: concurrency,
    retainedDataBytesDelta: retained,
    hostedUsageCentsDelta: hosted,
  };
}

function addOnItem() {
  return {
    itemRef: "si_addon",
    itemKind: "concurrency_addon",
    priceLookupKey: "capacity_v2_concurrency_10_monthly",
    quantity: 2,
    concurrencyDelta: 10,
    retainedDataBytesDelta: 0,
    hostedUsageCentsDelta: 0,
  };
}

function snapshot(input: {
  code: "pro" | "plus" | "max";
  lookupKey: string;
  concurrency: number;
  retained: number;
  hosted: number;
  addOn?: boolean;
}) {
  return {
    catalogVersion: "capacity_v2",
    subscriptionId: "sub_capacity",
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
      planItem(
        input.lookupKey,
        input.concurrency,
        input.retained,
        input.hosted
      ),
      ...(input.addOn ? [addOnItem()] : []),
    ],
  };
}

const PRO = snapshot({
  code: "pro",
  lookupKey: "capacity_v2_pro_monthly",
  concurrency: 5,
  retained: 1_000_000_000,
  hosted: 500,
});
const PLUS = snapshot({
  code: "plus",
  lookupKey: "capacity_v2_plus_monthly",
  concurrency: 25,
  retained: 5_000_000_000,
  hosted: 2_500,
  addOn: true,
});
const SAME_SECOND_ACCOUNT_ID = "00000000-0000-4000-8000-000000000029";
const SAME_SECOND_USER_ID = "00000000-0000-4000-8000-000000000030";
const CANCELLATION = {
  catalogVersion: "capacity_v2",
  subscriptionId: "sub_capacity",
  cancellation: true,
  plan: null,
  items: [],
};

async function apply(
  db: PGlite,
  accountId: string,
  eventId: string,
  effectiveAt: string,
  value: unknown
) {
  return db.query<{
    applied: boolean;
    duplicate: boolean;
    stale: boolean;
    entitlement_version: number;
  }>(
    `select * from apply_billing_capacity_entitlement_snapshot(
       $1, 'sub_capacity', $2, $3, $4::jsonb
     )`,
    [accountId, eventId, effectiveAt, JSON.stringify(value)]
  );
}

describe("capacity entitlement webhook projection", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createBillingTestDb();
    await seedBillingAccounts(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("ignores a reordered older snapshot without recording stale entitlement rows", async () => {
    const newer = await apply(
      db,
      ACCOUNT_ID,
      "evt_newer",
      "2026-08-16T12:05:00.000Z",
      PLUS
    );
    const older = await apply(
      db,
      ACCOUNT_ID,
      "evt_older",
      "2026-08-16T12:00:00.000Z",
      PRO
    );
    expect(newer.rows).toEqual([
      {
        applied: true,
        duplicate: false,
        stale: false,
        entitlement_version: 1,
      },
    ]);
    expect(older.rows).toEqual([
      {
        applied: false,
        duplicate: false,
        stale: true,
        entitlement_version: 1,
      },
    ]);

    const account = await db.query<{
      plan_code: string;
      included_concurrency: number;
      entitlement_version: number;
      entitlement_projection_event_id: string;
    }>(
      `select plan_code, included_concurrency, entitlement_version,
              entitlement_projection_event_id
       from billing_accounts where id = $1`,
      [ACCOUNT_ID]
    );
    expect(account.rows).toEqual([
      {
        plan_code: "plus",
        included_concurrency: 25,
        entitlement_version: 1,
        entitlement_projection_event_id: "evt_newer",
      },
    ]);
    const rows = await db.query<{ source_event_id: string }>(
      "select source_event_id from billing_entitlement_items where account_id = $1",
      [ACCOUNT_ID]
    );
    expect(new Set(rows.rows.map((row) => row.source_event_id))).toEqual(
      new Set(["evt_newer"])
    );
  });

  it("deduplicates identical delivery and rejects conflicting reuse", async () => {
    await apply(
      db,
      SANDBOX_ACCOUNT_ID,
      "evt_same",
      "2026-08-16T12:00:00.000Z",
      PRO
    );
    const duplicate = await apply(
      db,
      SANDBOX_ACCOUNT_ID,
      "evt_same",
      "2026-08-16T12:00:00.000Z",
      PRO
    );
    expect(duplicate.rows[0]).toMatchObject({
      applied: false,
      duplicate: true,
      stale: false,
      entitlement_version: 1,
    });
    await expect(
      apply(
        db,
        SANDBOX_ACCOUNT_ID,
        "evt_same",
        "2026-08-16T12:00:00.000Z",
        PLUS
      )
    ).rejects.toThrow(/snapshot idempotency conflict/);
  });

  it("closes an add-on omitted from a newer paid snapshot", async () => {
    await apply(
      db,
      CANCELLATION_ACCOUNT_ID,
      "evt_with_addon",
      "2026-08-16T12:00:00.000Z",
      PLUS
    );
    await apply(
      db,
      CANCELLATION_ACCOUNT_ID,
      "evt_without_addon",
      "2026-08-16T12:05:00.000Z",
      PRO
    );
    const current = await db.query<{
      item_ref: string;
      price_lookup_key: string;
      quantity: number;
    }>(
      `select item_ref, price_lookup_key, quantity
       from billing_current_entitlement_items
       where account_id = $1 order by item_ref`,
      [CANCELLATION_ACCOUNT_ID]
    );
    expect(current.rows).toEqual([
      {
        item_ref: "si_addon",
        price_lookup_key: "capacity_v2_concurrency_10_monthly",
        quantity: 0,
      },
      {
        item_ref: "si_plan",
        price_lookup_key: "capacity_v2_pro_monthly",
        quantity: 1,
      },
    ]);
  });

  it("cancellation closes every subscription item and clears included capacity", async () => {
    await apply(
      db,
      USAGE_ACCOUNT_ID,
      "evt_active",
      "2026-08-16T12:00:00.000Z",
      PLUS
    );
    await apply(
      db,
      USAGE_ACCOUNT_ID,
      "evt_cancelled",
      "2026-08-16T12:05:00.000Z",
      CANCELLATION
    );
    const account = await db.query<{
      plan_code: string | null;
      plan_audience: string;
      included_concurrency: number;
      included_retained_bytes: number;
      included_hosted_usage_cents: number;
      stripe_subscription_id: string | null;
    }>(
      `select plan_code, plan_audience, included_concurrency,
              included_retained_bytes, included_hosted_usage_cents,
              stripe_subscription_id
       from billing_accounts where id = $1`,
      [USAGE_ACCOUNT_ID]
    );
    expect(account.rows).toEqual([
      {
        plan_code: null,
        plan_audience: "legacy",
        included_concurrency: 0,
        included_retained_bytes: 0,
        included_hosted_usage_cents: 0,
        stripe_subscription_id: null,
      },
    ]);
    const activeItems = await db.query<{ count: number }>(
      `select count(*)::integer as count
       from billing_current_entitlement_items
       where account_id = $1 and quantity > 0`,
      [USAGE_ACCOUNT_ID]
    );
    expect(activeItems.rows).toEqual([{ count: 0 }]);
  });

  it("keeps cancellation authoritative for events created in the same second", async () => {
    await db.query(
      `insert into billing_accounts (id, owner_type, owner_user_id)
       values ($1, 'user', $2)`,
      [SAME_SECOND_ACCOUNT_ID, SAME_SECOND_USER_ID]
    );
    await apply(
      db,
      SAME_SECOND_ACCOUNT_ID,
      "evt_z_active",
      "2026-08-16T12:00:00.000Z",
      PRO
    );
    const cancelled = await apply(
      db,
      SAME_SECOND_ACCOUNT_ID,
      "evt_a_cancelled",
      "2026-08-16T12:00:00.000Z",
      CANCELLATION
    );
    const replayedActive = await apply(
      db,
      SAME_SECOND_ACCOUNT_ID,
      "evt_zz_active",
      "2026-08-16T12:00:00.000Z",
      PLUS
    );

    expect(cancelled.rows[0]).toMatchObject({ applied: true, stale: false });
    expect(replayedActive.rows[0]).toMatchObject({
      applied: false,
      stale: true,
    });
    const account = await db.query<{
      plan_code: string | null;
      entitlement_projection_event_id: string;
      entitlement_projection_priority: number;
    }>(
      `select plan_code, entitlement_projection_event_id,
              entitlement_projection_priority
       from billing_accounts where id = $1`,
      [SAME_SECOND_ACCOUNT_ID]
    );
    expect(account.rows).toEqual([
      {
        plan_code: null,
        entitlement_projection_event_id: "evt_a_cancelled",
        entitlement_projection_priority: 100,
      },
    ]);
  });

  it("keeps snapshot facts immutable and the projection RPC service-only", async () => {
    await apply(
      db,
      MINIMUM_ACCOUNT_ID,
      "evt_immutable",
      "2026-08-16T12:00:00.000Z",
      PRO
    );
    await expect(
      db.query(
        "delete from billing_entitlement_snapshots where account_id = $1",
        [MINIMUM_ACCOUNT_ID]
      )
    ).rejects.toThrow(/append-only/);
    const privileges = await db.query<{
      anon: boolean;
      authenticated: boolean;
      service_role: boolean;
    }>(
      `select
         has_function_privilege(
           'anon',
           'public.apply_billing_capacity_entitlement_snapshot(uuid,text,text,timestamp with time zone,jsonb)',
           'execute'
         ) as anon,
         has_function_privilege(
           'authenticated',
           'public.apply_billing_capacity_entitlement_snapshot(uuid,text,text,timestamp with time zone,jsonb)',
           'execute'
         ) as authenticated,
         has_function_privilege(
           'service_role',
           'public.apply_billing_capacity_entitlement_snapshot(uuid,text,text,timestamp with time zone,jsonb)',
           'execute'
         ) as service_role`
    );
    expect(privileges.rows).toEqual([
      { anon: false, authenticated: false, service_role: true },
    ]);
  });

  it("rejects malformed snapshots before changing the projection", async () => {
    await expect(
      apply(
        db,
        NEGATIVE_ACCOUNT_ID,
        "evt_malformed",
        "2026-08-16T12:00:00.000Z",
        {
          catalogVersion: "capacity_v2",
          subscriptionId: "sub_capacity",
          items: [],
        }
      )
    ).rejects.toThrow(/snapshot shape is invalid/);
    const state = await db.query<{
      entitlement_version: number;
      snapshots: number;
    }>(
      `select entitlement_version,
              (select count(*)::integer
               from billing_entitlement_snapshots
               where account_id = billing_accounts.id) as snapshots
       from billing_accounts where id = $1`,
      [NEGATIVE_ACCOUNT_ID]
    );
    expect(state.rows).toEqual([{ entitlement_version: 0, snapshots: 0 }]);
  });
});
