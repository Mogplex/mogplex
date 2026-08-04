"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  fetchWithActiveTeam,
  getActiveTeamRequestHeaders,
  useActiveTeamId,
} from "@/components/active-scope-provider";
import { PLAN_PRICES, TOPUP_PRESETS } from "@/lib/billing/catalog";
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
  tier?: "free" | "pro" | "team";
  status?: "active" | "past_due" | "frozen_topups";
  hasSubscription?: boolean;
  hasStripeCustomer?: boolean;
  balance?: {
    includedCents: number;
    purchasedCents: number;
    totalCents: number;
  };
};

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

async function loadBillingSummary([
  url,
  activeTeamId,
]: [string, string | null]): Promise<BillingSummary> {
  const response = await fetch(url, {
    headers: getActiveTeamRequestHeaders(undefined, activeTeamId),
  });
  if (!response.ok) {
    throw new Error("Failed to load billing summary");
  }
  return (await response.json()) as BillingSummary;
}

export function BillingSection() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTeamId = useActiveTeamId();
  const { data, error, isLoading, mutate } = useSWR<BillingSummary>(
    ["/api/billing", activeTeamId],
    loadBillingSummary
  );
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const topupAttemptIds = useRef(new Map<string, string>());
  const checkoutResult = searchParams.get("billing");

  useEffect(() => {
    if (checkoutResult === "topup") topupAttemptIds.current.clear();
    const resetBfcacheAttempts = (event: PageTransitionEvent) => {
      if (event.persisted) topupAttemptIds.current.clear();
    };
    window.addEventListener("pageshow", resetBfcacheAttempts);
    return () => window.removeEventListener("pageshow", resetBfcacheAttempts);
  }, [checkoutResult]);

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
        body: JSON.stringify({ ...body, returnPath: pathname }),
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
            Billing is not enabled on this deployment. Usage is on us during
            the beta.
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
          <CardTitle className="flex items-center gap-2">
            Balance
            <Badge variant="secondary" className="uppercase">
              {data.tier}
            </Badge>
            {data.status !== "active" ? (
              <Badge variant="destructive">{data.status}</Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            Included usage resets each billing period; purchased balance never
            expires.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-8">
          <div>
            <p className="text-2xl font-semibold">
              {formatUsd(balance.includedCents)}
            </p>
            <p className="text-sm text-muted-foreground">Included remaining</p>
          </div>
          <div>
            <p className="text-2xl font-semibold">
              {formatUsd(balance.purchasedCents)}
            </p>
            <p className="text-sm text-muted-foreground">Purchased balance</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Plan</CardTitle>
          <CardDescription>
            {data.hasSubscription
              ? "Change plan, update payment methods, or cancel from the billing portal."
              : "Tokens at provider list price with 0% markup. No seats."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {data.hasSubscription || data.tier !== "free" ? (
            <Button
              disabled={pendingAction !== null}
              onClick={() => redirectTo("portal", "/api/stripe/portal", {})}
            >
              {pendingAction === "portal" ? "Opening…" : "Manage subscription"}
            </Button>
          ) : (
            PLAN_PRICES.map((plan) => (
              <Button
                key={plan.lookupKey}
                variant={plan.interval === "month" ? "default" : "outline"}
                disabled={pendingAction !== null}
                onClick={() =>
                  redirectTo(plan.lookupKey, "/api/stripe/checkout", {
                    kind: "subscribe",
                    plan: plan.lookupKey,
                  })
                }
              >
                {pendingAction === plan.lookupKey
                  ? "Redirecting…"
                  : `${plan.productName.replace("Mogplex ", "")} ${formatUsd(plan.amountCents)}/${plan.interval === "month" ? "mo" : "yr"}`}
              </Button>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top up</CardTitle>
          <CardDescription>
            Prepaid usage balance — never expires.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {TOPUP_PRESETS.map((preset) => (
            <Button
              key={preset.lookupKey}
              variant="outline"
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
                : `Add ${formatUsd(preset.amountCents)}`}
            </Button>
          ))}
        </CardContent>
      </Card>

      {actionError ? (
        <p className="text-sm text-destructive">{actionError}</p>
      ) : null}
    </div>
  );
}
