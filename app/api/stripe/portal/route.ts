import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { resolveProductResourceScope } from "@/lib/team-resource-scope";
import { getStripe, isBillingEnabled } from "@/lib/billing/stripe";
import { getOrCreateBillingAccount } from "@/lib/billing/accounts";
import { sanitizeReturnPath } from "@/lib/billing/checkout";

// Customer Portal entry point (pricing-plan 02 §7): plan switches, payment
// method updates, cancellation, and invoice history all happen in Stripe's
// hosted portal — no custom UI for those flows.

export async function POST(request: Request) {
  if (!isBillingEnabled()) {
    return NextResponse.json(
      { error: "Billing is not enabled" },
      { status: 503 }
    );
  }
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

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

  const account = await getOrCreateBillingAccount(resolution.scope);
  if (!account.stripe_customer_id) {
    return NextResponse.json(
      { error: "No billing history yet" },
      { status: 404 }
    );
  }

  let returnPath = "/";
  try {
    const body: unknown = await request.json();
    returnPath = sanitizeReturnPath(
      (body as { returnPath?: unknown })?.returnPath
    );
  } catch {
    // no body — default return path
  }
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://mogplex.com";
  const session = await getStripe().billingPortal.sessions.create({
    customer: account.stripe_customer_id,
    return_url: `${base.replace(/\/$/, "")}${returnPath}`,
  });
  return NextResponse.json({ url: session.url });
}
