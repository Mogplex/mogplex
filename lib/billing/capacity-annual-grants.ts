import type Stripe from "stripe";
import {
  firstFutureCapacityAnnualGrantOccurrence,
  parseAnnualGrantDate,
  requireAnnualGrantText,
  type CapacityAnnualGrantSchedule,
  type CapacityAnnualGrantScheduleInput,
} from "@/lib/billing/capacity-annual-grant-model";
import {
  bindCapacityAnnualGrantRuntimeRun,
  finalizeCapacityAnnualGrantCancellation,
  findOrCreateCapacityAnnualGrantSchedule,
  requestCapacityAnnualGrantCancellations,
} from "@/lib/billing/capacity-annual-grant-store";
import { getStripe } from "@/lib/billing/stripe";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";

export * from "@/lib/billing/capacity-annual-grant-model";
export * from "@/lib/billing/capacity-annual-grant-store";

type ReconcileDeps = {
  requestCancellations: typeof requestCapacityAnnualGrantCancellations;
  cancelRun: (runId: string) => Promise<void>;
  finalizeCancellation: typeof finalizeCapacityAnnualGrantCancellation;
  findOrCreateSchedule: typeof findOrCreateCapacityAnnualGrantSchedule;
  enqueueSchedule: (schedule: CapacityAnnualGrantSchedule) => Promise<string>;
  bindRuntimeRun: typeof bindCapacityAnnualGrantRuntimeRun;
};

export function capacityAnnualSubscriptionIsCurrent(
  schedule: CapacityAnnualGrantSchedule,
  subscription: Stripe.Subscription
): boolean {
  if (
    subscription.id !== schedule.stripe_subscription_id ||
    subscription.status !== "active"
  ) {
    return false;
  }
  return subscription.items.data.some(
    (item) => item.price.lookup_key === schedule.price_lookup_key
  );
}

async function enqueueCapacityAnnualGrantSchedule(
  schedule: CapacityAnnualGrantSchedule
): Promise<string> {
  const { idempotencyKeys, tasks } = await import("@trigger.dev/sdk/v3");
  const idempotencyKey = await idempotencyKeys.create(
    `capacity-annual-grant:${schedule.id}`,
    { scope: "global" }
  );
  const handle = await tasks.trigger(
    TRIGGER_TASK_IDS.capacityAnnualIncludedUsageGrant,
    { scheduleId: schedule.id },
    {
      delay: parseAnnualGrantDate(schedule.due_at, "annual grant due time"),
      idempotencyKey,
      tags: [
        `billing-account:${schedule.account_id}`,
        `stripe-subscription:${schedule.stripe_subscription_id}`,
      ],
      metadata: {
        billingAccountId: schedule.account_id,
        stripeSubscriptionId: schedule.stripe_subscription_id,
        grantPeriod: schedule.grant_period,
      },
    }
  );
  return requireAnnualGrantText(handle.id, "annual grant Trigger.dev run id");
}

async function cancelCapacityAnnualGrantRun(runId: string): Promise<void> {
  const { runs } = await import("@trigger.dev/sdk/v3");
  await runs.cancel(runId);
}

const defaultReconcileDeps: ReconcileDeps = {
  requestCancellations: requestCapacityAnnualGrantCancellations,
  cancelRun: cancelCapacityAnnualGrantRun,
  finalizeCancellation: finalizeCapacityAnnualGrantCancellation,
  findOrCreateSchedule: findOrCreateCapacityAnnualGrantSchedule,
  enqueueSchedule: enqueueCapacityAnnualGrantSchedule,
  bindRuntimeRun: bindCapacityAnnualGrantRuntimeRun,
};

async function cancelSupersededSchedules(
  schedules: CapacityAnnualGrantSchedule[],
  deps: ReconcileDeps
): Promise<void> {
  for (const schedule of schedules) {
    if (schedule.runtime_run_id) {
      await deps.cancelRun(schedule.runtime_run_id);
    }
    await deps.finalizeCancellation(schedule.id);
  }
}

export async function reconcileCapacityAnnualGrantSchedule(
  input: {
    accountId: string;
    keepEntitlementVersion: number | null;
    desired: CapacityAnnualGrantScheduleInput | null;
  },
  overrides: Partial<ReconcileDeps> = {}
): Promise<CapacityAnnualGrantSchedule | null> {
  const deps = { ...defaultReconcileDeps, ...overrides };
  const cancellations = await deps.requestCancellations(
    input.accountId,
    input.keepEntitlementVersion
  );
  await cancelSupersededSchedules(cancellations, deps);
  if (!input.desired) return null;
  if (input.desired.accountId !== input.accountId) {
    throw new TypeError("annual grant reconciliation account does not match");
  }
  if (input.keepEntitlementVersion !== input.desired.entitlementVersion) {
    throw new TypeError("annual grant reconciliation version does not match");
  }
  const schedule = await deps.findOrCreateSchedule(input.desired);
  if (schedule.runtime_run_id || schedule.status !== "pending") return schedule;
  const runtimeRunId = await deps.enqueueSchedule(schedule);
  const bound = await deps.bindRuntimeRun(schedule.id, runtimeRunId);
  if (bound.status !== "pending") {
    await deps.cancelRun(runtimeRunId);
  }
  return bound;
}

export function capacityAnnualGrantScheduleInput(input: {
  accountId: string;
  subscription: Stripe.Subscription;
  entitlementVersion: number;
  priceLookupKey: string;
  includedUsageCents: number;
  sourceEventId: string;
  eventCreatedAt: Date;
}): CapacityAnnualGrantScheduleInput | null {
  const item = input.subscription.items.data.find(
    (candidate) => candidate.price.lookup_key === input.priceLookupKey
  );
  const cycleStartedAtSeconds = item?.current_period_start ?? Number.NaN;
  if (!Number.isSafeInteger(cycleStartedAtSeconds)) {
    throw new TypeError("annual capacity plan is missing its cycle start");
  }
  const cycleStartedAt = new Date(cycleStartedAtSeconds * 1_000);
  const occurrence = firstFutureCapacityAnnualGrantOccurrence(
    cycleStartedAt,
    input.eventCreatedAt
  );
  if (!occurrence) return null;
  return {
    accountId: input.accountId,
    subscriptionId: input.subscription.id,
    entitlementVersion: input.entitlementVersion,
    priceLookupKey: input.priceLookupKey,
    includedUsageCents: input.includedUsageCents,
    cycleStartedAt,
    occurrence,
    sourceEventId: input.sourceEventId,
  };
}

export async function retrieveCapacityAnnualGrantSubscription(
  subscriptionId: string
): Promise<Stripe.Subscription> {
  return getStripe().subscriptions.retrieve(subscriptionId);
}
