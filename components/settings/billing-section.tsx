"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  fetchWithActiveTeam,
  getActiveTeamRequestHeaders,
  useActiveTeamId,
} from "@/components/active-scope-provider";
import { CapacityAddOnDialog } from "@/components/settings/capacity-add-on-dialog";
import { CapacityBillingOverview } from "@/components/settings/capacity-billing-overview";
import { formatDate, formatUsd } from "@/components/settings/capacity-billing-format";
import { useCapacityBillingEvents } from "@/components/settings/use-capacity-billing-events";
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
import {
  CAPACITY_ADD_ONS,
  CAPACITY_HOSTED_USAGE_PRESETS,
  type CapacityAddOn,
} from "@/lib/billing/capacity-catalog";
import type { CapacityBillingSummaryV2 } from "@/lib/billing/capacity-summary-types";

type BillingLoadResult =
  | { enabled: false }
  | { enabled: true; summary: CapacityBillingSummaryV2 };

async function loadBillingSummary([
  url,
  activeTeamId,
]: [string, string | null]): Promise<BillingLoadResult> {
  const response = await fetch(url, {
    headers: getActiveTeamRequestHeaders(undefined, activeTeamId),
  });
  if (response.status === 503) return { enabled: false };
  if (!response.ok) throw new Error("Failed to load billing summary");
  return {
    enabled: true,
    summary: (await response.json()) as CapacityBillingSummaryV2,
  };
}

