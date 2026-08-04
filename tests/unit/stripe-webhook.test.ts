import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import type { BillingAccount } from "../../lib/billing/accounts";
import type { BillingBalance, LedgerEntry } from "../../lib/billing/ledger";

async function loadWebhookRoute() {
  return import("../../app/api/webhooks/stripe/route");
}

const ACCOUNT: BillingAccount = {
  id: "acct-1",
  owner_type: "team",
  owner_user_id: null,
  product_team_id: "team-1",
  stripe_customer_id: "cus_123",
  tier: "free",
  period_anchor: null,
  status: "active",
};

type Recorded = {
  ledger: LedgerEntry[];
  updates: Array<{ id: string; updates: Record<string, unknown> }>;
};

function makeDeps(overrides: {
  balance?: BillingBalance;
  subscription?: Partial<Stripe.Subscription>;
  refunds?: Array<Partial<Stripe.Refund>>;
  postedRefs?: Set<string>;
}) {
  const recorded: Recorded = { ledger: [], updates: [] };
  const postedRefs = overrides.postedRefs ?? new Set<string>();
  const deps = {
    findAccountByCustomer: async (customerId: string) =>
      customerId === ACCOUNT.stripe_customer_id ? ACCOUNT : null,
    findAccountById: async (id: string) => (id === ACCOUNT.id ? ACCOUNT : null),
    updateAccount: async (id: string, updates: Record<string, unknown>) => {
      recorded.updates.push({ id, updates });
    },
    postLedgerEntry: async (entry: LedgerEntry) => {
      if (postedRefs.has(entry.sourceRef)) return { posted: false };
      postedRefs.add(entry.sourceRef);
      recorded.ledger.push(entry);
      return { posted: true };
    },
    getBalance: async () =>
      overrides.balance ?? {
        includedCents: 0,
        purchasedCents: 0,
        totalCents: 0,
      },
    retrieveSubscription: async () =>
      overrides.subscription as Stripe.Subscription,
    listRefunds: async () => (overrides.refunds ?? []) as Stripe.Refund[],
    retrieveCharge: async () =>
      ({ id: "ch_1", customer: "cus_123" }) as Stripe.Charge,
  };
  return { deps, recorded, postedRefs };
}

function subscriptionFixture(lookupKey: string): Partial<Stripe.Subscription> {
  return {
    id: "sub_1",
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

function invoicePaidEvent(): Stripe.Event {
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

test("invoice.paid should post the grant and expire prior included leftover", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    balance: { includedCents: 350, purchasedCents: 0, totalCents: 350 },
    subscription: subscriptionFixture("pro_monthly"),
  });

  await route.handleStripeEvent(invoicePaidEvent(), deps);

  assert.deepEqual(
    recorded.ledger.map((entry) => [entry.kind, entry.deltaCents]),
    [
      ["grant", 2000],
      ["grant_expiry", -350],
    ]
  );
  assert.equal(recorded.ledger[0].sourceRef, "grant:acct-1:2026-08");
  assert.equal(recorded.ledger[1].sourceRef, "grantexp:acct-1:2026-08");
  assert.deepEqual(recorded.updates, [
    {
      id: "acct-1",
      updates: { tier: "pro", status: "active", period_anchor: "2026-08-01" },
    },
  ]);
});

test("invoice.paid redelivery should not double-post grant rows", async () => {
  const route = await loadWebhookRoute();
  const postedRefs = new Set<string>();
  const first = makeDeps({
    subscription: subscriptionFixture("team_monthly"),
    postedRefs,
  });
  await route.handleStripeEvent(invoicePaidEvent(), first.deps);
  assert.equal(first.recorded.ledger.length, 1); // no leftover → grant only

  // Second delivery sees the granted balance as leftover, but both
  // source_refs for the period are already claimed.
  const second = makeDeps({
    balance: { includedCents: 10000, purchasedCents: 0, totalCents: 10000 },
    subscription: subscriptionFixture("team_monthly"),
    postedRefs,
  });
  await route.handleStripeEvent(invoicePaidEvent(), second.deps);
  assert.equal(second.recorded.ledger.length, 0);
});

test("payment_intent.succeeded should credit the purchased bucket when metadata marks a top-up", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({});
  const event = {
    id: "evt_pi",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_1",
        amount_received: 2500,
        metadata: { kind: "topup", billing_account_id: "acct-1" },
      },
    },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.deepEqual(
    recorded.ledger.map((entry) => [
      entry.kind,
      entry.bucket,
      entry.deltaCents,
      entry.sourceRef,
    ]),
    [["topup", "purchased", 2500, "topup:pi_1"]]
  );
});

test("payment_intent.succeeded should ignore non-topup payments", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({});
  const event = {
    id: "evt_pi2",
    type: "payment_intent.succeeded",
    data: { object: { id: "pi_2", amount_received: 2000, metadata: {} } },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);
  assert.equal(recorded.ledger.length, 0);
});

test("charge.refunded should post one negative purchased entry per refund", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    refunds: [
      { id: "re_1", amount: 1000 },
      { id: "re_2", amount: 500 },
    ],
  });
  const event = {
    id: "evt_refund",
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_1",
        metadata: { kind: "topup", billing_account_id: "acct-1" },
      },
    },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.deepEqual(
    recorded.ledger.map((entry) => [entry.deltaCents, entry.sourceRef]),
    [
      [-1000, "refund:re_1"],
      [-500, "refund:re_2"],
    ]
  );
});

test("customer.subscription.deleted should drop the tier to free without touching the ledger", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({});
  const event = {
    id: "evt_sub_del",
    type: "customer.subscription.deleted",
    data: {
      object: {
        id: "sub_1",
        status: "canceled",
        customer: "cus_123",
        items: { data: [] },
      },
    },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.deepEqual(recorded.updates, [
    { id: "acct-1", updates: { tier: "free" } },
  ]);
  assert.equal(recorded.ledger.length, 0);
});

test("charge.dispute.created should freeze top-ups for the org", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({});
  const event = {
    id: "evt_dispute",
    type: "charge.dispute.created",
    data: { object: { id: "dp_1", charge: "ch_1" } },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.deepEqual(recorded.updates, [
    { id: "acct-1", updates: { status: "frozen_topups" } },
  ]);
});

test("unhandled event types should be ignored", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({});
  const event = {
    id: "evt_other",
    type: "setup_intent.succeeded",
    data: { object: {} },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);
  assert.equal(recorded.ledger.length, 0);
  assert.equal(recorded.updates.length, 0);
});
