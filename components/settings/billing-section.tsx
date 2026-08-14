"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  fetchWithActiveTeam,
  getActiveTeamRequestHeaders,
  useActiveTeamId,
} from "@/components/active-scope-provider";
import {
  formatUsd,
  PLAN_PRICES,
  TOPUP_PRESETS,
  type PlanInterval,
  type PlanTier,
} from "@/lib/billing/catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type BillingSummary = {
  enabled: boolean;
  billingOperationsEnabled?: boolean;
  canManageBilling?: boolean;
  tier?: "free" | "pro" | "team" | "business";
  status?: "active" | "past_due" | "frozen_topups";
  hasSubscription?: boolean;
  hasStripeCustomer?: boolean;
  balance?: {
    includedCents: number;
    purchasedCents: number;
    totalCents: number;
  };
};

const PLAN_DETAILS: ReadonlyArray<{
  tier: PlanTier;
  name: string;
  description: string;
}> = [
  {
    tier: "pro",
    name: "Pro",
    description: "For individual developers running agents every day.",
  },
  {
    tier: "team",
    name: "Team",
    description: "Shared billing and pooled usage for unlimited members.",
  },
  {
    tier: "business",
    name: "Mog Mode",
    description:
      "Twice the Team usage pool, priority sandbox scheduling, priority support.",
  },
];

function planName(tier: BillingSummary["tier"]): string {
  if (tier === "pro") return "Pro";
  if (tier === "team") return "Team";
  if (tier === "business") return "Mog Mode";
  return "Pay as you go";
}

async function loadBillingSummary([
  url,
  activeTeamId,
]: [string, string | null]): Promise<BillingSummary> {
  const response = await fetch(url, {
    headers: getActiveTeamRequestHeaders(undefined, activeTeamId),
  });
  if (response.status === 503) {
    return { enabled: false };
  }
  if (!response.ok) {
    throw new Error("Failed to load billing summary");
  }
  return (await response.json()) as BillingSummary;
}

