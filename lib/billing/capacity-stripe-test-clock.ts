import {
  INDIVIDUAL_CAPACITY_PLANS,
  type CapacityPlanInterval,
} from "@/lib/billing/capacity-catalog";

export type CapacityStripeTestClockEventType =
  | "charge.refunded"
  | "invoice.paid"
  | "invoice.payment_failed"
  | "test_helpers.test_clock.ready";

export type CapacityStripeTestClockExpectation = {
  type: CapacityStripeTestClockEventType;
  clockId?: string;
  customerId?: string;
};

export type CapacityStripeTestClockDeps = {
  createClock: (scenario: string, frozenAt: number) => Promise<string>;
  deleteClock: (clockId: string, scenario: string) => Promise<void>;
  createCustomer: (clockId: string, scenario: string) => Promise<string>;
  createSubscription: (input: {
    customerId: string;
    lookupKey: string;
    scenario: string;
  }) => Promise<{ invoiceId: string }>;
  advanceClock: (input: {
    clockId: string;
    frozenAt: number;
    scenario: string;
  }) => Promise<void>;
  useFailingPaymentMethod: (
    customerId: string,
    scenario: string
  ) => Promise<void>;
  refundInvoice: (invoiceId: string, scenario: string) => Promise<void>;
  reportCleanupFailure: (input: {
    resource: "test_clock";
    scenario: string;
    error: unknown;
  }) => void;
  captureEvents: <T>(
    input: {
      expectations: readonly CapacityStripeTestClockExpectation[];
      scenario: string;
    },
    action: () => Promise<T>
  ) => Promise<{ result: T; eventTypes: CapacityStripeTestClockEventType[] }>;
};

type CapacityStripeClockScenario = {
  name: string;
  lookupKey: string;
  interval: CapacityPlanInterval;
  outcome: "renewal" | "failed_renewal" | "refund";
};

export type CapacityStripeTestClockReport = {
  mode: "test";
  scenarios: Array<{
    name: string;
    lookupKey: string;
    status: "passed";
    eventTypes: CapacityStripeTestClockEventType[];
  }>;
};

function individualPlanPrices(): CapacityStripeClockScenario[] {
  return Object.values(INDIVIDUAL_CAPACITY_PLANS).flatMap((plan) =>
    (["month", "year"] as const).map((interval) => ({
      name: `plan-renewal:${plan.prices[interval].lookupKey}`,
      lookupKey: plan.prices[interval].lookupKey,
      interval,
      outcome: "renewal" as const,
    }))
  );
}

export function capacityStripeClockScenarios(): {
  planRenewals: CapacityStripeClockScenario[];
  failedRenewal: CapacityStripeClockScenario;
  refund: CapacityStripeClockScenario;
} {
  const proMonthly = INDIVIDUAL_CAPACITY_PLANS.pro.prices.month;
  return {
    planRenewals: individualPlanPrices(),
    failedRenewal: {
      name: "failed-renewal:capacity_v2_pro_monthly",
      lookupKey: proMonthly.lookupKey,
      interval: proMonthly.interval,
      outcome: "failed_renewal",
    },
    refund: {
      name: "refund:capacity_v2_pro_monthly",
      lookupKey: proMonthly.lookupKey,
      interval: proMonthly.interval,
      outcome: "refund",
    },
  };
}

function assertTestSecretKey(secretKey: string) {
  if (!secretKey.startsWith("sk_test_") || secretKey.length <= 8) {
    throw new TypeError("A Stripe test secret key is required");
  }
}

function assertFrozenAt(frozenAt: number) {
  if (!Number.isSafeInteger(frozenAt) || frozenAt <= 0) {
    throw new RangeError("Stripe test clock frozen time is invalid");
  }
}

function nextBillingBoundary(
  frozenAt: number,
  interval: CapacityPlanInterval
): number {
  const date = new Date(frozenAt * 1_000);
  if (interval === "month") {
    date.setUTCMonth(date.getUTCMonth() + 1);
  } else {
    date.setUTCFullYear(date.getUTCFullYear() + 1);
  }
  return Math.floor(date.getTime() / 1_000) + 60;
}

function eventTypes(
  expectations: readonly CapacityStripeTestClockExpectation[]
): CapacityStripeTestClockEventType[] {
  return expectations.map((expectation) => expectation.type);
}

function assertCaptured(
  expected: readonly CapacityStripeTestClockExpectation[],
  actual: readonly CapacityStripeTestClockEventType[]
) {
  const required = eventTypes(expected);
  if (
    required.length !== actual.length ||
    required.some((type, index) => actual[index] !== type)
  ) {
    throw new Error("Stripe test clock did not emit the required events");
  }
}

