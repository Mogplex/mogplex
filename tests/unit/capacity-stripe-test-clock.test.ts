import assert from "node:assert/strict";
import test from "node:test";
import {
  capacityStripeClockScenarios,
  runCapacityStripeTestClockCoverage,
  type CapacityStripeTestClockDeps,
} from "../../lib/billing/capacity-stripe-test-clock";

type RecordedCall = { name: string; scenario: string };

function fakeDeps(calls: RecordedCall[]): CapacityStripeTestClockDeps {
  let nextId = 0;
  return {
    async createClock(scenario, frozenAt) {
      calls.push({ name: `create-clock:${frozenAt}`, scenario });
      return `clock-${++nextId}`;
    },
    async deleteClock(_clockId, scenario) {
      calls.push({ name: "delete-clock", scenario });
    },
    async createCustomer(_clockId, scenario) {
      calls.push({ name: "create-customer", scenario });
      return `customer-${nextId}`;
    },
    async createSubscription(input) {
      calls.push({
        name: `subscribe:${input.lookupKey}`,
        scenario: input.scenario,
      });
      return {
        invoiceId: `invoice-${nextId}`,
      };
    },
    async advanceClock(input) {
      calls.push({
        name: `advance:${input.frozenAt}`,
        scenario: input.scenario,
      });
    },
    async useFailingPaymentMethod(_customerId, scenario) {
      calls.push({ name: "fail-next-payment", scenario });
    },
    async refundInvoice(_invoiceId, scenario) {
      calls.push({ name: "refund-invoice", scenario });
    },
    async captureEvents(input, action) {
      calls.push({
        name: `capture:${input.expectations.map((item) => item.type).join(",")}`,
        scenario: input.scenario,
      });
      const result = await action();
      return {
        result,
        eventTypes: input.expectations.map((item) => item.type),
      };
    },
  };
}

test("test-clock coverage enumerates every monthly and annual Individual plan", () => {
  const scenarios = capacityStripeClockScenarios();
  assert.deepEqual(
    scenarios.planRenewals.map((scenario) => scenario.lookupKey),
    [
      "capacity_v2_pro_monthly",
      "capacity_v2_pro_annual",
      "capacity_v2_plus_monthly",
      "capacity_v2_plus_annual",
      "capacity_v2_max_monthly",
      "capacity_v2_max_annual",
    ]
  );
  assert.equal(scenarios.failedRenewal.lookupKey, "capacity_v2_pro_monthly");
  assert.equal(scenarios.refund.lookupKey, "capacity_v2_pro_monthly");
});

test("test-clock coverage is event-driven, reports expected events, and cleans every clock", async () => {
  const calls: RecordedCall[] = [];
  const report = await runCapacityStripeTestClockCoverage({
    secretKey: "sk_test_capacity_clock",
    frozenAt: 1_800_000_000,
    deps: fakeDeps(calls),
  });

  assert.equal(report.mode, "test");
  assert.equal(report.scenarios.length, 8);
  assert.equal(
    report.scenarios.every((scenario) => scenario.status === "passed"),
    true
  );
  assert.deepEqual(report.scenarios.at(-2)?.eventTypes, [
    "test_helpers.test_clock.ready",
    "invoice.payment_failed",
  ]);
  assert.deepEqual(report.scenarios.at(-1)?.eventTypes, ["charge.refunded"]);

  const created = calls.filter((call) => call.name.startsWith("create-clock:"));
  const deleted = calls.filter((call) => call.name === "delete-clock");
  assert.equal(created.length, 8);
  assert.deepEqual(
    deleted.map((call) => call.scenario),
    created.map((call) => call.scenario)
  );
  assert.equal(
    calls.some((call) => /poll|sleep|retrieve-clock/.test(call.name)),
    false
  );
});

test("test-clock coverage refuses live and malformed keys before provider access", async () => {
  for (const secretKey of ["sk_live_forbidden", "rk_test_restricted", ""]) {
    const calls: RecordedCall[] = [];
    await assert.rejects(
      runCapacityStripeTestClockCoverage({
        secretKey,
        frozenAt: 1_800_000_000,
        deps: fakeDeps(calls),
      }),
      /Stripe test secret key/
    );
    assert.deepEqual(calls, []);
  }
});

test("test-clock coverage deletes its clock when a scenario fails", async () => {
  const calls: RecordedCall[] = [];
  const deps = fakeDeps(calls);
  deps.advanceClock = async (input) => {
    calls.push({ name: "advance-failed", scenario: input.scenario });
    throw new Error("provider failed");
  };

  await assert.rejects(
    runCapacityStripeTestClockCoverage({
      secretKey: "sk_test_capacity_clock",
      frozenAt: 1_800_000_000,
      deps,
    }),
    /provider failed/
  );
  assert.deepEqual(calls.at(-1), {
    name: "delete-clock",
    scenario: "plan-renewal:capacity_v2_pro_monthly",
  });
});
