import { logger, metadata, task } from "@trigger.dev/sdk/v3";
import {
  applyCapacityAnnualGrantSchedule,
  cancelCapacityAnnualGrantSchedule,
  capacityAnnualSubscriptionIsCurrent,
  getCapacityAnnualGrantSchedule,
  nextCapacityAnnualGrantOccurrence,
  reconcileCapacityAnnualGrantSchedule,
  retrieveCapacityAnnualGrantSubscription,
  type AppliedCapacityAnnualGrant,
} from "@/lib/billing/capacity-annual-grants";
import { areCapacityBillingOperationsEnabled } from "@/lib/billing/stripe";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";

type CapacityAnnualGrantTaskDeps = {
  operationsEnabled: typeof areCapacityBillingOperationsEnabled;
  getSchedule: typeof getCapacityAnnualGrantSchedule;
  retrieveSubscription: typeof retrieveCapacityAnnualGrantSubscription;
  subscriptionIsCurrent: typeof capacityAnnualSubscriptionIsCurrent;
  cancelSchedule: typeof cancelCapacityAnnualGrantSchedule;
  applySchedule: typeof applyCapacityAnnualGrantSchedule;
  reconcileSchedule: typeof reconcileCapacityAnnualGrantSchedule;
  metadata: Pick<typeof metadata, "set">;
  logger: Pick<typeof logger, "log">;
};

const defaultDeps: CapacityAnnualGrantTaskDeps = {
  operationsEnabled: areCapacityBillingOperationsEnabled,
  getSchedule: getCapacityAnnualGrantSchedule,
  retrieveSubscription: retrieveCapacityAnnualGrantSubscription,
  subscriptionIsCurrent: capacityAnnualSubscriptionIsCurrent,
  cancelSchedule: cancelCapacityAnnualGrantSchedule,
  applySchedule: applyCapacityAnnualGrantSchedule,
  reconcileSchedule: reconcileCapacityAnnualGrantSchedule,
  metadata,
  logger,
};

async function loadCurrentSchedule(
  scheduleId: string,
  deps: CapacityAnnualGrantTaskDeps
) {
  const schedule = await deps.getSchedule(scheduleId);
  if (schedule.status === "cancel_pending" || schedule.status === "cancelled") {
    return null;
  }
  const subscription = await deps.retrieveSubscription(
    schedule.stripe_subscription_id
  );
  if (deps.subscriptionIsCurrent(schedule, subscription)) return schedule;
  await deps.cancelSchedule(schedule.id);
  return null;
}

export type CapacityAnnualGrantTaskResult = {
  disabled: boolean;
  cancelled: boolean;
  applied: AppliedCapacityAnnualGrant | null;
  nextScheduleDueAt: string | null;
};

export async function runCapacityAnnualIncludedUsageGrant(
  payload: { scheduleId: string },
  overrides: Partial<CapacityAnnualGrantTaskDeps> = {}
): Promise<CapacityAnnualGrantTaskResult> {
  const deps = { ...defaultDeps, ...overrides };
  if (!deps.operationsEnabled()) {
    return {
      disabled: true,
      cancelled: false,
      applied: null,
      nextScheduleDueAt: null,
    };
  }

  const schedule = await loadCurrentSchedule(payload.scheduleId, deps);
  if (!schedule) {
    return {
      disabled: false,
      cancelled: true,
      applied: null,
      nextScheduleDueAt: null,
    };
  }

  const applied = await deps.applySchedule(schedule.id);
  const nextOccurrence = applied.eligible
    ? nextCapacityAnnualGrantOccurrence({
        cycleStartedAt: applied.cycleStartedAt,
        currentOffset: applied.occurrence.offset,
      })
    : null;
  if (nextOccurrence) {
    await deps.reconcileSchedule({
      accountId: applied.accountId,
      keepEntitlementVersion: applied.entitlementVersion,
      desired: {
        accountId: applied.accountId,
        subscriptionId: applied.subscriptionId,
        entitlementVersion: applied.entitlementVersion,
        priceLookupKey: applied.priceLookupKey,
        includedUsageCents: applied.includedUsageCents,
        cycleStartedAt: applied.cycleStartedAt,
        occurrence: nextOccurrence,
        sourceEventId: applied.sourceEventId,
      },
    });
  }

  deps.metadata.set("billingAccountId", applied.accountId);
  deps.metadata.set("grantPeriod", applied.occurrence.period);
  deps.metadata.set("grantPosted", applied.posted);
  deps.metadata.set("grantDuplicate", applied.duplicate);
  deps.metadata.set("grantCancelled", applied.cancelled);
  deps.metadata.set(
    "nextScheduleDueAt",
    nextOccurrence?.dueAt.toISOString() ?? null
  );
  const result = {
    disabled: false,
    cancelled: applied.cancelled,
    applied,
    nextScheduleDueAt: nextOccurrence?.dueAt.toISOString() ?? null,
  };
  deps.logger.log("Processed capacity annual included-usage grant", result);
  return result;
}

export const capacityAnnualIncludedUsageGrantTask = task({
  id: TRIGGER_TASK_IDS.capacityAnnualIncludedUsageGrant,
  maxDuration: 300,
  retry: {
    maxAttempts: 5,
    factor: 2,
    minTimeoutInMs: 1_000,
    maxTimeoutInMs: 30_000,
    randomize: true,
  },
  run: async (payload: { scheduleId: string }) =>
    runCapacityAnnualIncludedUsageGrant(payload),
});
