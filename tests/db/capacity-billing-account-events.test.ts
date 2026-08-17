import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ACCOUNT_ID,
  USER_ID,
  CANCELLATION_ACCOUNT_ID,
  CANCELLATION_USER_ID,
  createBillingTestDb,
} from "./helpers/billing-ledger-fixtures";

type EventRow = {
  account_id: string;
  sequence: number | string;
  event_type: string;
  source_event_id: string;
  committed_at: Date;
};

let db: PGlite;

async function accountEvents(accountId: string): Promise<EventRow[]> {
  const result = await db.query<EventRow>(
    `select account_id, sequence, event_type, source_event_id, committed_at
     from billing_account_events
     where account_id = $1
     order by sequence`,
    [accountId]
  );
  return result.rows;
}

describe("capacity billing account events", () => {
  beforeAll(async () => {
    db = await createBillingTestDb();
    await db.query(
      `insert into billing_accounts (id, owner_type, owner_user_id)
       values ($1, 'user', $2), ($3, 'user', $4)`,
      [ACCOUNT_ID, USER_ID, CANCELLATION_ACCOUNT_ID, CANCELLATION_USER_ID]
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it("assigns an idempotent monotonic sequence within each account", async () => {
    const first = await db.query<{
      sequence: number | string;
      inserted: boolean;
    }>(
      `select * from append_billing_account_event(
         $1, 'billing.summary.changed', 'evt-one'
       )`,
      [ACCOUNT_ID]
    );
    const duplicate = await db.query<{
      sequence: number | string;
      inserted: boolean;
    }>(
      `select * from append_billing_account_event(
         $1, 'billing.summary.changed', 'evt-one'
       )`,
      [ACCOUNT_ID]
    );
    const secondType = await db.query<{
      sequence: number | string;
      inserted: boolean;
    }>(
      `select * from append_billing_account_event(
         $1, 'billing.capacity.change_applied', 'evt-one'
       )`,
      [ACCOUNT_ID]
    );
    const otherAccount = await db.query<{
      sequence: number | string;
      inserted: boolean;
    }>(
      `select * from append_billing_account_event(
         $1, 'billing.summary.changed', 'evt-other'
       )`,
      [CANCELLATION_ACCOUNT_ID]
    );

    expect(first.rows[0]).toMatchObject({ inserted: true });
    expect(Number(first.rows[0]!.sequence)).toBe(1);
    expect(duplicate.rows[0]).toMatchObject({ inserted: false });
    expect(Number(duplicate.rows[0]!.sequence)).toBe(1);
    expect(secondType.rows[0]).toMatchObject({ inserted: true });
    expect(Number(secondType.rows[0]!.sequence)).toBe(2);
    expect(Number(otherAccount.rows[0]!.sequence)).toBe(1);
  });

  it("publishes committed hosted-usage and entitlement changes", async () => {
    await db.query(
      `select post_credit_ledger_entry(
         $1, 1000, 'purchased', 'topup', 'topup:pi_1', null,
         '{"payment_intent":"pi_1"}'::jsonb
       )`,
      [ACCOUNT_ID]
    );
    await db.query(
      `select record_billing_entitlement_item(
         $1, 'si_current', 'concurrency_addon',
         'capacity_v2_concurrency_10_monthly', 1, 10, 0, 0,
         '2026-08-17T00:00:00.000Z', 'evt-current', '{}'::jsonb
       )`,
      [ACCOUNT_ID]
    );
    await db.query(
      `select record_billing_entitlement_item(
         $1, 'si_future', 'retained_data_addon',
         'capacity_v2_retained_data_1gb_monthly', 1, 0, 1000000000, 0,
         '2099-08-17T00:00:00.000Z', 'evt-future', '{}'::jsonb
       )`,
      [ACCOUNT_ID]
    );

    const rows = await accountEvents(ACCOUNT_ID);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "billing.hosted_usage.added",
          source_event_id: "topup:pi_1",
        }),
        expect.objectContaining({
          event_type: "billing.capacity.change_applied",
          source_event_id: "evt-current",
        }),
        expect.objectContaining({
          event_type: "billing.capacity.change_pending",
          source_event_id: "evt-future",
        }),
      ])
    );
    expect(rows.every((row) => row.committed_at instanceof Date)).toBe(true);
  });

  it("publishes summary changes for every customer-visible runtime fact", async () => {
    await db.query(
      `insert into billing_cost_reservations (
         account_id, reservation_ref, source_ref, operation_ref,
         reserved_micros, basis, basis_version, accounting_mode,
         balance_micros_before, open_reserved_micros_before,
         spendable_micros_before, would_admit, expires_at
       ) values (
         $1, 'reservation-1', 'reservation:open', 'operation-1',
         1000, '{}'::jsonb, 'capacity_v2', 'shadow',
         1000000, 0, 1000000, true, '2099-08-17T00:00:00Z'
       )`,
      [ACCOUNT_ID]
    );
    await db.query(
      `insert into billing_cost_reservation_terminal_events (
         reservation_id, terminal_kind, consumed_micros, source_ref, terminal_at
       ) select id, 'released', 0, 'reservation:closed', now()
         from billing_cost_reservations where reservation_ref = 'reservation-1'`
    );
    await db.query(
      `insert into billing_workflow_capacity_leases (
         account_id, lease_ref, source_ref, root_workflow_ref,
         accounting_mode, concurrency_limit, active_before, would_admit,
         acquired_at
       ) values (
         $1, 'lease-1', 'lease:open', 'workflow-1',
         'shadow', 5, 0, true, now()
       )`,
      [ACCOUNT_ID]
    );
    await db.query(
      `insert into billing_workflow_capacity_release_events (
         lease_id, terminal_outcome, source_ref, released_at
       ) select id, 'success', 'lease:closed', now()
         from billing_workflow_capacity_leases where lease_ref = 'lease-1'`
    );
    await db.query(
      `insert into billing_retained_data_events (
         account_id, resource_type, resource_ref, delta_bytes, source_ref,
         accounting_mode, retained_limit_bytes, logical_bytes_before,
         logical_bytes_after, would_admit, occurred_at
       ) values (
         $1, 'generated_artifact', 'artifact-1', 50, 'retained:1',
         'shadow', 1000, 0, 50, true, now()
       )`,
      [ACCOUNT_ID]
    );
    await db.query(
      `insert into billing_provider_cost_events (
         provider, provider_event_id, cost_source, account_id,
         provider_cost_micros, normalized_cost_micros, retail_debit_micros,
         billing_treatment, pricing_rule_version, operation_ref, occurred_at
       ) values (
         'vercel', 'invocation-1', 'vercel_function', $1,
         10, 10, 13, 'hosted_usage', 'capacity_v2', 'operation-1', now()
       )`,
      [ACCOUNT_ID]
    );

    const sources = (await accountEvents(ACCOUNT_ID))
      .filter((row) => row.event_type === "billing.summary.changed")
      .map((row) => row.source_event_id);
    expect(sources).toEqual(
      expect.arrayContaining([
        "reservation:open",
        "reservation:closed",
        "lease:open",
        "lease:closed",
        "retained:1",
        "vercel:invocation-1",
      ])
    );
  });

  it("publishes status and failed-capacity events for a past-due plan", async () => {
    await db.query(
      `update billing_accounts
       set plan_code = 'pro', plan_audience = 'individual',
           max_named_users = 1, included_concurrency = 5,
           included_retained_bytes = 1000000000
       where id = $1`,
      [ACCOUNT_ID]
    );
    await db.query(
      `update billing_accounts set status = 'past_due' where id = $1`,
      [ACCOUNT_ID]
    );

    await db.query(
      `update billing_accounts set status = 'active' where id = $1`,
      [ACCOUNT_ID]
    );
    await db.query(
      `update billing_accounts set status = 'past_due' where id = $1`,
      [ACCOUNT_ID]
    );

    const types = (await accountEvents(ACCOUNT_ID)).map(
      (row) => row.event_type
    );
    expect(
      types.filter((type) => type === "billing.account.status_changed")
    ).toHaveLength(3);
    expect(
      types.filter((type) => type === "billing.capacity.change_failed")
    ).toHaveLength(2);
  });

  it("delivers notifications only after the event transaction commits", async () => {
    const payloads: string[] = [];
    const unlisten = await db.listen(
      "mogplex_billing_account_events",
      (payload) => payloads.push(payload)
    );
    await db.exec("begin");
    await db.query(
      `select * from append_billing_account_event(
         $1, 'billing.summary.changed', 'evt-commit-boundary'
       )`,
      [CANCELLATION_ACCOUNT_ID]
    );
    expect(payloads).toEqual([]);
    await db.exec("commit");
    expect(payloads).toHaveLength(1);
    expect(JSON.parse(payloads[0]!)).toMatchObject({
      accountId: CANCELLATION_ACCOUNT_ID,
    });
    await unlisten();
  });

  it("keeps durable events immutable and readable only by the service role", async () => {
    await expect(
      db.query(
        `delete from billing_account_events
         where account_id = $1 and sequence = 1`,
        [ACCOUNT_ID]
      )
    ).rejects.toThrow(/append-only/);
    const privileges = await db.query<{
      anon: boolean;
      authenticated: boolean;
      service_role: boolean;
    }>(
      `select
         has_table_privilege('anon', 'billing_account_events', 'select') as anon,
         has_table_privilege(
           'authenticated', 'billing_account_events', 'select'
         ) as authenticated,
         has_table_privilege(
           'service_role', 'billing_account_events', 'select'
         ) as service_role`
    );
    expect(privileges.rows).toEqual([
      { anon: false, authenticated: false, service_role: true },
    ]);
  });
});
