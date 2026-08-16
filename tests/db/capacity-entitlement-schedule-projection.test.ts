import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ACCOUNT_ID,
  USER_ID,
  createBillingTestDb,
} from "./helpers/billing-ledger-fixtures";

const EFFECTIVE_AT = "2099-09-16T00:00:00.000Z";

async function record(input: {
  eventId: string;
  createdAt: string;
  priority: 0 | 50 | 100;
  quantity: number;
}) {
  return db.query<{
    applied: boolean;
    duplicate: boolean;
    stale: boolean;
    entitlement_recorded: boolean;
  }>(
    `select * from record_billing_capacity_schedule_projection(
       $1, 'sub_schedule', 'sub_sched_1', $2, $3, $4, $5,
       'si_addon', 'concurrency_addon',
       'capacity_v2_concurrency_10_monthly', $6, 10, 0,
       '{"source":"stripe_schedule"}'::jsonb
     )`,
    [
      ACCOUNT_ID,
      input.eventId,
      input.createdAt,
      input.priority,
      EFFECTIVE_AT,
      input.quantity,
    ]
  );
}

let db: PGlite;

describe("capacity entitlement schedule projection", () => {
  beforeAll(async () => {
    db = await createBillingTestDb();
    await db.query(
      `insert into billing_accounts (
         id, owner_type, owner_user_id, stripe_subscription_id
       ) values ($1, 'user', $2, 'sub_schedule')`,
      [ACCOUNT_ID, USER_ID]
    );
    await db.query(
      `select record_billing_entitlement_item(
         $1, 'si_addon', 'concurrency_addon',
         'capacity_v2_concurrency_10_monthly', 3, 10, 0, 0,
         '2026-08-16T00:00:00.000Z', 'evt_current', '{}'::jsonb
       )`,
      [ACCOUNT_ID]
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it("records a future decrease without changing the current entitlement", async () => {
    const result = await record({
      eventId: "evt_schedule_target",
      createdAt: "2026-08-16T12:00:00.000Z",
      priority: 0,
      quantity: 1,
    });
    expect(result.rows).toEqual([
      {
        applied: true,
        duplicate: false,
        stale: false,
        entitlement_recorded: true,
      },
    ]);
    const current = await db.query<{ quantity: number }>(
      `select quantity from billing_current_entitlement_items
       where account_id = $1 and item_ref = 'si_addon'`,
      [ACCOUNT_ID]
    );
    expect(current.rows).toEqual([{ quantity: 3 }]);
    const future = await db.query<{
      quantity: number;
      effective_at: Date;
    }>(
      `select quantity, effective_at from billing_entitlement_items
       where account_id = $1 and source_event_id = 'evt_schedule_target'`,
      [ACCOUNT_ID]
    );
    expect(future.rows).toEqual([
      { quantity: 1, effective_at: new Date(EFFECTIVE_AT) },
    ]);
  });

  it("keeps a later release authoritative when delivery is reordered", async () => {
    const released = await record({
      eventId: "evt_released",
      createdAt: "2026-08-16T12:05:00.000Z",
      priority: 50,
      quantity: 3,
    });
    const older = await record({
      eventId: "evt_late_old_update",
      createdAt: "2026-08-16T12:01:00.000Z",
      priority: 0,
      quantity: 2,
    });
    expect(released.rows[0]).toMatchObject({ applied: true, stale: false });
    expect(older.rows[0]).toMatchObject({ applied: false, stale: true });
    const rows = await db.query<{ source_event_id: string }>(
      `select source_event_id from billing_entitlement_items
       where account_id = $1 and source_event_id = 'evt_late_old_update'`,
      [ACCOUNT_ID]
    );
    expect(rows.rows).toEqual([]);
  });

  it("uses lifecycle priority for events created in the same second", async () => {
    await record({
      eventId: "evt_z_update",
      createdAt: "2026-08-16T12:10:00.000Z",
      priority: 0,
      quantity: 1,
    });
    const cancelled = await record({
      eventId: "evt_a_cancelled",
      createdAt: "2026-08-16T12:10:00.000Z",
      priority: 100,
      quantity: 0,
    });
    expect(cancelled.rows[0]).toMatchObject({ applied: true, stale: false });
  });

  it("deduplicates an exact event and rejects conflicting reuse", async () => {
    const input = {
      eventId: "evt_duplicate",
      createdAt: "2026-08-16T12:20:00.000Z",
      priority: 50 as const,
      quantity: 3,
    };
    await record(input);
    const duplicate = await record(input);
    expect(duplicate.rows[0]).toMatchObject({
      applied: false,
      duplicate: true,
      stale: false,
    });
    await expect(record({ ...input, quantity: 2 })).rejects.toThrow(
      /idempotency conflict/
    );
  });

  it("keeps the event ledger immutable and service-only", async () => {
    await expect(
      db.query(
        `delete from billing_capacity_schedule_projections
         where account_id = $1`,
        [ACCOUNT_ID]
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
           'public.record_billing_capacity_schedule_projection(uuid,text,text,text,timestamp with time zone,smallint,timestamp with time zone,text,text,text,integer,integer,bigint,jsonb)',
           'execute'
         ) as anon,
         has_function_privilege(
           'authenticated',
           'public.record_billing_capacity_schedule_projection(uuid,text,text,text,timestamp with time zone,smallint,timestamp with time zone,text,text,text,integer,integer,bigint,jsonb)',
           'execute'
         ) as authenticated,
         has_function_privilege(
           'service_role',
           'public.record_billing_capacity_schedule_projection(uuid,text,text,text,timestamp with time zone,smallint,timestamp with time zone,text,text,text,integer,integer,bigint,jsonb)',
           'execute'
         ) as service_role`
    );
    expect(privileges.rows).toEqual([
      { anon: false, authenticated: false, service_role: true },
    ]);
  });
});
