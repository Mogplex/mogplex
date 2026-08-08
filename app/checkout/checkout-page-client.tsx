"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/marketing/auth-shell";
import {
  parsePlanIntent,
  planIntentSummary,
} from "@/lib/billing/plan-intent";

type BillingInterval = "monthly" | "annual";

// The confirm step between signup and Stripe: one screen that names the plan
// and the price, then hands off to Stripe Checkout. The proxy guarantees a
// session here — unauthenticated visits bounce to /login with this URL as
// `next`, so the plan survives the round-trip.
function CheckoutContent() {
  const params = useSearchParams();
  const plan = parsePlanIntent(params.get("plan"));
  const subscribed = params.get("billing") === "subscribed";
  const cancelled = params.get("billing") === "cancelled";
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  if (!plan) {
    return (
      <AuthShell
        eyebrow="Checkout"
        title={
          <>
            Pick a <em className="grad">plan</em> first.
          </>
        }
        subtitle="This page needs a plan to check out. The rate card lists all of them."
      >
        <div className="mpx-auth-card">
          <Link className="mpx-button is-primary" href="/pricing">
            See pricing →
          </Link>
        </div>
      </AuthShell>
    );
  }

  const summary = planIntentSummary(plan);

  if (subscribed) {
    return (
      <AuthShell
        eyebrow="Checkout"
        title={
          <>
            You are on <em className="grad">{summary.name}</em>.
          </>
        }
        subtitle="Payment confirmed. Your included usage is ready — connect a repo and wire your first pipeline."
      >
        <div className="mpx-auth-card" data-testid="checkout-success">
          <Link className="mpx-button is-primary" href="/">
            Open your workspace →
          </Link>
        </div>
      </AuthShell>
    );
  }

  async function startCheckout() {
    setError(null);
    setIsPending(true);
    try {
      const lookupKey =
        interval === "monthly"
          ? summary.monthlyLookupKey
          : summary.annualLookupKey;
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "subscribe",
          plan: lookupKey,
          returnPath: `/checkout?plan=${plan}`,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        url?: string;
        error?: string;
      } | null;
      if (response.status === 503) {
        setError(
          "Paid plans are not open yet. Your account is ready — you can use PAYG now and subscribe when plans go live."
        );
        return;
      }
      if (response.status === 409) {
        setError(
          "This account already has a subscription. Manage your plan from Settings → Billing."
        );
        return;
      }
      if (!response.ok || !payload?.url) {
        setError(payload?.error ?? "Checkout failed — try again.");
        return;
      }
      window.location.assign(payload.url);
    } catch {
      setError("Network error — try again.");
      setIsPending(false);
    } finally {
      // Successful navigation replaces the page; only reset on failure paths.
      setIsPending(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Checkout"
      title={
        <>
          Confirm <em className="grad">{summary.name}</em>.
        </>
      }
      subtitle={
        <>
          {summary.includedUsage}/mo usage included. Cancel any time from
          settings — no call needed.{" "}
          <Link href="/pricing">Compare plans.</Link>
        </>
      }
      notice={
        cancelled ? (
          <div className="mpx-auth-alert is-warn">
            checkout cancelled — nothing was charged
          </div>
        ) : null
      }
      footer={
        <div>
          Not ready to subscribe?{" "}
          <Link href="/">Continue on PAYG — no monthly fee</Link>
        </div>
      }
    >
      <div className="mpx-auth-card" data-testid="checkout-confirm">
        <div className="flex flex-col gap-3.5">
          <fieldset className="flex flex-col gap-2">
            <legend className="mono mpx-auth-muted text-[12px]">
              Billing interval
            </legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="interval"
                checked={interval === "monthly"}
                onChange={() => setInterval("monthly")}
                disabled={isPending}
              />
              <span>
                Monthly — {summary.monthlyPrice}/mo
              </span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="interval"
                checked={interval === "annual"}
                onChange={() => setInterval("annual")}
                disabled={isPending}
              />
              <span>
                Annual — {summary.annualPrice}/yr (20% off)
              </span>
            </label>
          </fieldset>
          {error ? (
            <div className="mpx-auth-alert is-error" data-testid="checkout-error">
              {error}
            </div>
          ) : null}
          <button
            type="button"
            className="mpx-button is-primary"
            onClick={startCheckout}
            disabled={isPending}
            data-testid="checkout-continue"
          >
            {isPending ? "Opening secure checkout…" : "Continue to secure checkout →"}
          </button>
          <p className="mono mpx-auth-muted text-[12px]">
            Payments run on Stripe. Mogplex never sees your card.
          </p>
        </div>
      </div>
    </AuthShell>
  );
}

export function CheckoutPageClient() {
  return (
    <Suspense fallback={<div className="mpx-landing min-h-dvh" />}>
      <CheckoutContent />
    </Suspense>
  );
}
