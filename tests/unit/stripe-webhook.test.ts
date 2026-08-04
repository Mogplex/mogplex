import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingAccount } from "../../lib/billing/accounts";
import type {
  BillingBalance,
  BillingPeriodGrant,
  LedgerEntry,
} from "../../lib/billing/ledger";

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

function subscriptionFixture(
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
  assert.equal(recorded.ledger[0].sourceRef, "grant:acct-1:2026-08:sub_1");
  assert.equal(recorded.ledger[1].sourceRef, "grantexp:acct-1:2026-08:sub_1");
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

test("invoice.paid should grant a same-month re-subscription", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    account: accountFixture({ tier: "free" }),
    subscription: subscriptionFixture("pro_monthly", "sub_new"),
    postedRefs: new Set([
      "grant:acct-1:2026-08",
      "grant:acct-1:2026-08:sub_old",
    ]),
  });

  await route.handleStripeEvent(invoicePaidEvent(), deps);

  assert.deepEqual(
    recorded.ledger.map((entry) => [entry.kind, entry.sourceRef]),
    [["grant", "grant:acct-1:2026-08:sub_new"]]
  );
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

test("checkout.session.completed should not replace an existing Stripe customer", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({});
  const event = {
    id: "evt_checkout_stale",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_stale",
        mode: "subscription",
        client_reference_id: "acct-1",
        customer: "cus_stale",
      },
    },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.deepEqual(recorded.updates, []);
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

test("payment_intent.succeeded should reject a missing pre-tax credit stamp", async () => {
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

  await assert.rejects(
    route.handleStripeEvent(event, deps),
    /missing a valid credit_cents stamp/
  );
  assert.equal(recorded.ledger.length, 0);
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

test("multiple partial refunds should cumulatively reverse the exact credited amount", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    paymentIntent: {
      id: "pi_partial",
      amount_received: 3,
      metadata: {
        kind: "topup",
        billing_account_id: "acct-1",
        credit_cents: "2",
      },
    } as unknown as Stripe.PaymentIntent,
    refunds: [
      { id: "re_2", amount: 1, created: 2 },
      { id: "re_1", amount: 1, created: 1 },
      { id: "re_3", amount: 1, created: 3 },
    ],
  });
  const event = {
    id: "evt_partial_refunds",
    type: "charge.refunded",
    data: {
      object: { id: "ch_partial", payment_intent: "pi_partial", metadata: {} },
    },
  } as unknown as Stripe.Event;

  await route.handleStripeEvent(event, deps);

  assert.deepEqual(
    recorded.ledger.map((entry) => [entry.sourceRef, entry.deltaCents]),
    [
      ["refund:re_1", -1],
      ["refund:re_2", 0],
      ["refund:re_3", -1],
    ]
  );
  assert.equal(
    recorded.ledger.reduce((sum, entry) => sum + entry.deltaCents, 0),
    -2
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

test("customer.subscription.updated should defer a paid tier change until invoice.paid", async () => {
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
      updates: { stripe_subscription_id: "sub_1" },
    },
  ]);
});

test("invoice.paid should add the included-usage delta for a mid-cycle upgrade", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    account: accountFixture({ tier: "pro" }),
    subscription: subscriptionFixture("team_monthly"),
    postedRefs: new Set(["grant:acct-1:2026-08:sub_1"]),
  });

  await route.handleStripeEvent(invoicePaidEvent(), deps);

  assert.deepEqual(
    recorded.ledger.map((entry) => [entry.kind, entry.deltaCents]),
    [["grant_adjustment", 8000]]
  );
  assert.equal(
    recorded.ledger[0]?.sourceRef,
    "grantadj:acct-1:sub_1:2026-08:team_monthly"
  );
  assert.equal(recorded.updates[0]?.updates.tier, "team");
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

