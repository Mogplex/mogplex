import type Stripe from "stripe";
import type { BillingAccount } from "@/lib/billing/accounts";
import {
  capacityChangeIdempotencyKey,
  verifyCapacityChangePreview,
  type CapacityChangePreviewTokenPayload,
} from "@/lib/billing/capacity-change-contract";
import {
  capacityScheduleMetadata,
  parseCapacityScheduleIntent,
  type CapacityScheduleIntent,
} from "@/lib/billing/capacity-entitlement-schedules";
import {
  CapacityChangeError,
  addOnAllowance,
  assertAccountCanChangeCapacity,
  assertCanonicalTargetPrice,
  resolveCapacitySubscription,
  type ResolvedSubscription,
} from "@/lib/billing/capacity-stripe-change-state";
import { assertCapacityBillingOperationsEnabled } from "@/lib/billing/capacity-stripe-changes";
import {
  areCapacityBillingOperationsEnabled,
  getStripe,
} from "@/lib/billing/stripe";
import { resolveCatalogPriceId } from "@/lib/billing/stripe-checkout";
import { supabaseAdmin } from "@/lib/supabase/admin";

/* eslint-disable max-lines -- Stripe schedule updates require exhaustive phase-field preservation */
/* eslint-disable unicorn/prefer-bigint-literals -- the project TypeScript target predates bigint literal syntax */

type SchedulePhaseParam = Stripe.SubscriptionScheduleUpdateParams.Phase;
type ScheduleItemParam = Stripe.SubscriptionScheduleUpdateParams.Phase.Item;

export type CapacityStripeScheduleDeps = {
  capacityBillingOperationsEnabled: () => boolean;
  now: () => Date;
  retrieveSubscription: (id: string) => Promise<Stripe.Subscription>;
  resolvePriceId: (lookupKey: string) => Promise<string>;
  loadRetainedLogicalBytes: (accountId: string) => Promise<bigint>;
  createSchedule: (
    params: Stripe.SubscriptionScheduleCreateParams,
    options: Stripe.RequestOptions
  ) => Promise<Stripe.SubscriptionSchedule>;
  retrieveSchedule: (id: string) => Promise<Stripe.SubscriptionSchedule>;
  updateSchedule: (
    id: string,
    params: Stripe.SubscriptionScheduleUpdateParams,
    options: Stripe.RequestOptions
  ) => Promise<Stripe.SubscriptionSchedule>;
};

function idOf(value: string | { id: string }, label: string): string {
  if (typeof value === "string") return value;
  if (!value?.id) throw new TypeError(`Stripe ${label} is missing an id`);
  return value.id;
}

function optionalId(
  value: string | { id: string } | null | undefined,
  label: string
): string | undefined {
  return value == null ? undefined : idOf(value, label);
}

function discountParam(
  discount: Stripe.SubscriptionSchedule.Phase.Discount
): Stripe.SubscriptionScheduleUpdateParams.Phase.Discount {
  const candidates = [
    ["coupon", discount.coupon],
    ["discount", discount.discount],
    ["promotion_code", discount.promotion_code],
  ] as const;
  const present = candidates.filter(([, value]) => value !== null);
  if (present.length !== 1) {
    throw new CapacityChangeError(
      "This subscription discount cannot be scheduled safely",
      409,
      "schedule_unsupported"
    );
  }
  const [key, value] = present[0]!;
  return { [key]: idOf(value!, key) };
}

function itemDiscountParam(
  discount: Stripe.SubscriptionSchedule.Phase.Item.Discount
): Stripe.SubscriptionScheduleUpdateParams.Phase.Item.Discount {
  return discountParam(discount as Stripe.SubscriptionSchedule.Phase.Discount);
}

function invoiceSettingsParam(
  settings: Stripe.SubscriptionSchedule.Phase.InvoiceSettings | null
): SchedulePhaseParam["invoice_settings"] {
  if (!settings) return undefined;
  const issuer = settings.issuer
    ? {
        type: settings.issuer.type,
        ...(settings.issuer.account
          ? { account: idOf(settings.issuer.account, "invoice issuer") }
          : {}),
      }
    : undefined;
  return {
    ...(settings.account_tax_ids
      ? {
          account_tax_ids: settings.account_tax_ids.map((value) =>
            idOf(value, "account tax id")
          ),
        }
      : {}),
    ...(settings.custom_fields
      ? { custom_fields: settings.custom_fields.map((field) => ({ ...field })) }
      : {}),
    ...(settings.days_until_due == null
      ? {}
      : { days_until_due: settings.days_until_due }),
    ...(settings.description == null
      ? {}
      : { description: settings.description }),
    ...(settings.footer == null ? {} : { footer: settings.footer }),
    ...(issuer ? { issuer } : {}),
  };
}

