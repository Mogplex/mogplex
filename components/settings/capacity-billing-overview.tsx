"use client";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { CapacityBillingSummaryV2 } from "@/lib/billing/capacity-summary-types";
import {
  clampPercent,
  formatBytes,
  formatDate,
  formatUsd,
} from "./capacity-billing-format";

function Meter(props: {
  name: string;
  value: string;
  detail: string;
  percent: number;
  blocked?: boolean;
  trackingOnly?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-3 rounded-md border p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium">{props.name}</p>
        {props.trackingOnly ? (
          <Badge variant="secondary">Not enforced</Badge>
        ) : props.blocked ? (
          <Badge variant="destructive">At limit</Badge>
        ) : null}
      </div>
      <p className="text-2xl font-semibold tabular-nums">{props.value}</p>
      <Progress aria-label={`${props.name} capacity`} value={props.percent} />
      <p className="text-xs text-muted-foreground">{props.detail}</p>
    </div>
  );
}

export function CapacityBillingOverview({
  summary,
}: {
  summary: CapacityBillingSummaryV2;
}) {
  const concurrencyLimit = summary.concurrency.limit;
  const concurrencyPercent = concurrencyLimit
    ? (summary.concurrency.active / concurrencyLimit) * 100
    : 0;
  const retainedLimit = summary.retainedData.limitBytes;
  const trackingOnly = summary.account.enforcementMode !== "enforced";
  const grossHostedRemaining =
    summary.hostedUsage.includedRemainingCents +
    summary.hostedUsage.purchasedRemainingCents;
  const hostedAvailablePercent = grossHostedRemaining
    ? (summary.hostedUsage.spendableCents / grossHostedRemaining) * 100
    : 0;

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Meter
        blocked={summary.concurrency.wouldBlock}
        detail={`${summary.concurrency.included ?? 0} included + ${summary.concurrency.addOn} add-on`}
        name="Concurrency"
        percent={clampPercent(concurrencyPercent)}
        trackingOnly={trackingOnly}
        value={`${summary.concurrency.active} of ${concurrencyLimit ?? "custom"}`}
      />
      <Meter
        blocked={summary.retainedData.wouldBlock}
        detail={`${formatBytes(summary.retainedData.includedBytes ?? 0)} included + ${formatBytes(summary.retainedData.addOnBytes)} add-on`}
        name="Storage"
        percent={clampPercent(summary.retainedData.percentUsed)}
        trackingOnly={trackingOnly}
        value={`${formatBytes(summary.retainedData.logicalBytes)} of ${retainedLimit ? formatBytes(retainedLimit) : "custom"}`}
      />
      <Meter
        blocked={summary.hostedUsage.spendableCents <= 0}
        detail={`${formatUsd(summary.hostedUsage.openReservationsCents)} reserved · resets ${formatDate(summary.hostedUsage.grantResetsAt)}`}
        name="Inference"
        percent={clampPercent(100 - hostedAvailablePercent)}
        value={`${formatUsd(summary.hostedUsage.spendableCents)} available`}
      />
    </div>
  );
}
