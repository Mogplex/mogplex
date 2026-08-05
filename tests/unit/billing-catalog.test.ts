import assert from "node:assert/strict";
import test from "node:test";
import {
  findPlanPrice,
  findTopupPreset,
  PLAN_PRICES,
  SANDBOX_RATE_MICRO_USD_PER_MINUTE,
  TOPUP_MAX_CENTS,
  TOPUP_MIN_CENTS,
  TOPUP_PRESETS,
} from "../../lib/billing/catalog";

// The signed-off numbers (PR #39 / pricing-plan 01): Pro $20/mo, Team
// $100/mo flat, 20% annual discount, monthly included usage equal to the
// monthly subscription price.

test("plan prices match the signed-off rate card", () => {
  assert.deepEqual(
    PLAN_PRICES.map((plan) => [plan.lookupKey, plan.amountCents]),
    [
      ["pro_monthly", 2000],
      ["pro_annual", 19200],
      ["team_monthly", 10000],
      ["team_annual", 96000],
    ]
  );
});

test("sandbox rate matches the published half-cent per minute", () => {
  assert.equal(SANDBOX_RATE_MICRO_USD_PER_MINUTE, 5_000);
});

test("annual plans are exactly 20% off 12x monthly", () => {
  const monthly = new Map(
    PLAN_PRICES.filter((plan) => plan.interval === "month").map((plan) => [
      plan.tier,
      plan.amountCents,
    ])
  );
  for (const plan of PLAN_PRICES.filter((p) => p.interval === "year")) {
    assert.equal(plan.amountCents, monthly.get(plan.tier)! * 12 * 0.8);
  }
});

test("included usage is granted monthly and matches the monthly price", () => {
  for (const plan of PLAN_PRICES) {
    const monthly = PLAN_PRICES.find(
      (p) => p.tier === plan.tier && p.interval === "month"
    )!;
    assert.equal(plan.includedUsageCents, monthly.amountCents);
  }
});

test("lookup keys are unique across plans and top-up presets", () => {
  const keys = [
    ...PLAN_PRICES.map((plan) => plan.lookupKey),
    ...TOPUP_PRESETS.map((preset) => preset.lookupKey),
  ];
  assert.equal(new Set(keys).size, keys.length);
});

test("top-up guardrails bracket the presets", () => {
  assert.equal(TOPUP_MIN_CENTS, 1000);
  assert.equal(TOPUP_MAX_CENTS, 500000);
  for (const preset of TOPUP_PRESETS) {
    assert.ok(preset.amountCents >= TOPUP_MIN_CENTS);
    assert.ok(preset.amountCents <= TOPUP_MAX_CENTS);
  }
});

test("finders return null for unknown keys", () => {
  assert.equal(findPlanPrice("pro_weekly"), null);
  assert.equal(findTopupPreset("topup_5"), null);
  assert.equal(findPlanPrice("pro_monthly")?.tier, "pro");
  assert.equal(findTopupPreset("topup_25")?.amountCents, 2500);
});
