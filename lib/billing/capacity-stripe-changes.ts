import type Stripe from "stripe";
import type { BillingAccount } from "@/lib/billing/accounts";
import type { CapacityAddOn } from "@/lib/billing/capacity-catalog";
import {
  CAPACITY_PREVIEW_TTL_SECONDS,
  signCapacityChangePreview,
  type CapacityChangeAction,
  type CapacityChangePreviewRequest,
} from "@/lib/billing/capacity-change-contract";
import {
  areCapacityBillingOperationsEnabled,
  getStripe,
} from "@/lib/billing/stripe";
import { resolveCatalogPriceId } from "@/lib/billing/stripe-checkout";
import {
  CapacityChangeError,
  addOnAllowance,
  assertAccountCanChangeCapacity,
  assertCanonicalTargetPrice,
  resolveCapacitySubscription,
  type ResolvedSubscription,
} from "@/lib/billing/capacity-stripe-change-state";
import {
  canIncreaseCapacityAddOn,
  isCapacityBillingPilotAccount,
} from "@/lib/billing/capacity-purchase-policy";

export { CapacityChangeError } from "@/lib/billing/capacity-stripe-change-state";

export type CapacityStripeChangeDeps = {
  capacityBillingOperationsEnabled: () => boolean;
  capacityBillingPilotAccount: (accountId: string) => boolean;
  now: () => Date;
  retrieveSubscription: (id: string) => Promise<Stripe.Subscription>;
  resolvePriceId: (lookupKey: string) => Promise<string>;
  createInvoicePreview: (
    params: Stripe.InvoiceCreatePreviewParams
  ) => Promise<Stripe.Invoice>;
  updateSubscription: (
    id: string,
    params: Stripe.SubscriptionUpdateParams,
    options: Stripe.RequestOptions
  ) => Promise<Stripe.Subscription>;
};

function assertCapacityIncreaseAllowed(input: {
  accountId: string;
  action: CapacityChangeAction;
  addOn: CapacityAddOn;
  pilotAccount: boolean;
}) {
  if (
    input.action === "increase" &&
    !canIncreaseCapacityAddOn({
      accountId: input.accountId,
      addOn: input.addOn,
      pilotAccount: input.pilotAccount,
    })
  ) {
    throw new CapacityChangeError(
      "Reserved concurrency purchases are available only to billing pilot accounts",
      403,
      "pilot_required"
    );
  }
}

export type CapacityChangePreview = {
  resource: "concurrency" | "retained_data";
  lookupKey: string;
  name: string;
  action: CapacityChangeAction;
  currentQuantity: number;
  resultingQuantity: number;
  currentAllowance: string;
  resultingAllowance: string;
  currentRecurringAmountCents: number;
  resultingRecurringAmountCents: number;
  recurringChangeCents: number;
  amountDueNowCents: number;
  currency: "usd";
  taxStatus: "calculated" | "not_calculated" | "not_applicable";
  effectiveAt: string;
  effectiveTiming: "after_payment" | "period_end";
  previewToken: string;
  expiresAt: string;
};

export function defaultCapacityStripeChangeDeps(): CapacityStripeChangeDeps {
  assertCapacityBillingOperationsEnabled({
    capacityBillingOperationsEnabled: areCapacityBillingOperationsEnabled,
  });
  const stripe = getStripe();
  return {
    capacityBillingOperationsEnabled: areCapacityBillingOperationsEnabled,
    capacityBillingPilotAccount: isCapacityBillingPilotAccount,
    now: () => new Date(),
    retrieveSubscription: (id) =>
      stripe.subscriptions.retrieve(id, {
        expand: ["items.data.price", "latest_invoice.confirmation_secret"],
      }),
    resolvePriceId: (lookupKey) => resolveCatalogPriceId(lookupKey),
    createInvoicePreview: (params) => stripe.invoices.createPreview(params),
    updateSubscription: (id, params, options) =>
      stripe.subscriptions.update(id, params, options),
  };
}