export function BillingSection({ embedded = false }: { embedded?: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTeamId = useActiveTeamId();
  const { data, error, isLoading, mutate } = useSWR<BillingSummary>(
    ["/api/billing", activeTeamId],
    loadBillingSummary
  );
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [planInterval, setPlanInterval] = useState<PlanInterval>("month");
  const topupAttemptIds = useRef(new Map<string, string>());
  const checkoutResult = searchParams.get("billing");
  const returnPath = embedded ? `${pathname}?tab=billing` : pathname;

  useEffect(() => {
    if (checkoutResult === "topup") topupAttemptIds.current.clear();
    if (checkoutResult === "topup" || checkoutResult === "subscribed") {
      void mutate();
    }
    const resetBfcacheAttempts = (event: PageTransitionEvent) => {
      if (event.persisted) topupAttemptIds.current.clear();
    };
    window.addEventListener("pageshow", resetBfcacheAttempts);
    return () => window.removeEventListener("pageshow", resetBfcacheAttempts);
  }, [checkoutResult, mutate]);

  function getTopupAttemptId(action: string) {
    const existing = topupAttemptIds.current.get(action);
    if (existing) return existing;
    const attemptId = crypto.randomUUID();
    topupAttemptIds.current.set(action, attemptId);
    return attemptId;
  }

  async function redirectTo(
    action: string,
    url: string,
    body: Record<string, unknown>
  ) {
    setPendingAction(action);
    setActionError(null);
    try {
      const response = await fetchWithActiveTeam(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, returnPath }),
      });
      const payload = (await response.json()) as {
        url?: string;
        error?: string;
        code?: string;
      };
      if (!response.ok || !payload.url) {
        if (payload.code === "checkout_session_unavailable") {
          topupAttemptIds.current.delete(action);
        }
        throw new Error(payload.error ?? "Request failed");
      }
      window.location.href = payload.url;
    } catch (redirectError) {
      setActionError(
        redirectError instanceof Error
          ? redirectError.message
          : "Request failed"
      );
      setPendingAction(null);
    }
  }

  if (isLoading) {
    return <Skeleton className="h-48 w-full" />;
  }
  if (error) {
    return (
      <p className="text-sm text-muted-foreground">
        Billing summary is unavailable right now.
      </p>
    );
  }
  if (!data?.enabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Billing</CardTitle>
          <CardDescription>
            Billing is not enabled on this deployment.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const balance = data.balance ?? {
    includedCents: 0,
    purchasedCents: 0,
    totalCents: 0,
  };
  const paymentSubmitted =
    checkoutResult === "topup" || checkoutResult === "subscribed";
  const canManageBilling = data.canManageBilling !== false;
  const canStartBillingFlow =
    canManageBilling && data.billingOperationsEnabled !== false;
  const hasPaidPlan = data.hasSubscription || data.tier !== "free";
  const currentPlanName = planName(data.tier);

  return (
    <div className="flex flex-col gap-6">
      {paymentSubmitted ? (
        <div
          className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/40 p-3 text-sm"
          role="status"
        >
          <span>
            Payment submitted. Your balance updates after Stripe confirms it.
          </span>
          <Button variant="outline" size="sm" onClick={() => void mutate()}>
            Refresh balance
          </Button>
        </div>
      ) : null}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <CardTitle className="flex flex-wrap items-center gap-2">
                <h2>{currentPlanName}</h2>
                <Badge variant="secondary">Current plan</Badge>
                {data.status !== "active" ? (
                  <Badge variant="destructive">{data.status}</Badge>
                ) : null}
              </CardTitle>
              <CardDescription>
                {data.tier === "free"
                  ? "No subscription. Add prepaid usage whenever you need it."
                  : "Included usage resets monthly. Purchased balance never expires."}
              </CardDescription>
            </div>
            {canStartBillingFlow && hasPaidPlan ? (
              <Button
                className="self-start"
                disabled={pendingAction !== null}
                onClick={() => redirectTo("portal", "/api/stripe/portal", {})}
              >
                {pendingAction === "portal" ? "Opening…" : "Manage plan"}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm font-medium">Usage balance</p>
          <div className="flex flex-wrap gap-x-10 gap-y-4">
            <div>
              <p className="text-2xl font-semibold">
                {formatUsd(balance.includedCents)}
              </p>
              <p className="text-sm text-muted-foreground">
                Included remaining
              </p>
            </div>
            <div>
              <p className="text-2xl font-semibold">
                {formatUsd(balance.purchasedCents)}
              </p>
              <p className="text-sm text-muted-foreground">
                Purchased balance
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>
              {data.tier === "free" ? "Top up PAYG balance" : "Add balance"}
            </h2>
          </CardTitle>
          <CardDescription>
            Prepaid usage credits. Purchased balance never expires.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {canStartBillingFlow ? (
            TOPUP_PRESETS.map((preset) => (
              <Button
                key={preset.lookupKey}
                disabled={
                  pendingAction !== null || data.status === "frozen_topups"
                }
                onClick={() =>
                  redirectTo(preset.lookupKey, "/api/stripe/checkout", {
                    kind: "topup",
                    preset: preset.lookupKey,
                    attemptId: getTopupAttemptId(preset.lookupKey),
                  })
                }
              >
                {pendingAction === preset.lookupKey
                  ? "Redirecting…"
                  : `Top up ${formatUsd(preset.amountCents)}`}
              </Button>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              {canManageBilling
                ? "Billing changes are not configured on this deployment."
                : "Only a team owner or admin can add funds."}
            </p>
          )}
          {data.status === "frozen_topups" ? (
            <p className="basis-full text-sm text-destructive">
              Top-ups are paused for this account. Contact support for help.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <CardTitle>
                <h2>Plans</h2>
              </CardTitle>
              <CardDescription>
                {!canManageBilling
                  ? "Only a team owner or admin can change this plan."
                  : data.billingOperationsEnabled === false
                    ? "Plan and balance are visible here. Billing changes are not configured on this deployment."
                  : hasPaidPlan
                    ? "Plan changes and cancellation are managed securely in Stripe."
                    : "Stay on PAYG, or subscribe for usage included every month."}
              </CardDescription>
            </div>
            <div
              aria-label="Billing period"
              className="flex w-fit shrink-0 rounded-md border bg-muted/30 p-1"
              role="group"
            >
              <Button
                aria-pressed={planInterval === "month"}
                aria-label="Monthly billing"
                className="h-7"
                onClick={() => setPlanInterval("month")}
                size="sm"
                type="button"
                variant={planInterval === "month" ? "secondary" : "ghost"}
              >
                Monthly
              </Button>
              <Button
                aria-pressed={planInterval === "year"}
                aria-label="Annual billing"
                className="h-7"
                onClick={() => setPlanInterval("year")}
                size="sm"
                type="button"
                variant={planInterval === "year" ? "secondary" : "ghost"}
              >
                Annual · save 20%
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="divide-y">
          <div className="grid gap-4 py-5 first:pt-0 md:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)_auto] md:items-center">
            <div>
              <h3 className="font-semibold">Pay as you go</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                No subscription. Buy prepaid usage only when you need it.
              </p>
            </div>
            <div>
              <p className="font-medium">$0/month</p>
              <p className="text-xs text-muted-foreground">No commitment</p>
            </div>
            {data.tier === "free" ? (
              <Badge variant="outline">Current</Badge>
            ) : null}
          </div>

          {PLAN_DETAILS.map((details) => {
            const plan = PLAN_PRICES.find(
              (candidate) =>
                candidate.tier === details.tier &&
                candidate.interval === planInterval
            );
            if (!plan) return null;

            return (
              <div
                className="grid gap-4 py-5 md:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)_auto] md:items-center"
                key={details.tier}
              >
                <div>
                  <h3 className="font-semibold">{details.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {details.description}
                  </p>
                </div>
                <div>
                  <p className="font-medium">
                    {formatUsd(plan.amountCents)}/
                    {plan.interval === "month" ? "month" : "year"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatUsd(plan.includedUsageCents)} usage included monthly
                  </p>
                </div>
                {canStartBillingFlow && !hasPaidPlan ? (
                  <Button
                    disabled={pendingAction !== null}
                    onClick={() =>
                      redirectTo(plan.lookupKey, "/api/stripe/checkout", {
                        kind: "subscribe",
                        plan: plan.lookupKey,
                      })
                    }
                    variant="outline"
                  >
                    {pendingAction === plan.lookupKey
                      ? "Redirecting…"
                      : `Choose ${details.name}`}
                  </Button>
                ) : data.tier === details.tier ? (
                  <Badge variant="outline">Current</Badge>
                ) : null}
              </div>
            );
          })}

          <div className="grid gap-4 py-5 md:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)_auto] md:items-center">
            <div>
              <h3 className="font-semibold">Enterprise</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Dedicated capacity, custom terms, invoiced billing. You talk
                to the people who build Mogplex.
              </p>
            </div>
            <div>
              <p className="font-medium">Contact us</p>
              <p className="text-xs text-muted-foreground">
                One email, no sales gauntlet
              </p>
            </div>
            <Button asChild variant="outline">
              <a href="mailto:enterprise@mogplex.com">Email us</a>
            </Button>
          </div>

          <div className="grid gap-4 py-5 pb-0 md:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)_auto] md:items-center">
            <div>
              <h3 className="font-semibold">Self-hosted</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Run the Apache-2.0 platform inside your network. The docs
                explain the operational work.
              </p>
            </div>
            <div>
              <p className="font-medium">Free forever</p>
              <p className="text-xs text-muted-foreground">No license fee</p>
            </div>
            <Button asChild variant="outline">
              <a href="https://github.com/mogplex/mogplex/blob/main/docs/self-hosting.md">
                Self-hosting docs
              </a>
            </Button>
          </div>

          {!canManageBilling ? (
            <p className="pt-5 text-sm text-muted-foreground">
              Your team&apos;s balance and plan are visible here. Ask a team
              owner or admin to make billing changes.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {actionError ? (
        <p className="text-sm text-destructive">{actionError}</p>
      ) : null}
    </div>
  );
}
