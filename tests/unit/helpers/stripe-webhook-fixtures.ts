import type Stripe from "stripe";

import type { BillingAccount } from "../../../lib/billing/accounts";
import type { CapacityEntitlementSnapshot } from "../../../lib/billing/capacity-entitlement-webhooks";
import type {
  BillingBalance,
  BillingPeriodGrant,
  IncludedCreditExpiry,
  LedgerEntry,
} from "../../../lib/billing/ledger";

export async function loadWebhookRoute() {
  return import("../../../app/api/webhooks/stripe/route");
}

export function accountFixture(
  overrides: Partial<BillingAccount> = {}
): BillingAccount {
  return {
    id: "acct-1",
    owner_type: "team",
    owner_user_id: null,
    product_team_id: "team-1",
    stripe_customer_id: "cus_123",
    stripe_subscription_id: null,
    tier: "free",
    period_anchor: null,
    subscription_checkout_generation: 0,
    status: "active",
    ...overrides,
  };
}

export type Recorded = {
  ledger: LedgerEntry[];
  updates: Array<{ id: string; updates: Record<string, unknown> }>;
  capacitySnapshots: Array<{
    accountId: string;
    sourceEventId: string;
    effectiveAt: Date;
    snapshot: CapacityEntitlementSnapshot;
  }>;
};

export function makeDeps(overrides: {
  account?: BillingAccount;
  balance?: BillingBalance;
  subscription?: Partial<Stripe.Subscription>;
  paymentIntent?: Partial<Stripe.PaymentIntent>;
  refunds?: Array<Partial<Stripe.Refund>>;
  postedRefs?: Set<string>;
  capacityBillingOperationsEnabled?: boolean;
}) {
  const account = overrides.account ?? accountFixture();
  const recorded: Recorded = { ledger: [], updates: [], capacitySnapshots: [] };
  const postedRefs = overrides.postedRefs ?? new Set<string>();
  const deps = {
    findAccountByCustomer: async (customerId: string) =>
      customerId === account.stripe_customer_id ? account : null,
    findAccountById: async (id: string) => (id === account.id ? account : null),
    updateAccount: async (id: string, updates: Record<string, unknown>) => {
      recorded.updates.push({ id, updates });
    },
    postLedgerEntry: async (entry: LedgerEntry) => {
      if (postedRefs.has(entry.sourceRef)) return { posted: false };
      postedRefs.add(entry.sourceRef);
      recorded.ledger.push(entry);
      return { posted: true };
    },
    postBillingPeriodGrant: async (grant: BillingPeriodGrant) => {
      if (postedRefs.has(grant.grantSourceRef)) {
        return { posted: false, expiredCents: 0 };
      }
      postedRefs.add(grant.grantSourceRef);
      recorded.ledger.push({
        accountId: grant.accountId,
        deltaCents: grant.deltaCents,
        bucket: "included",
        kind: "grant",
        sourceRef: grant.grantSourceRef,
        period: grant.period,
        metadata: grant.metadata,
      });
      const expiredCents = overrides.balance?.includedCents ?? 0;
      if (expiredCents > 0) {
        postedRefs.add(grant.expirySourceRef);
        recorded.ledger.push({
          accountId: grant.accountId,
          deltaCents: -expiredCents,
          bucket: "included",
          kind: "grant_expiry",
          sourceRef: grant.expirySourceRef,
          period: grant.period,
        });
      }
      return { posted: true, expiredCents };
    },
    expireIncludedCredit: async (expiry: IncludedCreditExpiry) => {
      const expiredCents = overrides.balance?.includedCents ?? 0;
      if (expiredCents <= 0 || postedRefs.has(expiry.sourceRef)) return 0;
      postedRefs.add(expiry.sourceRef);
      recorded.ledger.push({
        accountId: expiry.accountId,
        deltaCents: -expiredCents,
        bucket: "included",
        kind: "grant_expiry",
        sourceRef: expiry.sourceRef,
      });
      return expiredCents;
    },
    retrieveSubscription: async () =>
      overrides.subscription as Stripe.Subscription,
    retrievePaymentIntent: async () =>
      overrides.paymentIntent as Stripe.PaymentIntent,
    listRefunds: async () => (overrides.refunds ?? []) as Stripe.Refund[],
    retrieveCharge: async () =>
      ({ id: "ch_1", customer: "cus_123" }) as Stripe.Charge,
    capacityBillingOperationsEnabled: () =>
      overrides.capacityBillingOperationsEnabled ?? false,
    applyCapacityEntitlementSnapshot: async (input: {
      accountId: string;
      sourceEventId: string;
      effectiveAt: Date;
      snapshot: CapacityEntitlementSnapshot;
    }) => {
      recorded.capacitySnapshots.push(input);
      return {
        applied: true,
        duplicate: false,
        stale: false,
        entitlementVersion: 1,
      };
    },
  };
  return { deps, recorded, postedRefs };
}

