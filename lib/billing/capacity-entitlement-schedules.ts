import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findCapacityAddOn } from "@/lib/billing/capacity-catalog";
import type { BillingAccount } from "@/lib/billing/accounts";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const CAPACITY_SCHEDULE_METADATA_VERSION = "capacity_schedule_v1";

export type CapacityScheduleIntent = {
  accountId: string;
  subscriptionId: string;
  subscriptionItemId: string;
  scheduleId?: string;
  lookupKey: string;
  priceId: string;
  currentQuantity: number;
  targetQuantity: number;
  effectiveAt: number;
  action: "decrease" | "cancel";
  attemptId: string;
};

export type CapacityScheduleProjectionResult = {
  applied: boolean;
  duplicate: boolean;
  stale: boolean;
  entitlementRecorded: boolean;
};

function positiveInteger(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`capacity schedule has invalid ${label}`);
  }
  return parsed;
}

function nonnegativeInteger(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`capacity schedule has invalid ${label}`);
  }
  return parsed;
}

function required(value: string | undefined, label: string): string {
  if (!value) throw new TypeError(`capacity schedule is missing ${label}`);
  return value;
}

export function capacityScheduleMetadata(
  intent: CapacityScheduleIntent
): Record<string, string> {
  return {
    mogplex_capacity_schedule: CAPACITY_SCHEDULE_METADATA_VERSION,
    billing_account_id: intent.accountId,
    subscription_id: intent.subscriptionId,
    subscription_item_id: intent.subscriptionItemId,
    lookup_key: intent.lookupKey,
    price_id: intent.priceId,
    current_quantity: String(intent.currentQuantity),
    target_quantity: String(intent.targetQuantity),
    effective_at: String(intent.effectiveAt),
    action: intent.action,
    attempt_id: intent.attemptId,
  };
}

export function parseCapacityScheduleIntent(
  schedule: Stripe.SubscriptionSchedule
): CapacityScheduleIntent | null {
  const metadata = schedule.metadata ?? {};
  if (
    metadata.mogplex_capacity_schedule !== CAPACITY_SCHEDULE_METADATA_VERSION
  ) {
    return null;
  }
  const action = metadata.action;
  if (action !== "decrease" && action !== "cancel") {
    throw new TypeError("capacity schedule has invalid action");
  }
  const currentQuantity = positiveInteger(
    metadata.current_quantity,
    "current quantity"
  );
  const targetQuantity = nonnegativeInteger(
    metadata.target_quantity,
    "target quantity"
  );
  if (
    targetQuantity >= currentQuantity ||
    (action === "cancel") !== (targetQuantity === 0)
  ) {
    throw new TypeError("capacity schedule quantity does not match its action");
  }
  const lookupKey = required(metadata.lookup_key, "lookup key");
  if (!findCapacityAddOn(lookupKey)) {
    throw new TypeError(`capacity schedule has unknown price ${lookupKey}`);
  }
  return {
    accountId: required(metadata.billing_account_id, "billing account"),
    subscriptionId: required(metadata.subscription_id, "subscription"),
    subscriptionItemId: required(
      metadata.subscription_item_id,
      "subscription item"
    ),
    scheduleId: schedule.id,
    lookupKey,
    priceId: required(metadata.price_id, "price"),
    currentQuantity,
    targetQuantity,
    effectiveAt: positiveInteger(metadata.effective_at, "effective time"),
    action,
    attemptId: required(metadata.attempt_id, "attempt"),
  };
}

function stripeId(value: string | { id: string } | null): string | null {
  return typeof value === "string" ? value : (value?.id ?? null);
}

function scheduleSubscriptionId(
  schedule: Stripe.SubscriptionSchedule
): string | null {
  return (
    stripeId(schedule.subscription) ?? schedule.released_subscription ?? null
  );
}

function priceId(value: string | Stripe.Price | Stripe.DeletedPrice): string {
  return typeof value === "string" ? value : value.id;
}

function phaseTargetQuantity(input: {
  phase: Stripe.SubscriptionSchedule.Phase;
  priceId: string;
}): number {
  const matches = input.phase.items.filter(
    (item) => priceId(item.price) === input.priceId
  );
  if (matches.length > 1) {
    throw new TypeError("capacity schedule contains a duplicate target price");
  }
  const quantity = matches[0]?.quantity ?? (matches.length === 1 ? 1 : 0);
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new TypeError("capacity schedule has an invalid target quantity");
  }
  return quantity;
}

function subscriptionTargetQuantity(input: {
  subscription: Stripe.Subscription;
  intent: CapacityScheduleIntent;
}): number {
  const byId = input.subscription.items.data.find(
    (item) => item.id === input.intent.subscriptionItemId
  );
  const byPrice = input.subscription.items.data.find(
    (item) => item.price.id === input.intent.priceId
  );
  const item = byId ?? byPrice;
  if (!item) return 0;
  const quantity = item.quantity ?? 1;
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new TypeError("capacity subscription has an invalid target quantity");
  }
  return quantity;
}