export function assertCapacityBillingOperationsEnabled(
  deps: Pick<CapacityStripeChangeDeps, "capacityBillingOperationsEnabled">
) {
  if (!deps.capacityBillingOperationsEnabled()) {
    throw new CapacityChangeError(
      "Capacity billing operations are disabled",
      503,
      "operations_disabled"
    );
  }
}

function derivedAction(
  currentQuantity: number,
  targetQuantity: number
): CapacityChangeAction | null {
  if (targetQuantity > currentQuantity) return "increase";
  if (targetQuantity === 0 && currentQuantity > 0) return "cancel";
  if (targetQuantity < currentQuantity) return "decrease";
  return null;
}

function safeMoney(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new CapacityChangeError(
      `${label} exceeds the supported amount`,
      400,
      "quantity_too_large"
    );
  }
  return value;
}

function itemPeriodEnd(item: Stripe.SubscriptionItem | null): number {
  const value = item?.current_period_end;
  if (!Number.isSafeInteger(value) || value! <= 0) {
    throw new CapacityChangeError(
      "The capacity add-on is missing its billing-period end",
      409,
      "invalid_subscription"
    );
  }
  return value!;
}

function isProration(line: Stripe.InvoiceLineItem): boolean {
  return (
    line.parent?.subscription_item_details?.proration === true ||
    line.parent?.invoice_item_details?.proration === true
  );
}

function dueNow(preview: Stripe.Invoice): {
  amountCents: number;
  taxStatus: CapacityChangePreview["taxStatus"];
} {
  let amountCents = 0;
  for (const line of preview.lines.data) {
    if (!isProration(line)) continue;
    amountCents = safeMoney(amountCents + line.amount, "Capacity proration");
    for (const tax of line.taxes ?? []) {
      if (tax.tax_behavior === "exclusive") {
        amountCents = safeMoney(
          amountCents + tax.amount,
          "Capacity proration tax"
        );
      }
    }
  }
  return {
    amountCents: Math.max(0, amountCents),
    taxStatus:
      preview.automatic_tax.enabled &&
      preview.automatic_tax.status === "complete"
        ? "calculated"
        : "not_calculated",
  };
}

function previewItem(input: {
  resolved: ResolvedSubscription;
  priceId: string;
  quantity: number;
}): Stripe.InvoiceCreatePreviewParams.SubscriptionDetails.Item {
  const { targetItem } = input.resolved;
  return targetItem
    ? { id: targetItem.id, quantity: input.quantity }
    : { price: input.priceId, quantity: input.quantity };
}

