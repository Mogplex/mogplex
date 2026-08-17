"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/marketing/auth-shell";
import {
  parsePlanIntent,
  planIntentSummary,
} from "@/lib/billing/plan-intent";

type BillingInterval = "month" | "year";

// The confirm step between signup and Stripe: one screen that names the plan
// and the price, then hands off to Stripe Checkout. The proxy guarantees a
// session here — unauthenticated visits bounce to /login with this URL as
// `next`, so the plan survives the round-trip.
function CheckoutContent() {
  const params = useSearchParams();
  const plan = parsePlanIntent(params.get("plan"));
  const subscribed = params.get("billing") === "plan-submitted";
  const cancelled = params.get("billing") === "cancelled";
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  if (!plan) {
    return (
      <AuthShell
        eyebrow="Checkout"
        title="Pick an Individual plan first."
        subtitle="This page needs a plan before checkout. Pricing lists each available Individual plan."
      >
        <div className="mpx-auth-card">
          <Link className="mpx-button is-primary" href="/pricing">
            See pricing
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
        title={`You are on ${summary.name}.`}
        subtitle="Payment is confirmed. Your capacity will update after Stripe confirms the billing event."
      >
        <div className="mpx-auth-card" data-testid="checkout-success">
          <Link className="mpx-button is-primary" href="/">
            Open your workspace
          </Link>
        </div>
      </AuthShell>
    );
  }

  async function startCheckout() {
    setError(null);
    setIsPending(true);
    try {
      const response = await fetch("/api/billing/capacity/plan/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planCode: plan,
          interval,
          returnPath: `/checkout?plan=${plan}`,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        url?: string;
        error?: string;
      } | null;
      if (response.status === 503) {
        setError(
          "Purchases are not configured on this deployment. Your current account remains available."
        );
        setIsPending(false);
        return;
      }
      if (response.status === 409) {
        setError(
          "This account already has a subscription. Manage it from Billing in Settings."
        );
        setIsPending(false);
        return;
      }
      if (!response.ok || !payload?.url) {
        setError(payload?.error ?? "Checkout failed. Try again.");
        setIsPending(false);
        return;
      }
      window.location.assign(payload.url);
    } catch {
      setError("Network error. Try again.");
      setIsPending(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Checkout"
      title={`Confirm ${summary.name}.`}
      subtitle={
        <>
          One named user, Concurrency {summary.concurrency},{" "}
          {summary.retainedDataGb} GB retained data, and {summary.hostedUsage}
          /month hosted usage. Cancel from Billing in Settings.{" "}
          <Link href="/pricing">Compare plans.</Link>
        </>
      }
      notice={
        cancelled ? (
          <div className="mpx-auth-alert is-warn">
            Checkout was cancelled. Nothing was charged.
          </div>
        ) : null
      }
      footer={
        <div>
          Need a different capacity level?{" "}
          <Link href="/pricing">Compare Individual plans</Link>
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
                checked={interval === "month"}
                onChange={() => setInterval("month")}
                disabled={isPending}
              />
              <span>
                Monthly: {summary.monthlyPrice}/month
              </span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="interval"
                checked={interval === "year"}
                onChange={() => setInterval("year")}
                disabled={isPending}
              />
              <span>
                Annual: {summary.annualPrice}/year (save 15%)
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
            {isPending ? "Opening secure checkout…" : "Continue to secure checkout"}
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
