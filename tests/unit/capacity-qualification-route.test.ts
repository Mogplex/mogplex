import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import { createCapacityQualificationGetHandler } from "../../app/api/cron/capacity-billing-qualification/route";
import type { CapacityBillingQualification } from "../../lib/billing/capacity-qualification";

const summary = {
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
  providerCosts: {
    events: 1,
    providerCostMicros: "1",
    customerCostMicros: "1",
    sharedOverheadMicros: "0",
    ownerlessEvents: 0,
    sourcesPresent: ["ai"],
  },
  reservations: { open: 0, expiredOpen: 0 },
  workflowLeases: { active: 0, terminal: 0 },
} satisfies CapacityBillingQualification;

test("capacity qualification remains machine-authenticated", async () => {
  const unauthorized = NextResponse.json(
    { error: "Unauthorized" },
    { status: 401 }
  );
  const handler = createCapacityQualificationGetHandler({
    requireMachineApiAuth: () => unauthorized,
    runQualification: async () => summary,
  });
  const response = await handler(new Request("https://mogplex.com/api/cron"));
  assert.equal(response, unauthorized);
});

test("capacity qualification returns conflict until checks pass", async () => {
  const handler = createCapacityQualificationGetHandler({
    requireMachineApiAuth: () => null,
    runQualification: async () => ({ ...summary, ok: false }),
  });
  const response = await handler(new Request("https://mogplex.com/api/cron"));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).ok, false);
});
