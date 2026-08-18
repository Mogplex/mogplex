import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";

async function loadRoute() {
  return import("../../app/api/cron/capacity-stripe-catalog/route");
}

test("catalog sync authenticates before reading Stripe configuration", async () => {
  const { createCapacityStripeCatalogPostHandler } = await loadRoute();
  let touched = false;
  const handler = createCapacityStripeCatalogPostHandler({
    requireMachineApiAuth: () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    capacityBillingStripeMode: () => {
      touched = true;
      return "live";
    },
  });

  const response = await handler(
    new Request("https://mogplex.com/api/cron/capacity-stripe-catalog", {
      method: "POST",
    })
  );

  assert.equal(response.status, 401);
  assert.equal(touched, false);
});

test("catalog sync is a successful no-op while live writes are disabled", async () => {
  const { createCapacityStripeCatalogPostHandler } = await loadRoute();
  let synced = false;
  const handler = createCapacityStripeCatalogPostHandler({
    requireMachineApiAuth: () => null,
    capacityBillingStripeMode: () => null,
    syncCatalog: async () => {
      synced = true;
      throw new Error("should not sync");
    },
  });

  const response = await handler(
    new Request("https://mogplex.com/api/cron/capacity-stripe-catalog", {
      method: "POST",
    })
  );

  assert.equal(response.status, 200);
  assert.equal(synced, false);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "skipped",
    reason: "live_capacity_billing_disabled",
  });
});

test("catalog sync reconciles Stripe in live mode", async () => {
  const { createCapacityStripeCatalogPostHandler } = await loadRoute();
  const handler = createCapacityStripeCatalogPostHandler({
    requireMachineApiAuth: () => null,
    capacityBillingStripeMode: () => "live",
    syncCatalog: async () => ({
      productsCreated: 0,
      productsUpdated: 2,
      productsReused: 8,
      pricesCreated: 0,
      pricesReused: 16,
    }),
  });

  const response = await handler(
    new Request("https://mogplex.com/api/cron/capacity-stripe-catalog", {
      method: "POST",
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "synced",
    mode: "live",
    productsCreated: 0,
    productsUpdated: 2,
    productsReused: 8,
    pricesCreated: 0,
    pricesReused: 16,
  });
});
