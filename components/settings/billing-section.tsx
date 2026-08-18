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

type PurchaseSurface = "inference" | "capacity";

const CAPACITY_ADD_ON_GROUPS = [
  {
    id: "concurrency",
    label: "Concurrency",
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
  const inferenceUnavailable = purchaseUnavailableMessage(summary, "inference");
  const capacityUnavailable = purchaseUnavailableMessage(summary, "capacity");
  const canBuyInference = inferenceUnavailable === null;
  const canChangeCapacity = capacityUnavailable === null;
  const selectedQuantity = selectedAddOn
    ? (summary.addOns.find(
        (item) => item.lookupKey === selectedAddOn.lookupKey
      )?.quantity ?? 0)
    : 0;
  const submitted =
    checkoutResult === "hosted-usage-submitted" ||
    checkoutResult === "plan-submitted" ||
    checkoutResult === "topup";
  const planDetails = [
    summary.account.displayName,
    summary.plan.renewsAt
      ? `Renews ${formatDate(summary.plan.renewsAt)}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const legacyInference = summary.plan.offerKind === "legacy";

  return (
    <div className="flex flex-col gap-6">
      {submitted ? (
        <div className="rounded-md border bg-muted/40 p-3 text-sm" role="status">
          Payment submitted. Capacity updates after Stripe confirms the event.
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle><h2>Add inference credit</h2></CardTitle>
          <CardDescription>
            Prepaid credit for hosted model usage. It never expires.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canBuyInference ? (
            <div
              aria-label="Choose credit amount"
              className="grid max-w-5xl grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6"
              role="group"
            >
              {CAPACITY_HOSTED_USAGE_PRESETS.map((preset) => (
                <Button
                  aria-label={`Add ${formatCreditAmount(preset.creditCents)} inference credit`}
                  className="group h-14 w-full flex-col gap-0.5 border-border bg-muted/20 px-3 shadow-xs hover:border-foreground/25 hover:bg-accent dark:border-border dark:bg-muted/25 dark:hover:bg-accent"
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
                            preset: `topup_${preset.creditCents / 100}`,
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
                  <span className="text-base font-semibold tabular-nums">
                    {pendingAction === preset.lookupKey
                      ? "Opening…"
                      : formatCreditAmount(preset.creditCents)}
                  </span>
                  <span
                    aria-hidden="true"
                    className="text-[11px] font-normal text-muted-foreground transition-colors group-hover:text-accent-foreground"
                  >
                    Add credit
                  </span>
                </Button>
              ))}
            </div>
          ) : (
            <p className="rounded-md border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              {inferenceUnavailable}
            </p>
          )}
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
              <CardDescription>{planDetails}</CardDescription>
            </div>
            {canManage &&
            summary.account.hasBillingHistory &&
            summary.plan.offerKind !== "contract" ? (
              <Button
                disabled={pendingAction !== null}
                onClick={() => redirectTo("portal", "/api/stripe/portal", {})}
              >
                {pendingAction === "portal"
                  ? "Opening…"
                  : summary.account.hasSubscription
                    ? "Plan and invoices"
                    : "Billing history"}
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
            Keep your plan. Add more concurrency or storage.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {capacityUnavailable ? (
            <p className="rounded-md border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              {capacityUnavailable}
            </p>
          ) : null}
          {CAPACITY_ADD_ON_GROUPS.map((group, groupIndex) => (
            <section
              aria-labelledby={`capacity-group-${group.id}`}
              className={groupIndex === 0 ? "space-y-2" : "space-y-2 border-t pt-6"}
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
                        <p className="text-xs text-muted-foreground">
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