function automaticTaxParam(
  automaticTax: Stripe.SubscriptionSchedule.Phase.AutomaticTax | undefined
): SchedulePhaseParam["automatic_tax"] {
  if (!automaticTax) return undefined;
  const liability = automaticTax.liability
    ? {
        type: automaticTax.liability.type,
        ...(automaticTax.liability.account
          ? {
              account: idOf(
                automaticTax.liability.account,
                "automatic tax liability"
              ),
            }
          : {}),
      }
    : undefined;
  return {
    enabled: automaticTax.enabled,
    ...(liability ? { liability } : {}),
  };
}

function itemParam(
  item: Stripe.SubscriptionSchedule.Phase.Item
): ScheduleItemParam {
  return {
    price: idOf(item.price, "schedule item price"),
    ...(item.quantity == null ? {} : { quantity: item.quantity }),
    ...(item.billing_thresholds?.usage_gte == null
      ? {}
      : {
          billing_thresholds: {
            usage_gte: item.billing_thresholds.usage_gte,
          },
        }),
    discounts: item.discounts.map(itemDiscountParam),
    ...(item.metadata ? { metadata: { ...item.metadata } } : {}),
    ...(item.tax_rates
      ? {
          tax_rates: item.tax_rates.map((rate) =>
            idOf(rate, "schedule item tax rate")
          ),
        }
      : {}),
  };
}

function transferDataParam(
  transfer: Stripe.SubscriptionSchedule.Phase.TransferData | null
): SchedulePhaseParam["transfer_data"] {
  if (!transfer) return undefined;
  return {
    destination: idOf(transfer.destination, "transfer destination"),
    ...(transfer.amount_percent == null
      ? {}
      : { amount_percent: transfer.amount_percent }),
  };
}

function copyPhaseConfiguration(
  phase: Stripe.SubscriptionSchedule.Phase
): Omit<SchedulePhaseParam, "items" | "start_date" | "end_date"> {
  const automaticTax = automaticTaxParam(phase.automatic_tax);
  const invoiceSettings = invoiceSettingsParam(phase.invoice_settings);
  const transferData = transferDataParam(phase.transfer_data);
  return {
    // Non-empty phase invoice items are rejected before translation because
    // carrying them into another phase could bill them again.
    add_invoice_items: [],
    ...(phase.application_fee_percent == null
      ? {}
      : { application_fee_percent: phase.application_fee_percent }),
    ...(automaticTax ? { automatic_tax: automaticTax } : {}),
    ...(phase.billing_cycle_anchor == null
      ? {}
      : { billing_cycle_anchor: phase.billing_cycle_anchor }),
    ...(phase.billing_thresholds?.amount_gte == null &&
    phase.billing_thresholds?.reset_billing_cycle_anchor == null
      ? {}
      : {
          billing_thresholds: {
            ...(phase.billing_thresholds?.amount_gte == null
              ? {}
              : { amount_gte: phase.billing_thresholds.amount_gte }),
            ...(phase.billing_thresholds?.reset_billing_cycle_anchor == null
              ? {}
              : {
                  reset_billing_cycle_anchor:
                    phase.billing_thresholds.reset_billing_cycle_anchor,
                }),
          },
        }),
    ...(phase.collection_method == null
      ? {}
      : { collection_method: phase.collection_method }),
    currency: phase.currency,
    ...(phase.default_payment_method
      ? {
          default_payment_method: idOf(
            phase.default_payment_method,
            "default payment method"
          ),
        }
      : {}),
    ...(phase.default_tax_rates
      ? {
          default_tax_rates: phase.default_tax_rates.map((rate) =>
            idOf(rate, "default tax rate")
          ),
        }
      : {}),
    ...(phase.description == null ? {} : { description: phase.description }),
    discounts: phase.discounts.map(discountParam),
    ...(invoiceSettings ? { invoice_settings: invoiceSettings } : {}),
    ...(phase.metadata ? { metadata: { ...phase.metadata } } : {}),
    ...(phase.on_behalf_of
      ? { on_behalf_of: idOf(phase.on_behalf_of, "on behalf of account") }
      : {}),
    proration_behavior: phase.proration_behavior,
    ...(transferData ? { transfer_data: transferData } : {}),
    ...(phase.trial == null ? {} : { trial: phase.trial }),
  };
}

