import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import type { BillingAccount } from "../../lib/billing/accounts";
import type { BillingBalance, LedgerEntry } from "../../lib/billing/ledger";

async function loadWebhookRoute() {
  return import("../../app/api/webhooks/stripe/route");
}

function accountFixture(
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
    status: "active",
    ...overrides,
  };
}

type Recorded = {
  ledger: LedgerEntry[];
  updates: Array<{ id: string; updates: Record<string, unknown> }>;
};

function makeDeps(overrides: {
  account?: BillingAccount;
  balance?: BillingBalance;
  subscription?: Partial<Stripe.Subscription>;
  paymentIntent?: Partial<Stripe.PaymentIntent>;
  refunds?: Array<Partial<Stripe.Refund>>;
  postedRefs?: Set<string>;
}) {
  const account = overrides.account ?? accountFixture();
  const recorded: Recorded = { ledger: [], updates: [] };
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
    getBalance: async () =>
      overrides.balance ?? {
        includedCents: 0,
        purchasedCents: 0,
        totalCents: 0,
      },
    retrieveSubscription: async () =>
      overrides.subscription as Stripe.Subscription,
    retrievePaymentIntent: async () =>
      overrides.paymentIntent as Stripe.PaymentIntent,
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
      updates: {
        tier: "pro",
        stripe_subscription_id: "sub_1",
        status: "active",
        period_anchor: "2026-08-01",
      },
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

test("invoice.paid should NOT lift a dispute freeze on routine renewal", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    account: accountFixture({ status: "frozen_topups", tier: "pro" }),
    subscription: subscriptionFixture("pro_monthly"),
  });

  await route.handleStripeEvent(invoicePaidEvent(), deps);

  assert.equal(recorded.updates.length, 1);
  assert.equal(recorded.updates[0].updates.status, undefined);
  assert.equal(recorded.updates[0].updates.tier, "pro");
});

test("invoice.payment_failed should mark the account past_due", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({});
  const event = {
    id: "evt_inv_failed",
    type: "invoice.payment_failed",
    data: { object: { id: "in_2", customer: "cus_123" } },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.deepEqual(recorded.updates, [
    { id: "acct-1", updates: { status: "past_due" } },
  ]);
});

test("checkout.session.completed should link the Stripe customer to the account", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    account: accountFixture({ stripe_customer_id: null }),
  });
  const event = {
    id: "evt_checkout",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_1",
        mode: "subscription",
        client_reference_id: "acct-1",
        customer: "cus_new",
      },
    },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.deepEqual(recorded.updates, [
    { id: "acct-1", updates: { stripe_customer_id: "cus_new" } },
  ]);
});

test("payment_intent.succeeded should credit the stamped pre-tax amount, not amount_received", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({});
  const event = {
    id: "evt_pi",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_1",
        amount_received: 2718, // $25 + tax
        metadata: {
          kind: "topup",
          billing_account_id: "acct-1",
          credit_cents: "2500",
        },
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

test("payment_intent.succeeded should fall back to amount_received without a stamp", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({});
  const event = {
    id: "evt_pi3",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_3",
        amount_received: 1000,
        metadata: { kind: "topup", billing_account_id: "acct-1" },
      },
    },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);
  assert.equal(recorded.ledger[0].deltaCents, 1000);
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

test("charge.refunded should reverse the credited amount via PaymentIntent metadata", async () => {
  const route = await loadWebhookRoute();
  // Charge has NO topup metadata (Stripe does not copy PI metadata onto the
  // charge) — the handler must resolve it from the PaymentIntent.
  const { deps, recorded } = makeDeps({
    paymentIntent: {
      id: "pi_1",
      amount_received: 2718,
      metadata: {
        kind: "topup",
        billing_account_id: "acct-1",
        credit_cents: "2500",
      },
    } as unknown as Stripe.PaymentIntent,
    refunds: [{ id: "re_1", amount: 2718 }],
  });
  const event = {
    id: "evt_refund",
    type: "charge.refunded",
    data: { object: { id: "ch_1", payment_intent: "pi_1", metadata: {} } },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  // Full gross refund reverses exactly the credited (pre-tax) amount.
  assert.deepEqual(
    recorded.ledger.map((entry) => [entry.deltaCents, entry.sourceRef]),
    [[-2500, "refund:re_1"]]
  );
});

test("charge.refunded should ignore non-topup charges", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    paymentIntent: {
      id: "pi_sub",
      amount_received: 2000,
      metadata: {},
    } as unknown as Stripe.PaymentIntent,
    refunds: [{ id: "re_2", amount: 2000 }],
  });
  const event = {
    id: "evt_refund2",
    type: "charge.refunded",
    data: { object: { id: "ch_2", payment_intent: "pi_sub", metadata: {} } },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);
  assert.equal(recorded.ledger.length, 0);
});

test("customer.subscription.updated should sync tier and subscription id", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({});
  const event = {
    id: "evt_sub_upd",
    type: "customer.subscription.updated",
    data: { object: subscriptionFixture("team_monthly") },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.deepEqual(recorded.updates, [
    {
      id: "acct-1",
      updates: { tier: "team", stripe_subscription_id: "sub_1" },
    },
  ]);
});

test("customer.subscription.deleted should drop to free and clear past_due", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    account: accountFixture({ status: "past_due", tier: "pro" }),
  });
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
    {
      id: "acct-1",
      updates: {
        tier: "free",
        stripe_subscription_id: null,
        status: "active",
      },
    },
  ]);
  assert.equal(recorded.ledger.length, 0);
});

test("customer.subscription.deleted should preserve a dispute freeze", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    account: accountFixture({ status: "frozen_topups", tier: "pro" }),
  });
  const event = {
    id: "evt_sub_del2",
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

  assert.equal(recorded.updates[0].updates.status, undefined);
  assert.equal(recorded.updates[0].updates.tier, "free");
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