export function BillingSection({ embedded = false }: { embedded?: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTeamId = useActiveTeamId();
  const { data, error, isLoading, mutate } = useSWR<BillingLoadResult>(
    ["/api/billing/capacity", activeTeamId],
    loadBillingSummary
  );
  const [selectedAddOn, setSelectedAddOn] = useState<CapacityAddOn | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const hostedUsageAttempts = useRef(new Map<string, string>());
  const checkoutResult = searchParams.get("billing");
  const returnPath = embedded ? `${pathname}?tab=billing` : pathname;
  const summary = data?.enabled ? data.summary : undefined;
  const refresh = useCallback(() => mutate(), [mutate]);

  useCapacityBillingEvents({
    activeTeamId,
    eventSequence: summary?.account.eventSequence,
    refresh,
  });

  useEffect(() => {
    if (
      checkoutResult === "hosted-usage-submitted" ||
      checkoutResult === "plan-submitted"
    ) {
      hostedUsageAttempts.current.clear();
      void mutate();
    }
  }, [checkoutResult, mutate]);

  function attemptIdFor(lookupKey: string): string {
    const prior = hostedUsageAttempts.current.get(lookupKey);
    if (prior) return prior;
    const created = crypto.randomUUID();
    hostedUsageAttempts.current.set(lookupKey, created);
    return created;
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
      };
      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? "Request failed");
      }
      window.location.assign(payload.url);
    } catch (redirectError) {
      setActionError(
        redirectError instanceof Error ? redirectError.message : "Request failed"
      );
      setPendingAction(null);
    }
  }

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error) {
    return (
      <p className="text-sm text-muted-foreground">
        Billing summary is unavailable right now.
      </p>
    );
  }
  if (!data?.enabled || !summary) {
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

  const canManage = summary.account.canManageBilling;
  const operationsEnabled = summary.billingOperationsEnabled;
  const canBuy =
    canManage &&
    operationsEnabled &&
    summary.plan.offerKind === "individual" &&
    !summary.hostedUsage.purchasesFrozen;
  const selectedQuantity = selectedAddOn
    ? (summary.addOns.find(
        (item) => item.lookupKey === selectedAddOn.lookupKey
      )?.quantity ?? 0)
    : 0;
  const submitted =
    checkoutResult === "hosted-usage-submitted" ||
    checkoutResult === "plan-submitted";

  return (
    <div className="flex flex-col gap-6">
      {submitted ? (
        <div className="rounded-md border bg-muted/40 p-3 text-sm" role="status">
          Payment submitted. Capacity updates after Stripe confirms the event.
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle><h2>Add inference</h2></CardTitle>
          <CardDescription>
            Purchased inference credit keeps its full value and never expires.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {CAPACITY_HOSTED_USAGE_PRESETS.map((preset) => (
            <Button
              disabled={!canBuy || pendingAction !== null}
              key={preset.lookupKey}
              onClick={() =>
                redirectTo(preset.lookupKey, "/api/billing/hosted-usage/checkout", {
                  preset: preset.lookupKey,
                  attemptId: attemptIdFor(preset.lookupKey),
                })
              }
              variant="outline"
            >
              {pendingAction === preset.lookupKey
                ? "Opening…"
                : `Add ${formatUsd(preset.creditCents)}`}
            </Button>
          ))}
          {summary.hostedUsage.purchasesFrozen ? (
            <p className="basis-full pt-2 text-sm text-destructive">
              Mogplex paused inference purchases for this account. Contact
              support for help.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <CardTitle className="flex flex-wrap items-center gap-2">
                <h2>{summary.plan.name}</h2>
                <Badge variant="secondary">Current plan</Badge>
                {summary.account.status !== "active" ? (
                  <Badge variant="destructive">
                    {summary.account.status.replaceAll("_", " ")}
                  </Badge>
                ) : null}
              </CardTitle>
              <CardDescription>
                {summary.account.displayName} · {summary.plan.namedUserLimit ?? "Custom"}{" "}
                {summary.plan.namedUserLimit === 1 ? "named user" : "users"}
                {summary.plan.renewsAt
                  ? ` · Renews ${formatDate(summary.plan.renewsAt)}`
                  : ""}
              </CardDescription>
            </div>
            {canManage && summary.plan.offerKind === "individual" ? (
              <Button
                disabled={!operationsEnabled || pendingAction !== null}
                onClick={() => redirectTo("portal", "/api/stripe/portal", {})}
              >
                {pendingAction === "portal" ? "Opening…" : "Manage plan"}
              </Button>
            ) : summary.plan.offerKind === "legacy" && canManage ? (
              <Button asChild variant="outline">
                <Link href="/pricing">Choose an Individual plan</Link>
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <CapacityBillingOverview summary={summary} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle><h2>Capacity add-ons</h2></CardTitle>
          <CardDescription>
            Add Concurrency or Storage. Keep your current plan.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {CAPACITY_ADD_ONS.map((addOn) => {
            const active = summary.addOns.find(
              (item) => item.lookupKey === addOn.lookupKey
            );
            return (
              <div
                className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[1fr_auto_auto] sm:items-center"
                key={addOn.lookupKey}
              >
                <div>
                  <p className="font-medium">{addOn.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatUsd(addOn.amountCents)}/month per quantity
                  </p>
                </div>
                <p className="text-sm tabular-nums">
                  {active ? `Quantity ${active.quantity}` : "Not added"}
                </p>
                <Button
                  aria-label={`${active ? "Manage" : "Add"} ${addOn.name}`}
                  disabled={!canBuy}
                  onClick={() => setSelectedAddOn(addOn)}
                  size="sm"
                  variant="outline"
                >
                  {active ? "Manage" : "Add"}
                </Button>
              </div>
            );
          })}
          {!canManage ? (
            <p className="pt-4 text-sm text-muted-foreground">
              Ask a company owner or admin to change billing.
            </p>
          ) : !operationsEnabled ? (
            <p className="pt-4 text-sm text-muted-foreground">
              Capacity changes are not configured on this deployment.
            </p>
          ) : summary.plan.offerKind !== "individual" ? (
            <p className="pt-4 text-sm text-muted-foreground">
              Contact sales to change company capacity.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle><h2>Recent usage costs</h2></CardTitle>
          <CardDescription>
            See what used your inference balance.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {summary.recentCosts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No usage costs yet.</p>
          ) : (
            summary.recentCosts.map((cost) => (
              <div className="flex items-start justify-between gap-4 py-3 first:pt-0" key={cost.operationId}>
                <div>
                  <p className="text-sm font-medium">{cost.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(cost.occurredAt)} · {cost.status.replaceAll("_", " ")}
                  </p>
                </div>
                <p className="text-sm font-medium tabular-nums">
                  {cost.totalCents === null ? "In progress" : formatUsd(cost.totalCents)}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {actionError ? <p className="text-sm text-destructive" role="alert">{actionError}</p> : null}

      <CapacityAddOnDialog
        addOn={selectedAddOn}
        currentQuantity={selectedQuantity}
        onChanged={refresh}
        onOpenChange={(open) => {
          if (!open) setSelectedAddOn(null);
        }}
        open={selectedAddOn !== null}
      />
    </div>
  );
}