export function subscriptionFixture(
  lookupKey: string,
  subscriptionId = "sub_1"
): Partial<Stripe.Subscription> {
  return {
    id: subscriptionId,
    status: "active",
    customer: "cus_123",
    items: {
      data: [
        {
          // 2026-08-01T00:00:00Z
          current_period_start: 1785542400,
          price: { lookup_key: lookupKey, metadata: {} },
        },
      ],
    },
  } as unknown as Partial<Stripe.Subscription>;
}

export function invoicePaidEvent(): Stripe.Event {
  return {
    id: "evt_invoice_paid",
    type: "invoice.paid",
    data: {
      object: {
        id: "in_1",
        customer: "cus_123",
        parent: { subscription_details: { subscription: "sub_1" } },
      },
    },
  } as unknown as Stripe.Event;
}

export type QueryCall = {
  method: "insert" | "update" | "eq" | "is" | "lt" | "select" | "maybeSingle";
  column?: string;
  value?: unknown;
};

export function billingEventsClient(options: {
  insertError?: { code: string; message: string } | null;
  takeoverData?: Array<{ stripe_event_id: string }>;
  takeoverError?: { message: string } | null;
  processedAt?: string | null;
  lookupError?: { message: string } | null;
}) {
  const calls: QueryCall[] = [];
  let operation: "update" | "select" | null = null;
  const query = {
    insert(value: unknown) {
      calls.push({ method: "insert", value });
      return Promise.resolve({ error: options.insertError ?? null });
    },
    update(value: unknown) {
      operation = "update";
      calls.push({ method: "update", value });
      return query;
    },
    eq(column: string, value: unknown) {
      calls.push({ method: "eq", column, value });
      return query;
    },
    is(column: string, value: unknown) {
      calls.push({ method: "is", column, value });
      return query;
    },
    lt(column: string, value: unknown) {
      calls.push({ method: "lt", column, value });
      return query;
    },
    select(value: string) {
      calls.push({ method: "select", value });
      if (operation === "update") {
        return Promise.resolve({
          data: options.takeoverData ?? [],
          error: options.takeoverError ?? null,
        });
      }
      operation = "select";
      return query;
    },
    maybeSingle() {
      calls.push({ method: "maybeSingle" });
      return Promise.resolve({
        data: { processed_at: options.processedAt ?? null },
        error: options.lookupError ?? null,
      });
    },
    then(resolve: (value: { error: { message: string } | null }) => void) {
      resolve({ error: null });
    },
  };
  return {
    calls,
    client: {
      from(table: string) {
        if (table !== "billing_events") {
          throw new Error(`Unexpected table: ${table}`);
        }
        operation = null;
        return query;
      },
    },
  };
}

export { type SupabaseClient } from "@supabase/supabase-js";
export { type LedgerEntry } from "../../../lib/billing/ledger";
export { type BillingAccount } from "../../../lib/billing/accounts";
