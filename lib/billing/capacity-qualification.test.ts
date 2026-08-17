import { describe, expect, it, vi } from "vitest";
import { runCapacityBillingQualification } from "./capacity-qualification";

function database(row: Record<string, unknown>) {
  return {
    query: vi.fn(async () => ({ rows: [row] })),
  };
}

const healthyRow = {
  account_count: "1",
  paying_account_count: "1",
  paying_accounts_without_plan: "0",
  provider_event_count: "8",
  provider_cost_micros: "4000000",
  customer_cost_micros: "3000000",
  shared_overhead_micros: "1000000",
  ownerless_provider_events: "0",
  cost_sources_present: ["ai", "trigger", "vercel_function"],
  open_reservation_count: "0",
  expired_open_reservations: "0",
  active_lease_count: "0",
  terminal_workflow_leases: "0",
};

describe("capacity billing qualification", () => {
  it("passes only when production accounting invariants are represented", async () => {
    const result = await runCapacityBillingQualification(
      database(healthyRow) as never,
      new Date("2026-08-17T15:00:00Z")
    );
    expect(result).toMatchObject({
      ok: true,
      asOf: "2026-08-17T15:00:00.000Z",
      checks: {
        hasBillingAccounts: true,
        entitlementsBackfilled: true,
        providerLedgerPopulated: true,
        providerOwnershipComplete: true,
        noExpiredOpenReservations: true,
        noTerminalWorkflowLeases: true,
      },
      accounts: { total: 1, paying: 1, payingWithoutPlan: 0 },
    });
  });

  it("fails closed for an empty ledger and incomplete paid-account backfill", async () => {
    const result = await runCapacityBillingQualification(
      database({
        ...healthyRow,
        paying_accounts_without_plan: "1",
        provider_event_count: "0",
      }) as never
    );
    expect(result.ok).toBe(false);
    expect(result.checks.entitlementsBackfilled).toBe(false);
    expect(result.checks.providerLedgerPopulated).toBe(false);
  });
});
