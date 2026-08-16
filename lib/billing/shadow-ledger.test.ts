/* eslint-disable unicorn/prefer-bigint-literals -- The ES6 TypeScript target rejects BigInt literal syntax. */

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  recordShadowCapacityLease,
  recordShadowCapacityRelease,
  recordShadowCostReservation,
  recordShadowEntitlementItem,
  recordShadowProviderCost,
  recordShadowReservationTerminal,
  recordShadowRetainedData,
} from "./shadow-ledger";

type RpcCall = { name: string; args: Record<string, unknown> };

function rpcClient(results: unknown[] = [true]): {
  client: SupabaseClient;
  calls: RpcCall[];
} {
  const calls: RpcCall[] = [];
  let resultIndex = 0;
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return {
        data: results[Math.min(resultIndex++, results.length - 1)],
        error: null,
      };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const NOW = new Date("2026-08-16T12:00:00.000Z");

describe("shadow billing ledger RPC adapter", () => {
  it("records entitlement item versions with exact integer values", async () => {
    const { client, calls } = rpcClient();
    await expect(
      recordShadowEntitlementItem(
        {
          accountId: "account-1",
          itemRef: "item-1",
          itemKind: "concurrency_addon",
          priceLookupKey: "capacity_v2_concurrency_10_monthly",
          quantity: 2,
          concurrencyDelta: 20,
          retainedDataBytesDelta: BigInt(0),
          hostedUsageCentsDelta: BigInt(0),
          effectiveAt: NOW,
          sourceEventId: "evt-1",
        },
        client
      )
    ).resolves.toEqual({ posted: true });
    expect(calls[0]).toMatchObject({
      name: "record_billing_entitlement_item",
      args: {
        p_quantity: 2,
        p_retained_data_bytes_delta: "0",
        p_effective_at: NOW.toISOString(),
      },
    });
  });

  it("records customer and shared-overhead provider costs", async () => {
    const { client, calls } = rpcClient([true, false]);
    await recordShadowProviderCost(
      {
        provider: "trigger.dev",
        providerEventId: "run-1",
        costSource: "trigger",
        owner: { accountId: "account-1" },
        providerCostMicros: BigInt(8),
        normalizedCostMicros: BigInt(8),
        retailDebitMicros: BigInt(10),
        billingTreatment: "hosted_usage",
        pricingRuleVersion: "capacity_v2",
        occurredAt: NOW,
        refs: { rootWorkflowRef: "workflow-1" },
      },
      client
    );
    await expect(
      recordShadowProviderCost(
        {
          provider: "vercel",
          providerEventId: "maintenance-1",
          costSource: "vercel_function",
          owner: { sharedOverheadCategory: "platform_operations" },
          providerCostMicros: BigInt(4),
          normalizedCostMicros: BigInt(4),
          retailDebitMicros: BigInt(0),
          billingTreatment: "shared_overhead",
          pricingRuleVersion: "capacity_v2",
          occurredAt: NOW,
        },
        client
      )
    ).resolves.toEqual({ posted: false });

    expect(calls[0]?.args).toMatchObject({
      p_account: "account-1",
      p_shared_overhead_category: null,
      p_provider_cost_micros: "8",
      p_refs: { rootWorkflowRef: "workflow-1" },
    });
    expect(calls[1]?.args).toMatchObject({
      p_account: null,
      p_shared_overhead_category: "platform_operations",
    });
  });

  it("returns exact shadow reservation decisions and records settlement", async () => {
    const { client, calls } = rpcClient([
      [
        {
          posted: true,
          would_admit: false,
          balance_micros: "1000000",
          open_reserved_micros: "600000",
          spendable_micros: "400000",
        },
      ],
      true,
    ]);
    await expect(
      recordShadowCostReservation(
        {
          accountId: "account-1",
          reservationRef: "reservation-1",
          sourceRef: "reserve:1",
          operationRef: "operation-1",
          rootWorkflowRef: "workflow-1",
          reservedMicros: BigInt(500_000),
          basis: { bound: "approved" },
          basisVersion: "capacity_v2",
          expiresAt: NOW,
        },
        client
      )
    ).resolves.toEqual({
      posted: true,
      wouldAdmit: false,
      balanceMicros: BigInt(1_000_000),
      openReservedMicros: BigInt(600_000),
      spendableMicros: BigInt(400_000),
    });
    await expect(
      recordShadowReservationTerminal(
        {
          reservationRef: "reservation-1",
          terminalKind: "settled",
          consumedMicros: BigInt(450_000),
          sourceRef: "settle:1",
          terminalAt: NOW,
        },
        client
      )
    ).resolves.toEqual({ posted: true });

    expect(calls[0]?.args).toMatchObject({
      p_reserved_micros: "500000",
      p_root_workflow_ref: "workflow-1",
      p_basis: { bound: "approved" },
    });
    expect(calls[1]?.args).toMatchObject({
      p_terminal_kind: "settled",
      p_consumed_micros: "450000",
    });
  });

  it("returns capacity and retained-data shadow decisions", async () => {
    const { client, calls } = rpcClient([
      [
        {
          posted: true,
          would_admit: true,
          active_before: 1,
          concurrency_limit: 5,
        },
      ],
      false,
      [
        {
          posted: true,
          would_admit: false,
          logical_bytes: "1100000000",
          retained_limit_bytes: "1000000000",
        },
      ],
    ]);
    await expect(
      recordShadowCapacityLease(
        {
          accountId: "account-1",
          leaseRef: "lease-1",
          sourceRef: "acquire:1",
          rootWorkflowRef: "workflow-1",
          acquiredAt: NOW,
        },
        client
      )
    ).resolves.toEqual({
      posted: true,
      wouldAdmit: true,
      activeBefore: 1,
      concurrencyLimit: 5,
    });
    await expect(
      recordShadowCapacityRelease(
        {
          leaseRef: "lease-1",
          terminalOutcome: "failure",
          sourceRef: "release:1",
          releasedAt: NOW,
        },
        client
      )
    ).resolves.toEqual({ posted: false });
    await expect(
      recordShadowRetainedData(
        {
          accountId: "account-1",
          resourceType: "generated_artifact",
          resourceRef: "artifact-1",
          deltaBytes: BigInt(100_000_000),
          sourceRef: "retained:1",
          occurredAt: NOW,
        },
        client
      )
    ).resolves.toEqual({
      posted: true,
      wouldAdmit: false,
      logicalBytes: BigInt(1_100_000_000),
      retainedLimitBytes: BigInt(1_000_000_000),
    });

    expect(calls.map((call) => call.name)).toEqual([
      "record_billing_shadow_capacity_lease",
      "record_billing_capacity_release",
      "record_billing_shadow_retained_data_event",
    ]);
  });

  it("rejects malformed exact-integer RPC results", async () => {
    const { client } = rpcClient([
      [
        {
          posted: true,
          would_admit: true,
          balance_micros: "not-an-integer",
          open_reserved_micros: "0",
          spendable_micros: "0",
        },
      ],
    ]);
    await expect(
      recordShadowCostReservation(
        {
          accountId: "account-1",
          reservationRef: "reservation-1",
          sourceRef: "reserve:1",
          operationRef: "operation-1",
          reservedMicros: BigInt(1),
          basis: {},
          basisVersion: "capacity_v2",
          expiresAt: NOW,
        },
        client
      )
    ).rejects.toThrow(/shadow balance returned an invalid integer/);
  });

  it("surfaces RPC failures with the operation name", async () => {
    const client = {
      rpc: async () => ({ data: null, error: { message: "database offline" } }),
    } as unknown as SupabaseClient;
    await expect(
      recordShadowEntitlementItem(
        {
          accountId: "account-1",
          itemRef: "item-1",
          itemKind: "retained_data_addon",
          priceLookupKey: "capacity_v2_retained_data_1gb_monthly",
          quantity: 1,
          concurrencyDelta: 0,
          retainedDataBytesDelta: BigInt(1_000_000_000),
          hostedUsageCentsDelta: BigInt(0),
          effectiveAt: NOW,
          sourceEventId: "evt-1",
        },
        client
      )
    ).rejects.toThrow("shadow entitlement item failed: database offline");
  });
});
