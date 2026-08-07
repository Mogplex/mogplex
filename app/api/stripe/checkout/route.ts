import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { resolveProductResourceScope } from "@/lib/team-resource-scope";
import { getStripe, isBillingEnabled } from "@/lib/billing/stripe";
import { findTopupPreset } from "@/lib/billing/catalog";
import { validateCheckoutRequest } from "@/lib/billing/checkout";
import { getOrCreateBillingAccount } from "@/lib/billing/accounts";
import {
  ensureStripeCustomer,
  resolveCatalogPriceId,
  resolveTopupProductId,
  subscriptionCheckoutIdempotencyKey,
  topupCheckoutIdempotencyKey,
} from "@/lib/billing/stripe-checkout";

// Checkout flows (pricing-plan 02 §3): mode=subscription for plan sign-up,
// mode=payment for top-ups. Top-up credit posts on payment_intent.succeeded
// via the webhook — never on the redirect.
//
// Every session runs under Managed Payments (pricing-plan 02 §0): Stripe is
// the merchant of record and handles tax registration, collection, and
// remittance, so sessions must not also set automatic_tax. Off-session
// charges are outside the MoR consent — all top-ups stay Checkout-initiated.

function appUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://mogplex.com";
  return `${base.replace(/\/$/, "")}${path}`;
}

function billingResultPath(returnPath: string, result: string): string {
  const separator = returnPath.includes("?") ? "&" : "?";
  return `${returnPath}${separator}billing=${result}`;
}

export async function POST(request: Request) {
  if (!isBillingEnabled()) {
    return NextResponse.json(
      { error: "Billing is not enabled" },
      { status: 503 }
    );
  }
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  // Owner/admin only for team scopes; personal scope always passes.
  const resolution = await resolveProductResourceScope({
    request,
    userId,
    requiredCapability: "billing.manage",
  });
  if (!resolution.ok) {
    return NextResponse.json(
      { error: resolution.error },
      { status: resolution.status }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const validation = validateCheckoutRequest(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const account = await getOrCreateBillingAccount(resolution.scope);
  if (
    validation.request.kind === "topup" &&
    account.status === "frozen_topups"
  ) {
    return NextResponse.json(
      { error: "Top-ups are paused on this account — contact support" },
      { status: 403 }
    );
  }
  const { returnPath } = validation.request;
  const customerId = await ensureStripeCustomer(account);
  const stripe = getStripe();

  if (validation.request.kind === "subscribe") {
    // One subscription per account. Plan switches (Pro↔Team,
    // monthly↔annual) go through the Customer Portal with prorations —
    // a second Checkout would double-charge.
    if (account.tier !== "free") {
      return NextResponse.json(
        {
          error:
            "This account already has a subscription — manage your plan from the billing portal",
        },
        { status: 409 }
      );
    }
    const priceId = await resolveCatalogPriceId(validation.request.plan);
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        client_reference_id: account.id,
        line_items: [{ price: priceId, quantity: 1 }],
        managed_payments: { enabled: true },
        allow_promotion_codes: true,
        billing_address_collection: "auto",
        success_url: appUrl(billingResultPath(returnPath, "subscribed")),
        cancel_url: appUrl(billingResultPath(returnPath, "cancelled")),
      },
      {
        idempotencyKey: subscriptionCheckoutIdempotencyKey(account),
      }
    );
    if (!session.url) {
      return NextResponse.json(
        {
          error:
            "This Checkout session is already complete — refresh billing to see the updated subscription",
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ url: session.url });
  }

  const creditCents = validation.request.preset
    ? findTopupPreset(validation.request.preset)!.amountCents
    : validation.request.amountCents!;
  const lineItem = validation.request.preset
    ? {
        price: await resolveCatalogPriceId(validation.request.preset),
        quantity: 1,
      }
    : {
        price_data: {
          currency: "usd",
          product: await resolveTopupProductId(),
          unit_amount: creditCents,
        },
        quantity: 1,
      };
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      customer: customerId,
      client_reference_id: account.id,
      line_items: [lineItem],
      managed_payments: { enabled: true },
      payment_intent_data: {
        // credit_cents = the pre-tax amount the webhook credits to the ledger
        // (amount_received includes the tax Managed Payments withholds, which
        // is not spendable).
        metadata: {
          kind: "topup",
          billing_account_id: account.id,
          credit_cents: String(creditCents),
        },
      },
      success_url: appUrl(billingResultPath(returnPath, "topup")),
      cancel_url: appUrl(billingResultPath(returnPath, "cancelled")),
    },
    {
      idempotencyKey: topupCheckoutIdempotencyKey(
        account.id,
        validation.request.attemptId
      ),
    }
  );
  if (!session.url) {
    return NextResponse.json(
      {
        error:
          "This Checkout session can no longer be used — try again to create a new session",
        code: "checkout_session_unavailable",
      },
      { status: 409 }
    );
  }
  return NextResponse.json({ url: session.url });
}
