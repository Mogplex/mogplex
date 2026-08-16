import { findIndividualCapacityPrice } from "@/lib/billing/capacity-catalog";

const MAX_ANNUAL_GRANT_OFFSET = 11;

export type CapacityAnnualGrantOccurrence = {
  offset: number;
  period: string;
  dueAt: Date;
};

export type CapacityAnnualGrantSchedule = {
  id: string;
  account_id: string;
  stripe_subscription_id: string;
  entitlement_version: number | string;
  price_lookup_key: string;
  included_usage_cents: number | string;
  cycle_started_at: string;
  grant_offset: number;
  grant_period: string;
  due_at: string;
  source_event_id: string;
  runtime_run_id: string | null;
  status: "pending" | "cancel_pending" | "completed" | "cancelled";
};

export type CapacityAnnualGrantScheduleInput = {
  accountId: string;
  subscriptionId: string;
  entitlementVersion: number;
  priceLookupKey: string;
  includedUsageCents: number;
  cycleStartedAt: Date;
  occurrence: CapacityAnnualGrantOccurrence;
  sourceEventId: string;
};

export type AppliedCapacityAnnualGrant = {
  eligible: boolean;
  posted: boolean;
  duplicate: boolean;
  cancelled: boolean;
  accountId: string;
  subscriptionId: string;
  entitlementVersion: number;
  priceLookupKey: string;
  includedUsageCents: number;
  cycleStartedAt: Date;
  occurrence: CapacityAnnualGrantOccurrence;
  sourceEventId: string;
};

export function annualGrantSafeInteger(
  value: number | string,
  label: string
): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${label} is not a nonnegative safe integer`);
  }
  return number;
}

export function requireAnnualGrantText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} is missing`);
  }
  return value;
}

export function parseAnnualGrantDate(
  value: Date | string,
  label: string
): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${label} is invalid`);
  return date;
}

export function assertAnnualGrantOffset(offset: number): number {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 1 ||
    offset > MAX_ANNUAL_GRANT_OFFSET
  ) {
    throw new RangeError("annual grant offset must be between 1 and 11");
  }
  return offset;
}

export function capacityAnnualGrantOccurrence(
  cycleStartedAt: Date,
  offset: number
): CapacityAnnualGrantOccurrence {
  const cycle = parseAnnualGrantDate(
    cycleStartedAt,
    "annual grant cycle start"
  );
  assertAnnualGrantOffset(offset);
  const monthIndex = cycle.getUTCMonth() + offset;
  const year = cycle.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const dueAt = new Date(
    Date.UTC(
      year,
      month,
      Math.min(cycle.getUTCDate(), lastDay),
      cycle.getUTCHours(),
      cycle.getUTCMinutes(),
      cycle.getUTCSeconds(),
      cycle.getUTCMilliseconds()
    )
  );
  return {
    offset,
    period: dueAt.toISOString().slice(0, 7),
    dueAt,
  };
}

export function firstFutureCapacityAnnualGrantOccurrence(
  cycleStartedAt: Date,
  after: Date
): CapacityAnnualGrantOccurrence | null {
  const boundary = parseAnnualGrantDate(
    after,
    "annual grant scheduling boundary"
  );
  for (let offset = 1; offset <= MAX_ANNUAL_GRANT_OFFSET; offset += 1) {
    const occurrence = capacityAnnualGrantOccurrence(cycleStartedAt, offset);
    if (occurrence.dueAt > boundary) return occurrence;
  }
  return null;
}

export function nextCapacityAnnualGrantOccurrence(input: {
  cycleStartedAt: Date;
  currentOffset: number;
}): CapacityAnnualGrantOccurrence | null {
  const nextOffset = assertAnnualGrantOffset(input.currentOffset) + 1;
  return nextOffset > MAX_ANNUAL_GRANT_OFFSET
    ? null
    : capacityAnnualGrantOccurrence(input.cycleStartedAt, nextOffset);
}

export function assertCapacityAnnualGrantScheduleInput(
  input: CapacityAnnualGrantScheduleInput
): void {
  requireAnnualGrantText(input.accountId, "billing account id");
  requireAnnualGrantText(input.subscriptionId, "Stripe subscription id");
  requireAnnualGrantText(input.sourceEventId, "Stripe source event id");
  const resolved = findIndividualCapacityPrice(input.priceLookupKey);
  if (resolved?.price.interval !== "year") {
    throw new TypeError(
      `capacity annual grant references a non-annual price ${input.priceLookupKey}`
    );
  }
  if (resolved.plan.hostedUsageCents !== input.includedUsageCents) {
    throw new TypeError("capacity annual grant amount does not match its plan");
  }
  if (
    !Number.isSafeInteger(input.entitlementVersion) ||
    input.entitlementVersion <= 0
  ) {
    throw new RangeError("capacity annual grant requires a positive version");
  }
  const expected = capacityAnnualGrantOccurrence(
    input.cycleStartedAt,
    input.occurrence.offset
  );
  if (
    expected.period !== input.occurrence.period ||
    expected.dueAt.getTime() !== input.occurrence.dueAt.getTime()
  ) {
    throw new TypeError("capacity annual grant occurrence is inconsistent");
  }
}

export function capacityAnnualGrantRowMatchesInput(
  row: CapacityAnnualGrantSchedule,
  input: CapacityAnnualGrantScheduleInput
): boolean {
  return (
    row.account_id === input.accountId &&
    row.stripe_subscription_id === input.subscriptionId &&
    annualGrantSafeInteger(
      row.entitlement_version,
      "annual grant entitlement version"
    ) === input.entitlementVersion &&
    row.price_lookup_key === input.priceLookupKey &&
    annualGrantSafeInteger(row.included_usage_cents, "annual grant amount") ===
      input.includedUsageCents &&
    parseAnnualGrantDate(
      row.cycle_started_at,
      "annual grant cycle start"
    ).getTime() === input.cycleStartedAt.getTime() &&
    row.grant_offset === input.occurrence.offset &&
    row.grant_period === input.occurrence.period &&
    parseAnnualGrantDate(row.due_at, "annual grant due time").getTime() ===
      input.occurrence.dueAt.getTime() &&
    row.source_event_id === input.sourceEventId
  );
}