async function createPaidSubscription(input: {
  clockId: string;
  customerId: string;
  lookupKey: string;
  scenario: string;
  deps: CapacityStripeTestClockDeps;
}): Promise<{ invoiceId: string }> {
  const expectations = [
    { type: "invoice.paid", customerId: input.customerId },
  ] as const;
  const captured = await input.deps.captureEvents(
    { expectations, scenario: input.scenario },
    () =>
      input.deps.createSubscription({
        customerId: input.customerId,
        lookupKey: input.lookupKey,
        scenario: input.scenario,
      })
  );
  assertCaptured(expectations, captured.eventTypes);
  return captured.result;
}

export async function runCapacityStripeTestResource<T>(input: {
  run: () => Promise<T>;
  cleanup: () => Promise<void>;
  reportCleanupFailure: (error: unknown) => void;
}): Promise<T> {
  let result: T | undefined;
  let runError: unknown;
  let runFailed = false;
  try {
    result = await input.run();
  } catch (error) {
    runFailed = true;
    runError = error;
  }
  let cleanupError: unknown;
  let cleanupFailed = false;
  try {
    await input.cleanup();
  } catch (error) {
    cleanupFailed = true;
    cleanupError = error;
    input.reportCleanupFailure(error);
  }
  if (runFailed) throw runError;
  if (cleanupFailed) throw cleanupError;
  return result as T;
}

async function withClock<T>(input: {
  scenario: string;
  frozenAt: number;
  deps: CapacityStripeTestClockDeps;
  run: (clockId: string, customerId: string) => Promise<T>;
}): Promise<T> {
  const clockId = await input.deps.createClock(input.scenario, input.frozenAt);
  return runCapacityStripeTestResource({
    async run() {
      const customerId = await input.deps.createCustomer(
        clockId,
        input.scenario
      );
      return input.run(clockId, customerId);
    },
    cleanup: () => input.deps.deleteClock(clockId, input.scenario),
    reportCleanupFailure: (error) =>
      input.deps.reportCleanupFailure({
        resource: "test_clock",
        scenario: input.scenario,
        error,
      }),
  });
}

async function runScenario(input: {
  scenario: CapacityStripeClockScenario;
  frozenAt: number;
  deps: CapacityStripeTestClockDeps;
}): Promise<CapacityStripeTestClockReport["scenarios"][number]> {
  return withClock({
    scenario: input.scenario.name,
    frozenAt: input.frozenAt,
    deps: input.deps,
    async run(clockId, customerId) {
      const paidSubscription = await createPaidSubscription({
        clockId,
        customerId,
        lookupKey: input.scenario.lookupKey,
        scenario: input.scenario.name,
        deps: input.deps,
      });
      if (input.scenario.outcome === "failed_renewal") {
        await input.deps.useFailingPaymentMethod(
          customerId,
          input.scenario.name
        );
      }
      const expectations: readonly CapacityStripeTestClockExpectation[] =
        input.scenario.outcome === "refund"
          ? [{ type: "charge.refunded", customerId }]
          : [
              { type: "test_helpers.test_clock.ready", clockId },
              {
                type:
                  input.scenario.outcome === "failed_renewal"
                    ? "invoice.payment_failed"
                    : "invoice.paid",
                customerId,
              },
            ];
      const captured = await input.deps.captureEvents(
        { expectations, scenario: input.scenario.name },
        input.scenario.outcome === "refund"
          ? () =>
              input.deps.refundInvoice(
                paidSubscription.invoiceId,
                input.scenario.name
              )
          : () =>
              input.deps.advanceClock({
                clockId,
                frozenAt: nextBillingBoundary(
                  input.frozenAt,
                  input.scenario.interval
                ),
                scenario: input.scenario.name,
              })
      );
      assertCaptured(expectations, captured.eventTypes);
      return {
        name: input.scenario.name,
        lookupKey: input.scenario.lookupKey,
        status: "passed",
        eventTypes: captured.eventTypes,
      };
    },
  });
}

export async function runCapacityStripeTestClockCoverage(input: {
  secretKey: string;
  frozenAt: number;
  deps: CapacityStripeTestClockDeps;
}): Promise<CapacityStripeTestClockReport> {
  assertTestSecretKey(input.secretKey);
  assertFrozenAt(input.frozenAt);
  const contract = capacityStripeClockScenarios();
  const scenarios: CapacityStripeTestClockReport["scenarios"] = [];
  for (const scenario of [
    ...contract.planRenewals,
    contract.failedRenewal,
    contract.refund,
  ]) {
    scenarios.push(
      await runScenario({
        scenario,
        frozenAt: input.frozenAt,
        deps: input.deps,
      })
    );
  }
  return { mode: "test", scenarios };
}
