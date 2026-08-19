"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  fetchWithActiveTeam,
  getActiveTeamRequestHeaders,
  useActiveTeamId,
} from "@/components/active-scope-provider";
import { CapacityAddOnDialog } from "@/components/settings/capacity-add-on-dialog";
import { BillingSubscriptionDetails } from "@/components/settings/billing-subscription-details";
import {
  formatDate,
  formatUsd,
} from "@/components/settings/capacity-billing-format";
import { useCapacityBillingEvents } from "@/components/settings/use-capacity-billing-events";
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
import { findTopupPresetByAmount } from "@/lib/billing/catalog";

type BillingLoadResult =
  | { enabled: false }
  | { enabled: true; summary: CapacityBillingSummaryV2 };

type PurchaseSurface = "inference" | "capacity";

const CAPACITY_ADD_ON_GROUPS = [
  {
    id: "concurrency",
    label: "Parallel agent runs",
    items: CAPACITY_ADD_ONS.filter((addOn) => addOn.kind === "concurrency"),
  },
  {
    id: "storage",
    label: "Storage",
    items: CAPACITY_ADD_ONS.filter((addOn) => addOn.kind === "retained_data"),
  },
] as const;

function formatCreditAmount(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function purchaseUnavailableMessage(
  summary: CapacityBillingSummaryV2,
  surface: PurchaseSurface
): string | null {
  const subject = surface === "inference" ? "Inference" : "Capacity";
  if (!summary.account.canManageBilling) {
    return surface === "inference"
      ? "Ask a company owner or admin to add inference credit."
      : "Ask a company owner or admin to change billing.";
  }
  if (surface === "inference" && summary.hostedUsage.purchasesFrozen) {
    return "Mogplex paused inference purchases for this account. Contact support for help.";
  }
  if (
    summary.plan.offerKind === "legacy" &&
    surface === "inference" &&
    summary.account.hasSubscription
  ) {
    return summary.account.status === "active"
      ? null
      : `Resolve the billing account status before changing ${surface}.`;
  }
  if (!summary.billingOperationsEnabled) {
    return `${subject} purchases are unavailable on this deployment. Ask the deployment administrator to configure billing.`;
  }
  if (summary.plan.offerKind !== "individual") {
    return `${subject} for this account is managed through its company agreement.`;
  }
  if (summary.account.status === "past_due") {
    return `Resolve the past-due balance before changing ${surface}.`;
  }
  if (summary.account.status !== "active") {
    return "Mogplex paused capacity changes for this account. Contact support for help.";
  }
  return null;
}

async function loadBillingSummary([url, activeTeamId]: [
  string,
  string | null,
]): Promise<BillingLoadResult> {
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
  const [selectedAddOn, setSelectedAddOn] = useState<CapacityAddOn | null>(
    null
  );
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
      checkoutResult === "plan-submitted" ||
      checkoutResult === "topup"
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
        redirectError instanceof Error
          ? redirectError.message
          : "Request failed"
      );
      setPendingAction(null);
    }
  }

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error) {
    return (
      <p className="text-muted-foreground text-sm">
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

  const inferenceUnavailable = purchaseUnavailableMessage(summary, "inference");
  const capacityUnavailable = purchaseUnavailableMessage(summary, "capacity");
  const canBuyInference = inferenceUnavailable === null;
  const canChangeCapacity = capacityUnavailable === null;
  const activeConcurrencyLookupKeys = new Set(
    summary.addOns
      .filter((item) => item.kind === "concurrency")
      .map((item) => item.lookupKey)
  );
  const visibleCapacityGroups = CAPACITY_ADD_ON_GROUPS.map((group) => ({
    ...group,
    items:
      group.id === "concurrency" && !summary.concurrencyPurchasesEnabled
        ? group.items.filter((item) =>
            activeConcurrencyLookupKeys.has(item.lookupKey)
          )
        : group.items,
  })).filter((group) => group.items.length > 0);
  const hasGrandfatheredConcurrency =
    !summary.concurrencyPurchasesEnabled &&
    activeConcurrencyLookupKeys.size > 0;
  const selectedQuantity = selectedAddOn
    ? (summary.addOns.find((item) => item.lookupKey === selectedAddOn.lookupKey)
        ?.quantity ?? 0)
    : 0;
  const submitted =
    checkoutResult === "hosted-usage-submitted" ||
    checkoutResult === "plan-submitted" ||
    checkoutResult === "topup";
  const submittedMessage =
    checkoutResult === "plan-submitted"
      ? "Payment submitted. Capacity updates after Stripe confirms the event."
      : "Payment submitted. Stripe will add the full credit amount.";
  const legacyInference = summary.plan.offerKind === "legacy";
  const grossHostedRemaining =
    summary.hostedUsage.includedRemainingCents +
    summary.hostedUsage.purchasedRemainingCents;
  const showCapacityAddOns = summary.plan.offerKind !== "contract";

  return (
    <div className="flex flex-col gap-6">
      {submitted ? (
        <div
          className="bg-muted/40 rounded-md border p-3 text-sm"
          role="status"
        >
          {submittedMessage}
        </div>
      ) : null}

      <BillingSubscriptionDetails
        onOpenPortal={(action) => redirectTo(action, "/api/stripe/portal", {})}
        pendingAction={pendingAction}
        summary={summary}
      />

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>
                <h2>Add inference credit</h2>
              </CardTitle>
              <CardDescription>
                Pay $1. Get $1 of inference credit. Purchased credit never
                expires.
              </CardDescription>
            </div>
            <div className="sm:text-right">
              <p className="text-muted-foreground text-xs font-medium">
                Available now
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums">
                {formatUsd(summary.hostedUsage.spendableCents)}
              </p>
              {grossHostedRemaining !== summary.hostedUsage.spendableCents ? (
                <p className="text-muted-foreground text-xs">
                  {formatUsd(grossHostedRemaining)} total credit
                </p>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {canBuyInference ? (
            <div
              aria-label="Choose credit amount"
              className="grid max-w-6xl grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7"
              role="group"
            >
              {CAPACITY_HOSTED_USAGE_PRESETS.map((preset) => {
                const amount = formatCreditAmount(preset.creditCents);
                const legacyPreset = findTopupPresetByAmount(
                  preset.creditCents
                );
                return (
                  <Button
                    aria-label={`Pay ${amount}, get ${amount} credit`}
                    className="group border-border bg-muted/20 hover:border-foreground/25 hover:bg-accent dark:border-border dark:bg-muted/25 dark:hover:bg-accent h-14 w-full flex-col gap-0.5 px-3 shadow-xs"
                    disabled={pendingAction !== null}
                    key={preset.lookupKey}
                    onClick={() =>
                      redirectTo(
                        preset.lookupKey,
                        legacyInference
                          ? "/api/stripe/checkout"
                          : "/api/billing/hosted-usage/checkout",
                        legacyInference
                          ? {
                              kind: "topup",
                              ...(legacyPreset
                                ? { preset: legacyPreset.lookupKey }
                                : { amountCents: preset.creditCents }),
                              attemptId: attemptIdFor(preset.lookupKey),
                            }
                          : {
                              preset: preset.lookupKey,
                              attemptId: attemptIdFor(preset.lookupKey),
                            }
                      )
                    }
                    variant="outline"
                  >
                    <span className="text-sm font-semibold tabular-nums">
                      {pendingAction === preset.lookupKey
                        ? "Opening…"
                        : `Pay ${amount}`}
                    </span>
                    <span
                      aria-hidden="true"
                      className="text-muted-foreground group-hover:text-accent-foreground text-[11px] font-normal transition-colors"
                    >
                      Get {amount} credit
                    </span>
                  </Button>
                );
              })}
            </div>
          ) : (
            <p className="bg-muted/30 text-muted-foreground rounded-md border px-4 py-3 text-sm">
              {inferenceUnavailable}
            </p>
          )}
        </CardContent>
      </Card>

      {showCapacityAddOns ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>
                {summary.concurrencyPurchasesEnabled
                  ? "Capacity add-ons"
                  : hasGrandfatheredConcurrency
                    ? "Capacity add-ons"
                    : "Storage add-ons"}
              </h2>
            </CardTitle>
            <CardDescription>
              {summary.concurrencyPurchasesEnabled
                ? "Add parallel agent runs or storage without changing your plan."
                : hasGrandfatheredConcurrency
                  ? "Manage existing parallel agent runs or add retained storage."
                  : "Add retained storage without changing your plan."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {capacityUnavailable ? (
              <p className="bg-muted/30 text-muted-foreground rounded-md border px-4 py-3 text-sm">
                {capacityUnavailable}
              </p>
            ) : null}
            {visibleCapacityGroups.map((group, groupIndex) => (
              <section
                aria-labelledby={`capacity-group-${group.id}`}
                className={
                  groupIndex === 0
                    ? "space-y-2"
                    : "space-y-2 border-t pt-6"
                }
                key={group.id}
              >
                <h3
                  className="text-sm font-semibold"
                  id={`capacity-group-${group.id}`}
                >
                  {group.label}
                </h3>
                <div className="divide-y">
                  {group.items.map((addOn) => {
                    const active = summary.addOns.find(
                      (item) => item.lookupKey === addOn.lookupKey
                    );
                    return (
                      <div
                        className="flex flex-col gap-3 py-3 first:pt-2 last:pb-0 sm:flex-row sm:items-center"
                        key={addOn.lookupKey}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{addOn.name}</p>
                          <p className="text-muted-foreground text-xs">
                            {formatUsd(addOn.amountCents)} per month, per quantity
                          </p>
                        </div>
                        <p className="text-sm tabular-nums sm:min-w-20 sm:text-right">
                          {active ? `${active.quantity} active` : "Not added"}
                        </p>
                        {canChangeCapacity ? (
                          <Button
                            aria-label={`${active ? "Manage" : "Add"} ${addOn.name}`}
                            className="h-11 w-full sm:w-auto"
                            onClick={() => setSelectedAddOn(addOn)}
                            variant="outline"
                          >
                            {active ? "Manage" : "Add"}
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Recent usage costs</h2>
          </CardTitle>
          <CardDescription>
            See what used your inference balance.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {summary.recentCosts.length === 0 ? (
            <p className="text-muted-foreground text-sm">No usage costs yet.</p>
          ) : (
            summary.recentCosts.map((cost) => (
              <div
                className="flex items-start justify-between gap-4 py-3 first:pt-0"
                key={cost.operationId}
              >
                <div>
                  <p className="text-sm font-medium">{cost.description}</p>
                  <p className="text-muted-foreground text-xs">
                    {formatDate(cost.occurredAt)} ·{" "}
                    {cost.status.replaceAll("_", " ")}
                  </p>
                </div>
                <p className="text-sm font-medium tabular-nums">
                  {cost.totalCents === null
                    ? "In progress"
                    : formatUsd(cost.totalCents)}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {actionError ? (
        <p className="text-destructive text-sm" role="alert">
          {actionError}
        </p>
      ) : null}

      <CapacityAddOnDialog
        addOn={selectedAddOn}
        allowIncrease={
          selectedAddOn?.kind !== "concurrency" ||
          summary.concurrencyPurchasesEnabled
        }
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
