export const CAPACITY_CATALOG_VERSION = "capacity_v2";
export const LOGICAL_BYTES_PER_GB = 1_000_000_000;

export type IndividualCapacityPlanCode = "pro" | "plus" | "max";
export type ContractCapacityPlanCode = "business" | "enterprise";
export type CapacityPlanCode =
  | IndividualCapacityPlanCode
  | ContractCapacityPlanCode;
export type CapacityPlanInterval = "month" | "year";
export type CapacityAddOnKind = "concurrency" | "retained_data";

export type CapacityHostedUsagePreset = {
  lookupKey: string;
  name: string;
  creditCents: number;
  chargeCents: number;
};

export type IndividualCapacityPlan = {
  code: IndividualCapacityPlanCode;
  name: string;
  audience: "individual";
  maxNamedUsers: 1;
  concurrency: number;
  retainedDataBytes: number;
  hostedUsageCents: number;
  prices: Record<CapacityPlanInterval, CapacityPrice>;
};

export type ContractCapacityPlan = {
  code: ContractCapacityPlanCode;
  name: string;
  audience: "business" | "enterprise";
  maxNamedUsers: null;
  concurrency: null;
  retainedDataBytes: null;
  hostedUsageCents: null;
};

export type CapacityPrice = {
  lookupKey: string;
  amountCents: number;
  interval: CapacityPlanInterval;
};

export type CapacityAddOn = {
  lookupKey: string;
  name: string;
  kind: CapacityAddOnKind;
  amountCents: number;
  interval: "month";
  concurrencyDelta: number;
  retainedDataBytesDelta: number;
};

export type CapacityEntitlementItemVersion = {
  itemRef: string;
  priceLookupKey: string;
  quantity: number;
  effectiveAt: Date;
  recordedAt?: Date;
};

export type CapacityEntitlements = {
  catalogVersion: typeof CAPACITY_CATALOG_VERSION;
  planCode: IndividualCapacityPlanCode;
  maxNamedUsers: 1;
  concurrency: number;
  retainedDataBytes: number;
  hostedUsageCents: number;
  recurringAddOnCents: number;
  activeAddOns: ReadonlyArray<{
    itemRef: string;
    lookupKey: string;
    name: string;
    quantity: number;
    amountCents: number;
  }>;
};

export const INDIVIDUAL_CAPACITY_PLANS: Readonly<
  Record<IndividualCapacityPlanCode, IndividualCapacityPlan>
> = {
  pro: {
    code: "pro",
    name: "Pro",
    audience: "individual",
    maxNamedUsers: 1,
    concurrency: 5,
    retainedDataBytes: LOGICAL_BYTES_PER_GB,
    hostedUsageCents: 2_000,
    prices: {
      month: {
        lookupKey: "capacity_v2_pro_monthly",
        amountCents: 2_000,
        interval: "month",
      },
      year: {
        lookupKey: "capacity_v2_pro_annual",
        amountCents: 20_400,
        interval: "year",
      },
    },
  },
  plus: {
    code: "plus",
    name: "Plus",
    audience: "individual",
    maxNamedUsers: 1,
    concurrency: 25,
    retainedDataBytes: 5 * LOGICAL_BYTES_PER_GB,
    hostedUsageCents: 10_000,
    prices: {
      month: {
        lookupKey: "capacity_v2_plus_monthly",
        amountCents: 10_000,
        interval: "month",
      },
      year: {
        lookupKey: "capacity_v2_plus_annual",
        amountCents: 102_000,
        interval: "year",
      },
    },
  },
  max: {
    code: "max",
    name: "Max",
    audience: "individual",
    maxNamedUsers: 1,
    concurrency: 50,
    retainedDataBytes: 10 * LOGICAL_BYTES_PER_GB,
    hostedUsageCents: 20_000,
    prices: {
      month: {
        lookupKey: "capacity_v2_max_monthly",
        amountCents: 20_000,
        interval: "month",
      },
      year: {
        lookupKey: "capacity_v2_max_annual",
        amountCents: 204_000,
        interval: "year",
      },
    },
  },
};

