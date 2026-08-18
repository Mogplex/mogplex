import type {
  CapacityBillingCostCategory,
  CapacityBillingCostItemRow,
  CapacityBillingCostOperationRow,
  CapacityBillingReservationRow,
  CapacityBillingSummaryCost,
  CapacityBillingSummaryReservation,
} from "@/lib/billing/capacity-summary-types";

/* eslint-disable unicorn/prefer-bigint-literals */
const ZERO = BigInt(0);
const ONE = BigInt(1);
const MICROS_PER_CENT = BigInt(10_000);

const COST_PRESENTATION: Readonly<
  Record<string, { category: CapacityBillingCostCategory; label: string }>
> = {
  ai: { category: "ai", label: "AI" },
  trigger: { category: "trigger", label: "Workflow compute" },
  sandbox_compute: { category: "sandbox", label: "Sandbox compute" },
  sandbox_transfer: { category: "sandbox", label: "Sandbox transfer" },
  vercel_function: { category: "vercel", label: "Hosted function" },
  email: { category: "email", label: "Email" },
  retained_data: { category: "storage_operation", label: "Storage" },
  database: { category: "storage_operation", label: "Database operation" },
  object_storage: { category: "storage_operation", label: "Storage operation" },
  transfer: { category: "transfer", label: "Data transfer" },
  observability: { category: "storage_operation", label: "Run history" },
  other: { category: "other", label: "Hosted work" },
};

function nonnegativeBigInt(value: number | string, label: string): bigint {
  try {
    const parsed = BigInt(value);
    if (parsed < ZERO) throw new TypeError(`${label} is negative`);
    return parsed;
  } catch {
    throw new TypeError(`${label} must be a nonnegative integer`);
  }
}

function asTime(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} is invalid`);
  return parsed;
}

function microsToReservedCents(micros: bigint): number {
  const parsed = Number((micros + MICROS_PER_CENT - ONE) / MICROS_PER_CENT);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError("billing amount exceeds the safe integer range");
  }
  return parsed;
}

function microsToDisplayCents(micros: bigint): number {
  const parsed = Number(
    (micros + MICROS_PER_CENT / BigInt(2)) / MICROS_PER_CENT
  );
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError("billing amount exceeds the safe integer range");
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

function settledCosts(
  operations: CapacityBillingCostOperationRow[],
  rows: CapacityBillingCostItemRow[]
): CapacityBillingSummaryCost[] {
  const operationIds = new Set(
    operations.map((operation) => operation.operation_ref)
  );
  const grouped = new Map<string, CapacityBillingCostItemRow[]>();
  for (const row of rows) {
    if (!operationIds.has(row.operation_ref)) {
      throw new TypeError("retail cost item has no matching operation");
    }
    const operationItems = grouped.get(row.operation_ref) ?? [];
    operationItems.push(row);
    grouped.set(row.operation_ref, operationItems);
  }

  return operations.map((operation) => {
    const operationItems = grouped.get(operation.operation_ref) ?? [];
    let itemMicros = ZERO;
    const items = operationItems
      .map((row) => {
        const micros = nonnegativeBigInt(
          row.retail_debit_micros,
          "retail cost item"
        );
        itemMicros += micros;
        const presentation =
          COST_PRESENTATION[row.cost_source] ?? COST_PRESENTATION.other!;
        return { ...presentation, amountCents: microsToDisplayCents(micros) };
      })
      .toSorted((left, right) => left.label.localeCompare(right.label));
    if (
      itemMicros !==
      nonnegativeBigInt(operation.retail_debit_micros, "retail operation")
    ) {
      throw new Error("retail cost operation does not match its items");
    }
    asTime(operation.occurred_at, "retail operation occurred_at");
    return {
      operationId: operation.operation_ref,
      description: operation.description || "Hosted work",
      status: "settled" as const,
      occurredAt: operation.occurred_at,
      totalCents: microsToDisplayCents(
        nonnegativeBigInt(operation.retail_debit_micros, "retail operation")
      ),
      items,
    };
  });
}

export function summarizeCapacityCosts(input: {
  reservations: CapacityBillingReservationRow[];
  costOperations: CapacityBillingCostOperationRow[];
  costItems: CapacityBillingCostItemRow[];
}): {
  openReservations: CapacityBillingSummaryReservation[];
  openReservationsCents: number;
  recentCosts: CapacityBillingSummaryCost[];
} {
  const openReservations = input.reservations.map((reservation) => ({
    id: reservation.reservation_ref,
    operationKind: "hosted_work",
    description: "Hosted work in progress",
    reservedCents: microsToReservedCents(
      nonnegativeBigInt(reservation.reserved_micros, "reserved microdollars")
    ),
    createdAt: reservation.created_at,
  }));
  const openReservationsCents = openReservations.reduce(
    (sum, reservation) =>
      addSafeInteger(sum, reservation.reservedCents, "open reservations"),
    0
  );
  const inProgress: CapacityBillingSummaryCost[] = input.reservations.map(
    (reservation) => ({
      operationId: reservation.operation_ref,
      description: "Hosted work in progress",
      status: "in_progress",
      occurredAt: reservation.created_at,
      totalCents: null,
      items: [],
    })
  );
  const recentCosts = [
    ...inProgress,
    ...settledCosts(input.costOperations, input.costItems),
  ]
    .toSorted(
      (left, right) =>
        asTime(right.occurredAt, "recent cost occurredAt") -
        asTime(left.occurredAt, "recent cost occurredAt")
    )
    .slice(0, 20);

  return { openReservations, openReservationsCents, recentCosts };
}