function assertCurrentPhaseCanBeExtended(
  phase: Stripe.SubscriptionSchedule.Phase
) {
  if (
    phase.add_invoice_items.length > 0 ||
    phase.trial === true ||
    phase.trial_end != null
  ) {
    throw new CapacityChangeError(
      "This subscription has billing terms that require support to change",
      409,
      "schedule_unsupported"
    );
  }
}

function phasePriceId(item: Stripe.SubscriptionSchedule.Phase.Item): string {
  return idOf(item.price, "schedule item price");
}

function desiredFutureItems(input: {
  currentPhase: Stripe.SubscriptionSchedule.Phase;
  priceId: string;
  currentQuantity: number;
  targetQuantity: number;
}): ScheduleItemParam[] {
  let matches = 0;
  const result: ScheduleItemParam[] = [];
  for (const item of input.currentPhase.items) {
    if (phasePriceId(item) !== input.priceId) {
      result.push(itemParam(item));
      continue;
    }
    matches += 1;
    const quantity = item.quantity ?? 1;
    if (quantity !== input.currentQuantity) {
      throw new CapacityChangeError(
        "Capacity changed after this preview. Review the current price again.",
        409,
        "preview_stale"
      );
    }
    if (input.targetQuantity > 0) {
      result.push({ ...itemParam(item), quantity: input.targetQuantity });
    }
  }
  if (matches !== 1) {
    throw new CapacityChangeError(
      "The billing schedule does not match this capacity item",
      409,
      "invalid_subscription"
    );
  }
  return result;
}

export function buildPeriodEndScheduleUpdate(input: {
  schedule: Stripe.SubscriptionSchedule;
  intent: CapacityScheduleIntent;
}): Stripe.SubscriptionScheduleUpdateParams {
  const { schedule, intent } = input;
  if (schedule.status !== "active" || !schedule.current_phase) {
    throw new CapacityChangeError(
      "The billing schedule is not active",
      409,
      "schedule_inactive"
    );
  }
  if (schedule.current_phase.end_date !== intent.effectiveAt) {
    throw new CapacityChangeError(
      "The billing period changed after this preview",
      409,
      "preview_stale"
    );
  }
  const currentPhase = schedule.phases.find(
    (phase) =>
      phase.start_date === schedule.current_phase!.start_date &&
      phase.end_date === schedule.current_phase!.end_date
  );
  if (!currentPhase) {
    throw new CapacityChangeError(
      "Stripe did not return the current billing phase",
      409,
      "invalid_subscription"
    );
  }
  assertCurrentPhaseCanBeExtended(currentPhase);
  const futureItems = desiredFutureItems({
    currentPhase,
    priceId: intent.priceId,
    currentQuantity: intent.currentQuantity,
    targetQuantity: intent.targetQuantity,
  });
  const configuration = copyPhaseConfiguration(currentPhase);
  return {
    end_behavior: "release",
    metadata: capacityScheduleMetadata(intent),
    proration_behavior: "none",
    phases: [
      {
        ...configuration,
        start_date: currentPhase.start_date,
        end_date: intent.effectiveAt,
        items: currentPhase.items.map(itemParam),
      },
      {
        ...configuration,
        add_invoice_items: [],
        trial: false,
        trial_end: undefined,
        start_date: intent.effectiveAt,
        proration_behavior: "none",
        items: futureItems,
      },
    ],
  };
}

/* v8 ignore start -- live Supabase and Stripe adapters are exercised through injected deps */
async function loadRetainedLogicalBytes(accountId: string): Promise<bigint> {
  const { data, error } = await supabaseAdmin
    .from("billing_retained_data_totals")
    .select("logical_bytes")
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) {
    throw new Error(`retained data lookup failed: ${error.message}`);
  }
  const value = (data as { logical_bytes?: number | string } | null)
    ?.logical_bytes;
  if (value == null) return BigInt(0);
  const bytes = BigInt(value);
  if (bytes < BigInt(0)) throw new TypeError("retained data total is invalid");
  return bytes;
}

export function defaultCapacityStripeScheduleDeps(): CapacityStripeScheduleDeps {
  assertCapacityBillingOperationsEnabled({
    capacityBillingOperationsEnabled: areCapacityBillingOperationsEnabled,
  });
  const stripe = getStripe();
  return {
    capacityBillingOperationsEnabled: areCapacityBillingOperationsEnabled,
    now: () => new Date(),
    retrieveSubscription: (id) =>
      stripe.subscriptions.retrieve(id, {
        expand: ["items.data.price"],
      }),
    resolvePriceId: (lookupKey) => resolveCatalogPriceId(lookupKey),
    loadRetainedLogicalBytes,
    createSchedule: (params, options) =>
      stripe.subscriptionSchedules.create(params, options),
    retrieveSchedule: (id) =>
      stripe.subscriptionSchedules.retrieve(id, {
        expand: [
          "phases.items.price",
          "phases.discounts",
          "phases.items.discounts",
        ],
      }),
    updateSchedule: (id, params, options) =>
      stripe.subscriptionSchedules.update(id, params, options),
  };
}
/* v8 ignore stop */

