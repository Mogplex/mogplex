"use client";

import Link from "next/link";
import {
  formatDate,
  formatUsd,
} from "@/components/settings/capacity-billing-format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CapacityBillingSummaryV2 } from "@/lib/billing/capacity-summary-types";

type BillingSubscriptionDetailsProps = {
  summary: CapacityBillingSummaryV2;
  pendingAction: string | null;
  onOpenPortal: (action: string) => void;
};

function formatMonthlyPlanCost(plan: CapacityBillingSummaryV2["plan"]): string {
  if (plan.recurringAmountCents === null) return "Custom";
  const monthlyCents =
    plan.interval === "year"
      ? plan.recurringAmountCents / 12
      : plan.recurringAmountCents;
  return `${formatUsd(monthlyCents)} / month`;
}

function formatCardBrand(brand: string): string {
  return brand.length === 0 ? "Card" : brand[0]!.toUpperCase() + brand.slice(1);
}

function formatInvoiceAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function BillingSubscriptionDetails({
  summary,
  pendingAction,
  onOpenPortal,
}: BillingSubscriptionDetailsProps) {
  const canManage = summary.account.canManageBilling;
  const billingDetails = summary.billingDetails;
  const paymentMethod = billingDetails?.paymentMethod ?? null;
  const protectedMessage =
    "Only company owners and admins can view billing details.";

  return (
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
            <CardDescription>{summary.account.displayName}</CardDescription>
          </div>
          {canManage &&
          summary.account.hasBillingHistory &&
          summary.plan.offerKind !== "contract" ? (
            <Button
              disabled={pendingAction !== null}
              onClick={() => onOpenPortal("portal")}
            >
              {pendingAction === "portal"
                ? "Opening…"
                : summary.account.hasSubscription
                  ? "Manage plan"
                  : "Manage billing"}
            </Button>
          ) : summary.plan.offerKind === "legacy" && canManage ? (
            <Button asChild variant="outline">
              <Link href="/pricing">Choose an Individual plan</Link>
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border p-4">
            <dt className="text-muted-foreground text-xs font-medium">
              Monthly plan cost
            </dt>
            <dd className="mt-2 text-xl font-semibold tabular-nums">
              {formatMonthlyPlanCost(summary.plan)}
            </dd>
            {summary.plan.interval === "year" ? (
              <p className="text-muted-foreground mt-1 text-xs">
                Billed yearly
              </p>
            ) : null}
          </div>
          <div className="rounded-md border p-4">
            <dt className="text-muted-foreground text-xs font-medium">
              Next due date
            </dt>
            <dd className="mt-2 text-xl font-semibold tabular-nums">
              {summary.plan.renewsAt
                ? formatDate(summary.plan.renewsAt)
                : summary.plan.offerKind === "contract"
                  ? "Set by agreement"
                  : "Not scheduled"}
            </dd>
          </div>
        </dl>

        <section
          aria-labelledby="payment-method-heading"
          className="border-t pt-5"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold" id="payment-method-heading">
                Payment method
              </h3>
              {paymentMethod ? (
                <div className="mt-2 space-y-1">
                  <p className="text-sm font-medium">
                    {formatCardBrand(paymentMethod.brand)} ending in{" "}
                    {paymentMethod.last4}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Expires {paymentMethod.expMonth}/{paymentMethod.expYear}
                  </p>
                </div>
              ) : (
                <p className="text-muted-foreground mt-2 text-sm">
                  {!canManage
                    ? protectedMessage
                    : summary.account.hasBillingHistory
                      ? "Card details are unavailable. Open Stripe to review them."
                      : "No payment method yet."}
                </p>
              )}
            </div>
            {canManage && summary.account.hasBillingHistory ? (
              <Button
                disabled={pendingAction !== null}
                onClick={() => onOpenPortal("payment-method")}
                variant="outline"
              >
                {pendingAction === "payment-method"
                  ? "Opening…"
                  : "Update payment method"}
              </Button>
            ) : null}
          </div>
        </section>

        <section aria-labelledby="invoices-heading" className="border-t pt-5">
          <h3 className="text-sm font-semibold" id="invoices-heading">
            Invoices
          </h3>
          {billingDetails?.invoices.length ? (
            <div className="mt-2 divide-y">
              {billingDetails.invoices.map((invoice) => {
                const invoiceUrl =
                  invoice.hostedInvoiceUrl || invoice.invoicePdfUrl;
                return (
                  <div
                    className="flex flex-col gap-2 py-3 first:pt-2 sm:flex-row sm:items-center sm:justify-between"
                    key={invoice.id}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {invoice.description}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {formatDate(invoice.createdAt)}
                        {invoice.status
                          ? ` · ${invoice.status.replaceAll("_", " ")}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-4 sm:justify-end">
                      <p className="text-sm font-medium tabular-nums">
                        {formatInvoiceAmount(
                          invoice.amountCents,
                          invoice.currency
                        )}
                      </p>
                      {invoiceUrl ? (
                        <a
                          aria-label={`Invoice ${invoice.number || invoice.id}`}
                          className="text-primary text-sm font-medium hover:underline"
                          href={invoiceUrl}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          {invoice.number || "View invoice"}
                        </a>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground mt-2 text-sm">
              {canManage ? "No invoices yet." : protectedMessage}
            </p>
          )}
        </section>

        <p className="text-muted-foreground border-t pt-5 text-sm">
          Need help with billing? Email{" "}
          <a
            className="text-foreground font-medium hover:underline"
            href="mailto:support@mogplex.com"
          >
            support@mogplex.com
          </a>
          .
        </p>
      </CardContent>
    </Card>
  );
}
