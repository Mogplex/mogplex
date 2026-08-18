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
  note?: string;
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
      <p className="text-muted-foreground text-xs">{props.detail}</p>
      {props.note ? (
        <p className="text-muted-foreground text-xs">{props.note}</p>
      ) : null}
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
  const hasActiveReservation = summary.hostedUsage.openReservationsCents > 0;

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
      <div className="min-w-0 space-y-3 rounded-md border p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium">Inference</p>
          {hasActiveReservation ? (
            <Badge variant="secondary">Active work</Badge>
          ) : null}
        </div>
        <p className="text-2xl font-semibold tabular-nums">
          {formatUsd(grossHostedRemaining)} credit
        </p>
        <p className="text-muted-foreground text-xs">
          {formatUsd(summary.hostedUsage.spendableCents)} available for new work
        </p>
        {hasActiveReservation ? (
          <p className="text-muted-foreground text-xs">
            Active work holds{" "}
            {formatUsd(summary.hostedUsage.openReservationsCents)}. Unused
            credit returns automatically.
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            $1 of credit pays for $1 of model usage.
          </p>
        )}
        {summary.hostedUsage.includedRemainingCents > 0 ? (
          <p className="text-muted-foreground text-xs">
            Included credit resets{" "}
            {formatDate(summary.hostedUsage.grantResetsAt)}.
          </p>
        ) : null}
      </div>
    </div>
  );
}