function verifiedDecreasePayload(input: {
  account: BillingAccount;
  token: string;
  secret: string;
  nowSeconds: number;
}): CapacityChangePreviewTokenPayload & { action: "decrease" | "cancel" } {
  let payload: CapacityChangePreviewTokenPayload;
  try {
    payload = verifyCapacityChangePreview({
      token: input.token,
      secret: input.secret,
      nowSeconds: input.nowSeconds,
    });
  } catch (error) {
    const expired = error instanceof RangeError;
    throw new CapacityChangeError(
      expired
        ? "The capacity preview has expired. Review the price again."
        : "The capacity preview is invalid",
      409,
      expired ? "preview_expired" : "preview_invalid"
    );
  }
  if (
    payload.accountId !== input.account.id ||
    payload.subscriptionId !== input.account.stripe_subscription_id
  ) {
    throw new CapacityChangeError(
      "The capacity preview does not belong to this billing account",
      403,
      "preview_scope_mismatch"
    );
  }
  if (payload.action !== "decrease" && payload.action !== "cancel") {
    throw new CapacityChangeError(
      "Use checkout for a capacity increase",
      409,
      "checkout_required"
    );
  }
  return payload as CapacityChangePreviewTokenPayload & {
    action: "decrease" | "cancel";
  };
}

function assertPreviewMatchesCurrent(input: {
  resolved: ResolvedSubscription;
  payload: CapacityChangePreviewTokenPayload;
}) {
  const targetItemId = input.resolved.targetItem?.id ?? null;
  if (
    input.payload.targetQuantity >= input.payload.currentQuantity ||
    targetItemId !== input.payload.subscriptionItemId ||
    input.resolved.currentQuantity !== input.payload.currentQuantity
  ) {
    throw new CapacityChangeError(
      "Capacity changed after this preview. Review the current price again.",
      409,
      "preview_stale"
    );
  }
}

function subscriptionScheduleId(subscription: Stripe.Subscription) {
  return optionalId(subscription.schedule, "subscription schedule");
}

function sameIntent(
  schedule: Stripe.SubscriptionSchedule,
  expected: CapacityScheduleIntent
): boolean {
  const actual = parseCapacityScheduleIntent(schedule);
  return Boolean(
    actual?.accountId === expected.accountId &&
    actual.subscriptionId === expected.subscriptionId &&
    actual.subscriptionItemId === expected.subscriptionItemId &&
    actual.lookupKey === expected.lookupKey &&
    actual.priceId === expected.priceId &&
    actual.currentQuantity === expected.currentQuantity &&
    actual.targetQuantity === expected.targetQuantity &&
    actual.effectiveAt === expected.effectiveAt &&
    actual.action === expected.action &&
    actual.attemptId === expected.attemptId
  );
}

function scheduleAlreadyApplied(input: {
  schedule: Stripe.SubscriptionSchedule;
  intent: CapacityScheduleIntent;
}): boolean {
  if (
    input.schedule.phases.length !== 2 ||
    input.schedule.end_behavior !== "release"
  ) {
    return false;
  }
  const current = input.schedule.phases.find(
    (phase) =>
      phase.start_date === input.schedule.current_phase?.start_date &&
      phase.end_date === input.intent.effectiveAt
  );
  const target = input.schedule.phases.find(
    (phase) => phase.start_date === input.intent.effectiveAt
  );
  if (current?.items == null || target?.proration_behavior !== "none") {
    return false;
  }

  const quantities = (phase: Stripe.SubscriptionSchedule.Phase) => {
    const values = new Map<string, number>();
    for (const item of phase.items) {
      const id = phasePriceId(item);
      if (values.has(id)) return null;
      values.set(id, item.quantity ?? 1);
    }
    return values;
  };
  const expected = quantities(current);
  const actual = quantities(target);
  if (!expected || !actual) return false;
  if (input.intent.targetQuantity === 0) expected.delete(input.intent.priceId);
  else expected.set(input.intent.priceId, input.intent.targetQuantity);
  if (expected.size !== actual.size) return false;
  return [...expected].every(([id, quantity]) => actual.get(id) === quantity);
}

