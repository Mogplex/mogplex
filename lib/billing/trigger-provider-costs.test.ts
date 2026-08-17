/* eslint-disable unicorn/prefer-bigint-literals -- The ES6 TypeScript target rejects BigInt literal syntax. */

import { describe, expect, it } from "vitest";
import { buildTriggerProviderCostEvent } from "./trigger-provider-costs";

const accountId = "0198f3e8-9c41-4d40-8cb9-4afdfac76f01";

describe("Trigger.dev provider cost attribution", () => {
  it("attributes customer workflow compute and applies the hosted-usage factor", () => {
    const event = buildTriggerProviderCostEvent({
      runId: "run_customer",
      taskIdentifier: "execute-automation-job",
      billingAccountId: accountId,
      rootWorkflowRef: "job-1",
      totalCostInCents: 1.25,
      durationMs: 60_000,
      occurredAt: new Date("2026-08-17T15:00:00Z"),
    });
    expect(event).toMatchObject({
      owner: { accountId },
      providerEventId: "run_customer",
      providerCostMicros: BigInt(12_500),
      normalizedCostMicros: BigInt(12_500),
      retailDebitMicros: BigInt(15_625),
      billingTreatment: "hosted_usage",
      measuredQuantity: "60000",
      refs: { runRef: "run_customer", rootWorkflowRef: "job-1" },
    });
  });

  it("keeps maintenance and unowned runs in explicit shared overhead", () => {
    const event = buildTriggerProviderCostEvent({
      runId: "run_maintenance",
      taskIdentifier: "sandbox-reaper",
      totalCostInCents: 0.003,
      durationMs: 100,
      occurredAt: new Date("2026-08-17T15:00:00Z"),
    });
    expect(event).toMatchObject({
      owner: { sharedOverheadCategory: "platform_operations" },
      providerCostMicros: BigInt(30),
      retailDebitMicros: BigInt(0),
      billingTreatment: "shared_overhead",
    });
  });
});