export async function previewCapacityChange(input: {
  account: BillingAccount;
  request: CapacityChangePreviewRequest;
  signingSecret: string;
  deps?: CapacityStripeChangeDeps;
}): Promise<CapacityChangePreview> {
  assertAccountCanChangeCapacity(input.account);
  const deps = input.deps ?? defaultCapacityStripeChangeDeps();
  assertCapacityBillingOperationsEnabled(deps);
  const subscription = await deps.retrieveSubscription(
    input.account.stripe_subscription_id!
  );
  const resolved = resolveCapacitySubscription({
    account: input.account,
    subscription,
    lookupKey: input.request.lookupKey,
  });
  const action = derivedAction(
    resolved.currentQuantity,
    input.request.quantity
  );
  if (!action) {
    throw new CapacityChangeError(
      "Choose a different capacity quantity",
      409,
      "quantity_unchanged"
    );
  }
  if (action !== input.request.effectiveAction) {
    throw new CapacityChangeError(
      "The requested action does not match the capacity quantity",
      409,
      "action_mismatch"
    );
  }
  assertCapacityIncreaseAllowed({
    accountId: input.account.id,
    action,
    addOn: resolved.targetAddOn,
    pilotAccount: deps.capacityBillingPilotAccount(input.account.id),
  });

  // Reject unsafe quantities before making a provider request.
  const currentRecurringAmountCents = safeMoney(
    resolved.targetAddOn.amountCents * resolved.currentQuantity,
    "Current recurring amount"
  );
  const resultingRecurringAmountCents = safeMoney(
    resolved.targetAddOn.amountCents * input.request.quantity,
    "Resulting recurring amount"
  );
  const resultingAllowance =
    resolved.currentAllowance -
    addOnAllowance(resolved.targetAddOn, resolved.currentQuantity) +
    addOnAllowance(resolved.targetAddOn, input.request.quantity);

  const priceId = await deps.resolvePriceId(input.request.lookupKey);
  assertCanonicalTargetPrice(resolved, priceId);
  const now = deps.now();
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  let amountDueNowCents = 0;
  let taxStatus: CapacityChangePreview["taxStatus"] = "not_applicable";
  let effectiveSeconds: number;
  if (action === "increase") {
    if (subscription.collection_method !== "charge_automatically") {
      throw new CapacityChangeError(
        "This subscription cannot apply a self-service paid increase",
        409,
        "payment_method_unsupported"
      );
    }
    const invoice = await deps.createInvoicePreview({
      customer: input.account.stripe_customer_id!,
      subscription: subscription.id,
      subscription_details: {
        items: [
          previewItem({
            resolved,
            priceId,
            quantity: input.request.quantity,
          }),
        ],
        proration_behavior: "always_invoice",
        proration_date: nowSeconds,
      },
    });
    if (invoice.currency !== "usd") {
      throw new CapacityChangeError(
        "The capacity preview returned an unsupported currency",
        409,
        "currency_mismatch"
      );
    }
    ({ amountCents: amountDueNowCents, taxStatus } = dueNow(invoice));
    effectiveSeconds = nowSeconds;
  } else {
    effectiveSeconds = itemPeriodEnd(resolved.targetItem);
  }

  const expiresAt = nowSeconds + CAPACITY_PREVIEW_TTL_SECONDS;
  const previewToken = signCapacityChangePreview(
    {
      version: 1,
      accountId: input.account.id,
      subscriptionId: subscription.id,
      subscriptionItemId: resolved.targetItem?.id ?? null,
      lookupKey: input.request.lookupKey,
      currentQuantity: resolved.currentQuantity,
      targetQuantity: input.request.quantity,
      action,
      prorationDate: nowSeconds,
      effectiveAt: effectiveSeconds,
      expiresAt,
    },
    input.signingSecret
  );

  return {
    resource: resolved.targetAddOn.kind,
    lookupKey: resolved.targetAddOn.lookupKey,
    name: resolved.targetAddOn.name,
    action,
    currentQuantity: resolved.currentQuantity,
    resultingQuantity: input.request.quantity,
    currentAllowance: resolved.currentAllowance.toString(),
    resultingAllowance: resultingAllowance.toString(),
    currentRecurringAmountCents,
    resultingRecurringAmountCents,
    recurringChangeCents:
      resultingRecurringAmountCents - currentRecurringAmountCents,
    amountDueNowCents,
    currency: "usd",
    taxStatus,
    effectiveAt: new Date(effectiveSeconds * 1_000).toISOString(),
    effectiveTiming: action === "increase" ? "after_payment" : "period_end",
    previewToken,
    expiresAt: new Date(expiresAt * 1_000).toISOString(),
  };
}

export function createCapacityStripeChangeDeps(
  stripe: Stripe
): CapacityStripeChangeDeps {
  return {
    capacityBillingOperationsEnabled: areCapacityBillingOperationsEnabled,
    capacityBillingPilotAccount: isCapacityBillingPilotAccount,
    now: () => new Date(),
    retrieveSubscription: (id) =>
      stripe.subscriptions.retrieve(id, {
        expand: ["items.data.price", "latest_invoice.confirmation_secret"],
      }),
    resolvePriceId: (lookupKey) => resolveCatalogPriceId(lookupKey),
    createInvoicePreview: (params) => stripe.invoices.createPreview(params),
    updateSubscription: (id, params, options) =>
      stripe.subscriptions.update(id, params, options),
  };
}
