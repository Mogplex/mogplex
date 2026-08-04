import assert from "node:assert/strict";
import test from "node:test";

async function loadCheckoutRoute() {
  return import("../../app/api/stripe/checkout/route");
}

test("subscribe should accept every catalog plan and reject unknown plans", async () => {
  const route = await loadCheckoutRoute();
  for (const plan of [
    "pro_monthly",
    "pro_annual",
    "team_monthly",
    "team_annual",
  ]) {
    assert.equal(
      route.validateCheckoutRequest({ kind: "subscribe", plan }).ok,
      true
    );
  }
  assert.equal(
    route.validateCheckoutRequest({ kind: "subscribe", plan: "enterprise" }).ok,
    false
  );
  assert.equal(route.validateCheckoutRequest({ kind: "subscribe" }).ok, false);
});

test("topup should reject custom amounts below the $10 minimum", async () => {
  const route = await loadCheckoutRoute();
  const result = route.validateCheckoutRequest({
    kind: "topup",
    amountCents: 999,
  });
  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /Minimum top-up/);
});

test("topup should reject custom amounts above the fraud sanity cap", async () => {
  const route = await loadCheckoutRoute();
  const result = route.validateCheckoutRequest({
    kind: "topup",
    amountCents: 500001,
  });
  assert.equal(result.ok, false);
});

test("topup should reject non-integer and non-numeric amounts", async () => {
  const route = await loadCheckoutRoute();
  assert.equal(
    route.validateCheckoutRequest({ kind: "topup", amountCents: 10.5 }).ok,
    false
  );
  assert.equal(
    route.validateCheckoutRequest({ kind: "topup", amountCents: "1000" }).ok,
    false
  );
});

test("topup should accept presets and valid custom amounts", async () => {
  const route = await loadCheckoutRoute();
  assert.equal(
    route.validateCheckoutRequest({ kind: "topup", preset: "topup_25" }).ok,
    true
  );
  assert.equal(
    route.validateCheckoutRequest({ kind: "topup", amountCents: 1000 }).ok,
    true
  );
  assert.equal(
    route.validateCheckoutRequest({ kind: "topup", amountCents: 500000 }).ok,
    true
  );
  assert.equal(
    route.validateCheckoutRequest({ kind: "topup", preset: "topup_5" }).ok,
    false
  );
});

test("unknown checkout kinds and malformed bodies should be rejected", async () => {
  const route = await loadCheckoutRoute();
  assert.equal(route.validateCheckoutRequest(null).ok, false);
  assert.equal(route.validateCheckoutRequest("subscribe").ok, false);
  assert.equal(route.validateCheckoutRequest({ kind: "gift-card" }).ok, false);
});