export const CONTRACT_CAPACITY_PLANS: Readonly<
  Record<ContractCapacityPlanCode, ContractCapacityPlan>
> = {
  business: {
    code: "business",
    name: "Business",
    audience: "business",
    maxNamedUsers: null,
    concurrency: null,
    retainedDataBytes: null,
    hostedUsageCents: null,
  },
  enterprise: {
    code: "enterprise",
    name: "Enterprise",
    audience: "enterprise",
    maxNamedUsers: null,
    concurrency: null,
    retainedDataBytes: null,
    hostedUsageCents: null,
  },
};

export const CAPACITY_ADD_ONS: readonly CapacityAddOn[] = [
  {
    lookupKey: "capacity_v2_concurrency_10_monthly",
    name: "Parallel agent runs +10",
    kind: "concurrency",
    amountCents: 500,
    interval: "month",
    concurrencyDelta: 10,
    retainedDataBytesDelta: 0,
  },
  {
    lookupKey: "capacity_v2_concurrency_50_monthly",
    name: "Parallel agent runs +50",
    kind: "concurrency",
    amountCents: 1_500,
    interval: "month",
    concurrencyDelta: 50,
    retainedDataBytesDelta: 0,
  },
  {
    lookupKey: "capacity_v2_retained_data_1gb_monthly",
    name: "Storage +1 GB",
    kind: "retained_data",
    amountCents: 200,
    interval: "month",
    concurrencyDelta: 0,
    retainedDataBytesDelta: LOGICAL_BYTES_PER_GB,
  },
  {
    lookupKey: "capacity_v2_retained_data_10gb_monthly",
    name: "Storage +10 GB",
    kind: "retained_data",
    amountCents: 1_500,
    interval: "month",
    concurrencyDelta: 0,
    retainedDataBytesDelta: 10 * LOGICAL_BYTES_PER_GB,
  },
  {
    lookupKey: "capacity_v2_retained_data_50gb_monthly",
    name: "Storage +50 GB",
    kind: "retained_data",
    amountCents: 6_000,
    interval: "month",
    concurrencyDelta: 0,
    retainedDataBytesDelta: 50 * LOGICAL_BYTES_PER_GB,
  },
  {
    lookupKey: "capacity_v2_retained_data_100gb_monthly",
    name: "Storage +100 GB",
    kind: "retained_data",
    amountCents: 10_000,
    interval: "month",
    concurrencyDelta: 0,
    retainedDataBytesDelta: 100 * LOGICAL_BYTES_PER_GB,
  },
];

export const CAPACITY_HOSTED_USAGE_MIN_CENTS = 100;
export const CAPACITY_HOSTED_USAGE_MAX_CENTS = 100_000;

export const CAPACITY_HOSTED_USAGE_PRESETS: readonly CapacityHostedUsagePreset[] =
  [100, 1_000, 2_500, 10_000, 25_000, 50_000, 100_000].map((creditCents) => ({
    lookupKey: `${CAPACITY_CATALOG_VERSION}_hosted_usage_credit_${creditCents / 100}`,
    name: `$${creditCents / 100} Inference`,
    creditCents,
    // Gate A approved face-value purchases with no checkout service charge.
    chargeCents: creditCents,
  }));

const ADD_ON_BY_LOOKUP_KEY = new Map(
  CAPACITY_ADD_ONS.map((addOn) => [addOn.lookupKey, addOn])
);

const HOSTED_USAGE_BY_LOOKUP_KEY = new Map(
  CAPACITY_HOSTED_USAGE_PRESETS.map((preset) => [preset.lookupKey, preset])
);

export function findCapacityAddOn(lookupKey: string): CapacityAddOn | null {
  return ADD_ON_BY_LOOKUP_KEY.get(lookupKey) ?? null;
}

