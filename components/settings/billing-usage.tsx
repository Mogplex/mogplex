import { formatDate, formatUsd } from "./capacity-billing-format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CapacityBillingSummaryV2 } from "@/lib/billing/capacity-summary-types";

export function BillingUsage({ summary }: { summary: CapacityBillingSummaryV2 }) {
  return (
    <div className="space-y-6">
      <section aria-label="Inference balance" className="rounded-lg border bg-card p-6">
        <h2 className="text-base font-semibold">Inference balance</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <div><dt className="text-sm text-muted-foreground">Available now</dt><dd className="mt-1 font-medium tabular-nums">{formatUsd(summary.hostedUsage.spendableCents)}</dd></div>
          <div><dt className="text-sm text-muted-foreground">Included credit</dt><dd className="mt-1 font-medium tabular-nums">{formatUsd(summary.hostedUsage.includedRemainingCents)}</dd></div>
          <div><dt className="text-sm text-muted-foreground">Purchased credit</dt><dd className="mt-1 font-medium tabular-nums">{formatUsd(summary.hostedUsage.purchasedRemainingCents)}</dd></div>
        </dl>
      </section>
      <Card>
        <CardHeader>
          <CardTitle><h2>Recent usage costs</h2></CardTitle>
          <CardDescription>See what used your inference balance.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {summary.recentCosts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No usage costs yet.</p>
          ) : summary.recentCosts.map((cost) => (
            <div key={cost.operationId} className="flex items-start justify-between gap-4 py-3 first:pt-0">
              <div className="min-w-0 break-words">
                <p className="text-sm font-medium">{cost.description}</p>
                <p className="text-xs text-muted-foreground">{formatDate(cost.occurredAt)} · {cost.status.replaceAll("_", " ")}</p>
              </div>
              <p className="shrink-0 text-sm font-medium tabular-nums">{cost.totalCents === null ? "In progress" : formatUsd(cost.totalCents)}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
