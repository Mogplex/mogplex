import {
  findCapacityAddOn,
  type CapacityAddOn,
} from "@/lib/billing/capacity-catalog";
import type {
  CapacityBillingEntitlementRow,
  CapacityBillingSummaryAddOn,
} from "@/lib/billing/capacity-summary-types";

/* eslint-disable unicorn/prefer-bigint-literals */
const ZERO = BigInt(0);

function nonnegativeInteger(value: number | string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer`);
  }
  return parsed;
}

function addSafeInteger(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`${label} exceeds the safe integer range`);
  }
  return result;
}

function asTime(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} is invalid`);
  return parsed;
}

function orderedVersions(
  rows: CapacityBillingEntitlementRow[],
  predicate: (time: number) => boolean
): CapacityBillingEntitlementRow[] {
  return rows
    .filter((row) => predicate(asTime(row.effective_at, "effective_at")))
    .toSorted((left, right) => {
      const effective =
        asTime(left.effective_at, "effective_at") -
        asTime(right.effective_at, "effective_at");
      if (effective !== 0) return effective;
      const recorded =
        asTime(left.recorded_at, "recorded_at") -
        asTime(right.recorded_at, "recorded_at");
      if (recorded !== 0) return recorded;
      return (
        nonnegativeInteger(left.id, "entitlement id") -
        nonnegativeInteger(right.id, "entitlement id")
      );
    });
}

function currentVersion(
  rows: CapacityBillingEntitlementRow[],
  asOfTime: number
): CapacityBillingEntitlementRow | null {
  return orderedVersions(rows, (time) => time <= asOfTime).at(-1) ?? null;
}

function nextVersion(
  rows: CapacityBillingEntitlementRow[],
  asOfTime: number
): CapacityBillingEntitlementRow | null {
  const future = orderedVersions(rows, (time) => time > asOfTime);
  const nextEffectiveAt = future[0]?.effective_at;
  if (!nextEffectiveAt) return null;

  // Reordered deliveries can record more than one version for the next
  // effective instant. The last recorded version is authoritative.
  return future.findLast((row) => row.effective_at === nextEffectiveAt) ?? null;
}

type ResolvedAddOnVersion = {
  row: CapacityBillingEntitlementRow;
  addOn: CapacityAddOn;
  quantity: number;
};

function resolveAddOnVersion(
  row: CapacityBillingEntitlementRow | null
): ResolvedAddOnVersion | null {
  if (!row) return null;
  const addOn = findCapacityAddOn(row.price_lookup_key);
  if (!addOn) {
    throw new TypeError(`unknown capacity add-on ${row.price_lookup_key}`);
  }
  return {
    row,
    addOn,
    quantity: nonnegativeInteger(row.quantity, "add-on quantity"),
  };
}

function versionsByItem(rows: CapacityBillingEntitlementRow[]) {
  const grouped = new Map<string, CapacityBillingEntitlementRow[]>();
  for (const row of rows) {
    if (row.item_kind === "plan") continue;
    const versions = grouped.get(row.item_ref) ?? [];
    versions.push(row);
    grouped.set(row.item_ref, versions);
  }
  return grouped;
}

function addOnAllowance(addOn: CapacityAddOn, quantity: number): bigint {
  const perUnit =
    addOn.kind === "concurrency"
      ? BigInt(addOn.concurrencyDelta)
      : BigInt(addOn.retainedDataBytesDelta);
  return perUnit * BigInt(quantity);
}

function pendingAddOnStatus(input: {
  itemRef: string;
  current: ResolvedAddOnVersion | null;
  future: ResolvedAddOnVersion | null;
}): CapacityBillingSummaryAddOn["status"] {
  const { current, future, itemRef } = input;
  if (!future) return "active";
  if (current && current.addOn.kind !== future.addOn.kind) {
    throw new TypeError(`capacity add-on kind changed for ${itemRef}`);
  }
  if (future.quantity === 0) return "cancels_at_period_end";
  const currentAllowance = current
    ? addOnAllowance(current.addOn, current.quantity)
    : ZERO;
  const futureAllowance = addOnAllowance(future.addOn, future.quantity);
  if (futureAllowance > currentAllowance) return "pending_increase";
  if (futureAllowance < currentAllowance) return "pending_decrease";
  return "active";
}