export function findCapacityHostedUsagePreset(
  lookupKey: string
): CapacityHostedUsagePreset | null {
  return HOSTED_USAGE_BY_LOOKUP_KEY.get(lookupKey) ?? null;
}

export function findIndividualCapacityPrice(lookupKey: string): {
  plan: IndividualCapacityPlan;
  price: CapacityPrice;
} | null {
  for (const plan of Object.values(INDIVIDUAL_CAPACITY_PLANS)) {
    for (const price of Object.values(plan.prices)) {
      if (price.lookupKey === lookupKey) return { plan, price };
    }
  }
  return null;
}

export function findCapacityRecurringPrice(lookupKey: string): {
  amountCents: number;
  interval: CapacityPlanInterval;
} | null {
  const planPrice = findIndividualCapacityPrice(lookupKey)?.price;
  if (planPrice) return planPrice;
  const addOn = findCapacityAddOn(lookupKey);
  return addOn
    ? { amountCents: addOn.amountCents, interval: addOn.interval }
    : null;
}

function compareItemVersions(
  left: CapacityEntitlementItemVersion,
  right: CapacityEntitlementItemVersion
): number {
  const effectiveOrder =
    left.effectiveAt.getTime() - right.effectiveAt.getTime();
  if (effectiveOrder !== 0) return effectiveOrder;
  return (left.recordedAt?.getTime() ?? 0) - (right.recordedAt?.getTime() ?? 0);
}

function addSafeInteger(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`${label} exceeds the safe integer range`);
  }
  return result;
}

export function currentCapacityEntitlementItems(
  versions: readonly CapacityEntitlementItemVersion[],
  asOf: Date = new Date()
): CapacityEntitlementItemVersion[] {
  const current = new Map<string, CapacityEntitlementItemVersion>();
  for (const version of versions) {
    if (version.effectiveAt > asOf) continue;
    if (!Number.isSafeInteger(version.quantity) || version.quantity < 0) {
      throw new RangeError(
        `invalid entitlement quantity for ${version.itemRef}`
      );
    }
    const prior = current.get(version.itemRef);
    if (!prior || compareItemVersions(prior, version) < 0) {
      current.set(version.itemRef, version);
    }
  }
  return [...current.values()].filter((item) => item.quantity > 0);
}

export function calculateCapacityEntitlements(
  planCode: IndividualCapacityPlanCode,
  versions: readonly CapacityEntitlementItemVersion[],
  asOf: Date = new Date()
): CapacityEntitlements {
  const plan = INDIVIDUAL_CAPACITY_PLANS[planCode];
  let { concurrency, retainedDataBytes } = plan;
  let recurringAddOnCents = 0;
  const activeAddOns: CapacityEntitlements["activeAddOns"][number][] = [];

  for (const item of currentCapacityEntitlementItems(versions, asOf)) {
    const addOn = ADD_ON_BY_LOOKUP_KEY.get(item.priceLookupKey);
    if (!addOn) {
      throw new TypeError(
        `unknown capacity add-on lookup key ${item.priceLookupKey}`
      );
    }
    concurrency = addSafeInteger(
      concurrency,
      addOn.concurrencyDelta * item.quantity,
      "concurrency"
    );
    retainedDataBytes = addSafeInteger(
      retainedDataBytes,
      addOn.retainedDataBytesDelta * item.quantity,
      "retained data"
    );
    recurringAddOnCents = addSafeInteger(
      recurringAddOnCents,
      addOn.amountCents * item.quantity,
      "recurring add-on price"
    );
    activeAddOns.push({
      itemRef: item.itemRef,
      lookupKey: addOn.lookupKey,
      name: addOn.name,
      quantity: item.quantity,
      amountCents: addOn.amountCents * item.quantity,
    });
  }

  return {
    catalogVersion: CAPACITY_CATALOG_VERSION,
    planCode,
    maxNamedUsers: 1,
    concurrency,
    retainedDataBytes,
    hostedUsageCents: plan.hostedUsageCents,
    recurringAddOnCents,
    activeAddOns,
  };
}