async function assertRetainedDecreaseIsSafe(input: {
  accountId: string;
  resolved: ResolvedSubscription;
  targetQuantity: number;
  deps: CapacityStripeScheduleDeps;
}) {
  if (input.resolved.targetAddOn.kind !== "retained_data") return;
  const used = await input.deps.loadRetainedLogicalBytes(input.accountId);
  const resulting =
    input.resolved.currentAllowance -
    addOnAllowance(input.resolved.targetAddOn, input.resolved.currentQuantity) +
    addOnAllowance(input.resolved.targetAddOn, input.targetQuantity);
  if (used > resulting) {
    throw new CapacityChangeError(
      "Delete stored data before reducing this Storage allowance",
      409,
      "retained_data_in_use"
    );
  }
}

export async function scheduleCapacityDecrease(input: {
  account: BillingAccount;
  previewToken: string;
  attemptId: string;
  signingSecret: string;
  deps?: CapacityStripeScheduleDeps;
}) {
  assertAccountCanChangeCapacity(input.account);
  const deps = input.deps ?? defaultCapacityStripeScheduleDeps();
  assertCapacityBillingOperationsEnabled(deps);
  const nowSeconds = Math.floor(deps.now().getTime() / 1_000);
  const payload = verifiedDecreasePayload({
    account: input.account,
    token: input.previewToken,
    secret: input.signingSecret,
    nowSeconds,
  });
  const subscription = await deps.retrieveSubscription(payload.subscriptionId);
  const resolved = resolveCapacitySubscription({
    account: input.account,
    subscription,
    lookupKey: payload.lookupKey,
  });
  assertPreviewMatchesCurrent({ resolved, payload });
  const canonicalPriceId = await deps.resolvePriceId(payload.lookupKey);
  assertCanonicalTargetPrice(resolved, canonicalPriceId);
  await assertRetainedDecreaseIsSafe({
    accountId: input.account.id,
    resolved,
    targetQuantity: payload.targetQuantity,
    deps,
  });
  const effectiveAt = resolved.targetItem!.current_period_end;
  if (
    !Number.isSafeInteger(effectiveAt) ||
    effectiveAt <= nowSeconds ||
    effectiveAt !== payload.effectiveAt
  ) {
    throw new CapacityChangeError(
      "The billing period changed after this preview",
      409,
      "preview_stale"
    );
  }
  const intent: CapacityScheduleIntent = {
    accountId: input.account.id,
    subscriptionId: subscription.id,
    subscriptionItemId: resolved.targetItem!.id,
    lookupKey: payload.lookupKey,
    priceId: canonicalPriceId,
    currentQuantity: payload.currentQuantity,
    targetQuantity: payload.targetQuantity,
    effectiveAt,
    action: payload.action,
    attemptId: input.attemptId,
  };
  const baseKey = capacityChangeIdempotencyKey(
    input.account.id,
    input.attemptId
  );
  const existingScheduleId = subscriptionScheduleId(subscription);
  let schedule = existingScheduleId
    ? await deps.retrieveSchedule(existingScheduleId)
    : await deps.createSchedule(
        {
          from_subscription: subscription.id,
          metadata: capacityScheduleMetadata(intent),
        },
        { idempotencyKey: `${baseKey}:schedule-create` }
      );
  if (!sameIntent(schedule, intent)) {
    throw new CapacityChangeError(
      "Another subscription change is already scheduled",
      409,
      "change_pending"
    );
  }
  if (!scheduleAlreadyApplied({ schedule, intent })) {
    if (schedule.phases.length !== 1) {
      throw new CapacityChangeError(
        "Another subscription change is already scheduled",
        409,
        "change_pending"
      );
    }
    schedule = await deps.updateSchedule(
      schedule.id,
      buildPeriodEndScheduleUpdate({ schedule, intent }),
      { idempotencyKey: `${baseKey}:schedule-update` }
    );
  }
  if (
    !sameIntent(schedule, intent) ||
    !scheduleAlreadyApplied({ schedule, intent })
  ) {
    throw new CapacityChangeError(
      "Stripe did not confirm the scheduled capacity change",
      502,
      "schedule_unconfirmed"
    );
  }
  return {
    status: "scheduled" as const,
    subscriptionId: subscription.id,
    scheduleId: schedule.id,
    action: payload.action,
    resultingQuantity: payload.targetQuantity,
    effectiveAt: new Date(effectiveAt * 1_000).toISOString(),
    prorationBehavior: "none" as const,
    entitlementStatus: "pending_webhook" as const,
  };
}