function projectedQuantity(input: {
  schedule: Stripe.SubscriptionSchedule;
  subscription: Stripe.Subscription;
  intent: CapacityScheduleIntent;
}): { quantity: number; priority: 0 | 50 | 100; state: string } {
  const { schedule, intent } = input;
  if (schedule.status === "canceled") {
    // Stripe cancels the schedule and its attached subscription immediately.
    // This is different from releasing a schedule, which leaves the
    // subscription running and requires us to project its current quantity.
    return { quantity: 0, priority: 100, state: "schedule_canceled" };
  }
  const intendedPhase = schedule.phases.find(
    (phase) => phase.start_date === intent.effectiveAt
  );
  if (intendedPhase) {
    const quantity = phaseTargetQuantity({
      phase: intendedPhase,
      priceId: intent.priceId,
    });
    if (quantity !== intent.targetQuantity) {
      throw new TypeError("capacity schedule target changed outside Mogplex");
    }
    return { quantity, priority: 0, state: "target_scheduled" };
  }
  const quantity = subscriptionTargetQuantity({
    subscription: input.subscription,
    intent,
  });
  if (
    quantity !== intent.currentQuantity &&
    quantity !== intent.targetQuantity
  ) {
    throw new TypeError("capacity schedule subscription state is unsupported");
  }
  return {
    quantity,
    priority: 50,
    state:
      schedule.status === "released" ? "schedule_released" : "target_removed",
  };
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(
      `capacity schedule projection returned invalid ${label}`
    );
  }
  return value;
}

export async function recordCapacityScheduleProjection(input: {
  accountId: string;
  subscriptionId: string;
  scheduleId: string;
  sourceEventId: string;
  providerEventCreatedAt: Date;
  eventPriority: 0 | 50 | 100;
  effectiveAt: Date;
  subscriptionItemId: string;
  lookupKey: string;
  quantity: number;
  state: string;
  attemptId: string;
  client?: SupabaseClient;
}): Promise<CapacityScheduleProjectionResult> {
  const addOn = findCapacityAddOn(input.lookupKey);
  if (!addOn) throw new TypeError(`unknown capacity add-on ${input.lookupKey}`);
  const client = input.client ?? supabaseAdmin;
  const { data, error } = await client.rpc(
    "record_billing_capacity_schedule_projection",
    {
      p_account: input.accountId,
      p_subscription_id: input.subscriptionId,
      p_schedule_id: input.scheduleId,
      p_source_event_id: input.sourceEventId,
      p_provider_event_created_at: input.providerEventCreatedAt.toISOString(),
      p_event_priority: input.eventPriority,
      p_effective_at: input.effectiveAt.toISOString(),
      p_item_ref: input.subscriptionItemId,
      p_item_kind:
        addOn.kind === "concurrency"
          ? "concurrency_addon"
          : "retained_data_addon",
      p_price_lookup_key: addOn.lookupKey,
      p_quantity: input.quantity,
      p_concurrency_delta: addOn.concurrencyDelta,
      p_retained_data_bytes_delta: addOn.retainedDataBytesDelta,
      p_metadata: {
        source: "stripe_subscription_schedule",
        state: input.state,
        attempt_id: input.attemptId,
      },
    }
  );
  if (error) {
    throw new Error(`capacity schedule projection failed: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<
    string,
    unknown
  > | null;
  if (!row) throw new Error("capacity schedule projection returned no result");
  return {
    applied: bool(row.applied, "applied"),
    duplicate: bool(row.duplicate, "duplicate"),
    stale: bool(row.stale, "stale"),
    entitlementRecorded: bool(row.entitlement_recorded, "entitlement recorded"),
  };
}

export async function projectCapacityScheduleEvent(input: {
  account: BillingAccount;
  schedule: Stripe.SubscriptionSchedule;
  subscription: Stripe.Subscription;
  sourceEventId: string;
  eventCreated: number;
  recordProjection?: typeof recordCapacityScheduleProjection;
}): Promise<boolean> {
  const intent = parseCapacityScheduleIntent(input.schedule);
  if (!intent) return false;
  if (intent.accountId !== input.account.id) {
    throw new TypeError("capacity schedule does not match its billing account");
  }
  if (
    intent.subscriptionId !== input.subscription.id ||
    (scheduleSubscriptionId(input.schedule) !== intent.subscriptionId &&
      !(
        input.schedule.status === "canceled" &&
        scheduleSubscriptionId(input.schedule) === null
      ))
  ) {
    throw new TypeError("capacity schedule does not match its subscription");
  }
  if (!Number.isSafeInteger(input.eventCreated) || input.eventCreated <= 0) {
    throw new TypeError("Stripe schedule event has an invalid timestamp");
  }
  const projection = projectedQuantity({
    schedule: input.schedule,
    subscription: input.subscription,
    intent,
  });
  const projectionEffectiveAt =
    input.schedule.status === "canceled"
      ? input.eventCreated
      : intent.effectiveAt;
  await (input.recordProjection ?? recordCapacityScheduleProjection)({
    accountId: intent.accountId,
    subscriptionId: intent.subscriptionId,
    scheduleId: input.schedule.id,
    sourceEventId: input.sourceEventId,
    providerEventCreatedAt: new Date(input.eventCreated * 1_000),
    eventPriority: projection.priority,
    // A canceled schedule cancels its subscription immediately. Other
    // lifecycle events still describe the original period-end boundary.
    effectiveAt: new Date(projectionEffectiveAt * 1_000),
    subscriptionItemId: intent.subscriptionItemId,
    lookupKey: intent.lookupKey,
    quantity: projection.quantity,
    state: projection.state,
    attemptId: intent.attemptId,
  });
  return true;
}