test("customer.subscription.deleted should expire included credit but preserve purchased credit", async () => {
  const route = await loadWebhookRoute();
  const { deps, recorded } = makeDeps({
    account: accountFixture({ tier: "team" }),
    balance: {
      includedCents: 4200,
      purchasedCents: 2500,
      totalCents: 6700,
    },
  });
  const event = {
    id: "evt_sub_del_credit",
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

  assert.deepEqual(
    recorded.ledger.map((entry) => [
      entry.kind,
      entry.bucket,
      entry.deltaCents,
      entry.sourceRef,
    ]),
    [["grant_expiry", "included", -4200, "grantexp:acct-1:cancel:sub_1"]]
  );
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

type QueryCall = {
  method: "insert" | "update" | "delete" | "eq" | "is" | "lt" | "select";
  column?: string;
  value?: unknown;
};

function billingEventsClient(options: {
  insertError?: { code: string; message: string } | null;
  takeoverData?: Array<{ stripe_event_id: string }>;
  takeoverError?: { message: string } | null;
  releaseError?: { message: string } | null;
}) {
  const calls: QueryCall[] = [];
  let operation: "update" | "delete" | null = null;
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
    delete() {
      operation = "delete";
      calls.push({ method: "delete" });
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
      return Promise.resolve({
        data: options.takeoverData ?? [],
        error: options.takeoverError ?? null,
      });
    },
    then(resolve: (value: { error: { message: string } | null }) => void) {
      resolve({
        error: operation === "delete" ? (options.releaseError ?? null) : null,
      });
    },
  };
  return {
    calls,
    client: {
      from(table: string) {
        assert.equal(table, "billing_events");
        return query;
      },
    },
  };
}

test("event claims insert a fresh event", async () => {
  const route = await loadWebhookRoute();
  const { client, calls } = billingEventsClient({});
  const event = {
    id: "evt_fresh",
    type: "invoice.paid",
    data: { object: {} },
  } as Stripe.Event;

  assert.equal(
    await route.claimStripeEvent(
      event,
      client as unknown as SupabaseClient,
      () => new Date("2026-08-04T20:00:00.000Z")
    ),
    true
  );
  assert.equal(calls[0]?.method, "insert");
});

test("event claims take over only stale unprocessed duplicate rows", async () => {
  const route = await loadWebhookRoute();
  const { client, calls } = billingEventsClient({
    insertError: { code: "23505", message: "duplicate" },
    takeoverData: [{ stripe_event_id: "evt_stale" }],
  });
  const event = {
    id: "evt_stale",
    type: "invoice.paid",
    data: { object: {} },
  } as Stripe.Event;

  assert.equal(
    await route.claimStripeEvent(
      event,
      client as unknown as SupabaseClient,
      () => new Date("2026-08-04T20:00:00.000Z")
    ),
    true
  );
  assert.ok(
    calls.some(
      (call) =>
        call.method === "is" &&
        call.column === "processed_at" &&
        call.value === null
    )
  );
  assert.ok(
    calls.some(
      (call) =>
        call.method === "lt" &&
        call.column === "received_at" &&
        call.value === "2026-08-04T19:50:00.000Z"
    )
  );
});

test("event claims skip a fresh or already processed duplicate", async () => {
  const route = await loadWebhookRoute();
  const { client } = billingEventsClient({
    insertError: { code: "23505", message: "duplicate" },
  });
  const event = {
    id: "evt_duplicate",
    type: "invoice.paid",
    data: { object: {} },
  } as Stripe.Event;

  assert.equal(
    await route.claimStripeEvent(event, client as unknown as SupabaseClient),
    false
  );
});

test("event claim storage failures surface instead of acknowledging the webhook", async () => {
  const route = await loadWebhookRoute();
  const { client } = billingEventsClient({
    insertError: { code: "08006", message: "connection failed" },
  });
  const event = {
    id: "evt_db_error",
    type: "invoice.paid",
    data: { object: {} },
  } as Stripe.Event;

  await assert.rejects(
    route.claimStripeEvent(event, client as unknown as SupabaseClient),
    /billing_events insert failed: connection failed/
  );
});

test("event claim release targets the claimed Stripe event", async () => {
  const route = await loadWebhookRoute();
  const { client, calls } = billingEventsClient({});

  await route.releaseStripeEvent(
    "evt_release",
    client as unknown as SupabaseClient
  );

  assert.ok(calls.some((call) => call.method === "delete"));
  assert.ok(
    calls.some(
      (call) =>
        call.method === "eq" &&
        call.column === "stripe_event_id" &&
        call.value === "evt_release"
    )
  );
});

test("processed event claims record the completion timestamp", async () => {
  const route = await loadWebhookRoute();
  const { client, calls } = billingEventsClient({});

  await route.markStripeEventProcessed(
    "evt_processed",
    client as unknown as SupabaseClient,
    () => new Date("2026-08-04T20:05:00.000Z")
  );

  assert.ok(
    calls.some(
      (call) =>
        call.method === "update" &&
        (call.value as { processed_at?: string }).processed_at ===
          "2026-08-04T20:05:00.000Z"
    )
  );
  assert.ok(
    calls.some(
      (call) =>
        call.method === "eq" &&
        call.column === "stripe_event_id" &&
        call.value === "evt_processed"
    )
  );
});
