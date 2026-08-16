import type Stripe from "stripe";
import type { BillingAccount } from "@/lib/billing/accounts";
import {
  capacityChangeIdempotencyKey,
  verifyCapacityChangePreview,
  type CapacityChangePreviewTokenPayload,
} from "@/lib/billing/capacity-change-contract";
import {
  CapacityChangeError,
  assertAccountCanChangeCapacity,
  assertCanonicalTargetPrice,
  resolveCapacitySubscription,
  type ResolvedSubscription,
} from "@/lib/billing/capacity-stripe-change-state";
import {
  assertCapacityBillingOperationsEnabled,
  defaultCapacityStripeChangeDeps,
  type CapacityStripeChangeDeps,
} from "@/lib/billing/capacity-stripe-changes";

function verifiedPayload(input: {
  account: BillingAccount;
  token: string;
  secret: string;
  nowSeconds: number;
}): CapacityChangePreviewTokenPayload {
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
  if (payload.action !== "increase") {
    throw new CapacityChangeError(
      "Use the period-end schedule for a capacity decrease",
      409,
      "schedule_required"
    );
  }
  return payload;
}

function capacityIncreaseState(input: {
  resolved: ResolvedSubscription;
  payload: CapacityChangePreviewTokenPayload;
}): "submit" | "already_applied" {
  if (input.payload.targetQuantity <= input.payload.currentQuantity) {
    throw new CapacityChangeError(
      "The capacity preview is not an increase",
      409,
      "preview_invalid"
    );
  }
  const currentItemId = input.resolved.targetItem?.id ?? null;
  if (
    input.resolved.currentQuantity === input.payload.currentQuantity &&
    currentItemId === input.payload.subscriptionItemId
  ) {
    return "submit";
  }
  const sameAppliedItem = input.payload.subscriptionItemId
    ? currentItemId === input.payload.subscriptionItemId
    : currentItemId !== null;
  if (
    input.resolved.currentQuantity === input.payload.targetQuantity &&
    sameAppliedItem
  ) {
    return "already_applied";
  }
  throw new CapacityChangeError(
    "Capacity changed after this preview. Review the current price again.",
    409,
    "preview_stale"
  );
}

function updateItem(input: {
  resolved: ResolvedSubscription;
  priceId: string;
  targetQuantity: number;
}): Stripe.SubscriptionUpdateParams.Item {
  return input.resolved.targetItem
    ? {
        id: input.resolved.targetItem.id,
        quantity: input.targetQuantity,
      }
    : { price: input.priceId, quantity: input.targetQuantity };
}

function latestInvoice(
  subscription: Stripe.Subscription
): Stripe.Invoice | null {
  const invoice = subscription.latest_invoice;
  if (!invoice || typeof invoice === "string" || "deleted" in invoice) {
    return null;
  }
  return invoice;
}

function presentIncrease(updated: Stripe.Subscription) {
  const invoice = latestInvoice(updated);
  return {
    status: updated.pending_update ? "payment_required" : "submitted",
    subscriptionId: updated.id,
    invoiceId: invoice?.id ?? null,
    paymentUrl: invoice?.hosted_invoice_url ?? null,
    paymentClientSecret: invoice?.confirmation_secret?.client_secret ?? null,
    entitlementStatus: "pending_webhook" as const,
  };
}

export async function confirmCapacityIncrease(input: {
  account: BillingAccount;
  previewToken: string;
  attemptId: string;
  signingSecret: string;
  deps?: CapacityStripeChangeDeps;
}) {
  assertAccountCanChangeCapacity(input.account);
  const deps = input.deps ?? defaultCapacityStripeChangeDeps();
  assertCapacityBillingOperationsEnabled(deps);
  const payload = verifiedPayload({
    account: input.account,
    token: input.previewToken,
    secret: input.signingSecret,
    nowSeconds: Math.floor(deps.now().getTime() / 1_000),
  });
  const subscription = await deps.retrieveSubscription(payload.subscriptionId);
  const resolved = resolveCapacitySubscription({
    account: input.account,
    subscription,
    lookupKey: payload.lookupKey,
    // A lost HTTP response can be retried with the same attempt ID after
    // Stripe has already recorded the pending update. Replaying the exact
    // idempotency key must reach Stripe so it can return the first result.
    allowPendingUpdate: true,
  });
  const state = capacityIncreaseState({ resolved, payload });
  if (state === "already_applied") return presentIncrease(subscription);
  const priceId = await deps.resolvePriceId(payload.lookupKey);
  assertCanonicalTargetPrice(resolved, priceId);
  const updated = await deps.updateSubscription(
    subscription.id,
    {
      items: [
        updateItem({
          resolved,
          priceId,
          targetQuantity: payload.targetQuantity,
        }),
      ],
      payment_behavior: "pending_if_incomplete",
      proration_behavior: "always_invoice",
      proration_date: payload.prorationDate,
      expand: ["latest_invoice.confirmation_secret"],
    },
    {
      idempotencyKey: capacityChangeIdempotencyKey(
        input.account.id,
        input.attemptId
      ),
    }
  );
  return presentIncrease(updated);
}
