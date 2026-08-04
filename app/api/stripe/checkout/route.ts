import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { resolveProductResourceScope } from "@/lib/team-resource-scope";
import { getStripe, isBillingEnabled } from "@/lib/billing/stripe";
import {
  findPlanPrice,
  findTopupPreset,
  TOPUP_MAX_CENTS,
  TOPUP_MIN_CENTS,
  TOPUP_PRODUCT_NAME,
} from "@/lib/billing/catalog";
import {
  getOrCreateBillingAccount,
  updateBillingAccount,
  type BillingAccount,
} from "@/lib/billing/accounts";

// Checkout flows (pricing-plan 02 §3): mode=subscription for plan sign-up,
// mode=payment for top-ups. Top-up credit posts on payment_intent.succeeded
// via the webhook — never on the redirect.

export type CheckoutRequest =
  | { kind: "subscribe"; plan: string }
  | { kind: "topup"; preset?: string; amountCents?: number };

export type CheckoutValidation =
  | { ok: true; request: CheckoutRequest }
  | { ok: false; error: string };

export function validateCheckoutRequest(body: unknown): CheckoutValidation {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid request body" };
  }
  const { kind } = body as { kind?: unknown };
  if (kind === "subscribe") {
    const { plan } = body as { plan?: unknown };
    if (typeof plan !== "string" || !findPlanPrice(plan)) {
      return { ok: false, error: "Unknown plan" };
    }
    return { ok: true, request: { kind: "subscribe", plan } };
  }
  if (kind === "topup") {
    const { preset, amountCents } = body as {
      preset?: unknown;
      amountCents?: unknown;
    };
    if (typeof preset === "string") {
      if (!findTopupPreset(preset)) {
        return { ok: false, error: "Unknown top-up preset" };
      }
      return { ok: true, request: { kind: "topup", preset } };
    }
    if (typeof amountCents !== "number" || !Number.isInteger(amountCents)) {
      return { ok: false, error: "Top-up amount must be integer cents" };
    }
    if (amountCents < TOPUP_MIN_CENTS) {
      return {
        ok: false,
        error: `Minimum top-up is $${(TOPUP_MIN_CENTS / 100).toFixed(2)}`,
      };
    }
    if (amountCents > TOPUP_MAX_CENTS) {
      // Fraud guardrail, not a usage limit — raised on request instantly
      // (pricing-plan 02 §3b).
      return {
        ok: false,
        error: `Top-ups above $${TOPUP_MAX_CENTS / 100} require a support request`,
      };
    }
    return { ok: true, request: { kind: "topup", amountCents } };
  }
  return { ok: false, error: "Unknown checkout kind" };
}

function appUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://mogplex.com";
  return `${base.replace(/\/$/, "")}${path}`;
}

async function ensureStripeCustomer(account: BillingAccount): Promise<string> {
  if (account.stripe_customer_id) return account.stripe_customer_id;
  const customer = await getStripe().customers.create({
    metadata: { billing_account_id: account.id },
  });
  await updateBillingAccount(account.id, { stripe_customer_id: customer.id });
  return customer.id;
}

async function resolvePriceIdByLookupKey(lookupKey: string): Promise<string> {
  const prices = await getStripe().prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  });
  const price = prices.data[0];
  if (!price) {
    throw new Error(
      `Stripe price for lookup_key "${lookupKey}" not found — run scripts/stripe-seed.ts`
    );
  }
  return price.id;
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
  const customerId = await ensureStripeCustomer(account);
  const stripe = getStripe();

  if (validation.request.kind === "subscribe") {
    const priceId = await resolvePriceIdByLookupKey(validation.request.plan);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: account.id,
      line_items: [{ price: priceId, quantity: 1 }],
      automatic_tax: { enabled: true },
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      success_url: appUrl("/settings/billing?state=subscribed"),
      cancel_url: appUrl("/settings/billing?state=cancelled"),
    });
    return NextResponse.json({ url: session.url });
  }

  const lineItem = validation.request.preset
    ? {
        price: await resolvePriceIdByLookupKey(validation.request.preset),
        quantity: 1,
      }
    : {
        price_data: {
          currency: "usd",
          product_data: { name: TOPUP_PRODUCT_NAME },
          unit_amount: validation.request.amountCents!,
        },
        quantity: 1,
      };
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    client_reference_id: account.id,
    line_items: [lineItem],
    automatic_tax: { enabled: true },
    payment_intent_data: {
      metadata: { kind: "topup", billing_account_id: account.id },
    },
    success_url: appUrl("/settings/billing?state=topup"),
    cancel_url: appUrl("/settings/billing?state=cancelled"),
  });
  return NextResponse.json({ url: session.url });
}