function currentAddOnTotals(current: ResolvedAddOnVersion | null): {
  quantity: number;
  concurrency: number;
  retainedBytes: bigint;
} {
  if (!current) return { quantity: 0, concurrency: 0, retainedBytes: ZERO };
  return {
    quantity: current.quantity,
    concurrency: current.addOn.concurrencyDelta * current.quantity,
    retainedBytes:
      BigInt(current.addOn.retainedDataBytesDelta) * BigInt(current.quantity),
  };
}

function presentAddOnItem(input: {
  itemRef: string;
  current: ResolvedAddOnVersion | null;
  future: ResolvedAddOnVersion | null;
  target: ResolvedAddOnVersion;
  currentQuantity: number;
}): CapacityBillingSummaryAddOn {
  const { itemRef, current, future, target, currentQuantity } = input;
  const resultingQuantity = future ? future.quantity : currentQuantity;
  return {
    subscriptionItemId: itemRef,
    lookupKey: target.addOn.lookupKey,
    kind: target.addOn.kind,
    name: target.addOn.name,
    quantity: resultingQuantity,
    allowanceDelta: addOnAllowance(target.addOn, resultingQuantity).toString(),
    recurringAmountCents: addSafeInteger(
      0,
      target.addOn.amountCents * resultingQuantity,
      "recurring add-on price"
    ),
    status: pendingAddOnStatus({ itemRef, current, future }),
    effectiveAt: target.row.effective_at,
  };
}

function summarizeAddOnItem(
  itemRef: string,
  versions: CapacityBillingEntitlementRow[],
  asOfTime: number
) {
  const current = resolveAddOnVersion(currentVersion(versions, asOfTime));
  const future = resolveAddOnVersion(nextVersion(versions, asOfTime));
  const target = future ?? current;
  const currentTotals = currentAddOnTotals(current);
  if (!target || (target.quantity === 0 && currentTotals.quantity === 0)) {
    return { item: null, ...currentTotals, pendingRetainedBytes: ZERO };
  }

  const resultingQuantity = future ? future.quantity : currentTotals.quantity;
  return {
    item: presentAddOnItem({
      itemRef,
      current,
      future,
      target,
      currentQuantity: currentTotals.quantity,
    }),
    ...currentTotals,
    pendingRetainedBytes:
      BigInt(target.addOn.retainedDataBytesDelta) * BigInt(resultingQuantity),
  };
}

export function summarizeCapacityAddOns(
  rows: CapacityBillingEntitlementRow[],
  asOf: Date
): {
  items: CapacityBillingSummaryAddOn[];
  concurrency: number;
  retainedBytes: bigint;
  pendingRetainedBytes: bigint;
} {
  const now = asOf.getTime();
  const items: CapacityBillingSummaryAddOn[] = [];
  let concurrency = 0;
  let retainedBytes = ZERO;
  let pendingRetainedBytes = ZERO;

  for (const [itemRef, versions] of versionsByItem(rows)) {
    const summary = summarizeAddOnItem(itemRef, versions, now);
    concurrency = addSafeInteger(
      concurrency,
      summary.concurrency,
      "concurrency add-ons"
    );
    retainedBytes += summary.retainedBytes;
    pendingRetainedBytes += summary.pendingRetainedBytes;
    if (summary.item) items.push(summary.item);
  }

  return {
    items: items.toSorted((left, right) => left.name.localeCompare(right.name)),
    concurrency,
    retainedBytes,
    pendingRetainedBytes,
  };
}
