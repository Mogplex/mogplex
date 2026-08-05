import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";

async function loadAnnualGrants() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/billing/annual-grants");
}

function subscription(
  lookupKey: string,
  status: Stripe.Subscription.Status = "active"
) {
  return {
    id: "sub-1",
    status,
    items: { data: [{ price: { lookup_key: lookupKey } }] },
  } as unknown as Stripe.Subscription;
}

test("annual grant periods start after the anchor day and skip invoice months", async () => {
  const { annualGrantPeriod } = await loadAnnualGrants();

  assert.equal(
    annualGrantPeriod("2026-08-15", new Date("2026-09-14T23:59:59Z")),
    null
  );
  assert.equal(
    annualGrantPeriod("2026-08-15", new Date("2026-09-15T00:00:00Z")),
    "2026-09"
  );
  assert.equal(
    annualGrantPeriod("2026-08-15", new Date("2027-08-15T00:00:00Z")),
    null
  );
});

test("month-end anchors clamp to the last UTC day", async () => {
  const { annualGrantPeriod } = await loadAnnualGrants();

  assert.equal(
    annualGrantPeriod("2026-01-31", new Date("2026-02-27T23:59:59Z")),
    null
  );
  assert.equal(
    annualGrantPeriod("2026-01-31", new Date("2026-02-28T00:00:00Z")),
    "2026-02"
  );
});

test("annual grant scheduling backfills every missed due month", async () => {
  const { annualGrantPeriodsDue } = await loadAnnualGrants();

  assert.deepEqual(
    annualGrantPeriodsDue("2026-01-31", new Date("2026-05-31T12:00:00.000Z")),
    ["2026-02", "2026-03", "2026-04", "2026-05"]
  );
  assert.equal(
    annualGrantPeriodsDue(
      "2026-01-31",
      new Date("2027-01-31T12:00:00.000Z")
    ).includes("2027-01"),
    false
  );
});

test("annual grant run skips Stripe when every due period is already posted", async () => {
  const { runAnnualIncludedUsageGrants } = await loadAnnualGrants();
  let stripeCalls = 0;
  const result = await runAnnualIncludedUsageGrants(
    new Date("2026-10-15T12:00:00Z"),
    {
      isBillingEnabled: () => true,
      loadCandidates: async () => [
        {
          id: "account-1",
          stripe_subscription_id: "sub-1",
          period_anchor: "2026-08-15",
          granted_periods: ["2026-09", "2026-10"],
        },
      ],
      retrieveSubscription: async () => {
        stripeCalls += 1;
        return subscription("pro_annual");
      },
    }
  );

  assert.equal(stripeCalls, 0);
  assert.equal(result.skipped, 1);
});

test("annual grant run posts missing periods oldest first", async () => {
  const { runAnnualIncludedUsageGrants } = await loadAnnualGrants();
  const periods: string[] = [];
  const result = await runAnnualIncludedUsageGrants(
    new Date("2026-11-15T12:00:00Z"),
    {
      isBillingEnabled: () => true,
      loadCandidates: async () => [
        {
          id: "account-1",
          stripe_subscription_id: "sub-1",
          period_anchor: "2026-08-15",
          granted_periods: ["2026-09"],
        },
      ],
      retrieveSubscription: async () => subscription("pro_annual"),
      postBillingPeriodGrant: async (grant) => {
        periods.push(grant.period);
        return { posted: true, expiredCents: 0 };
      },
    }
  );

  assert.deepEqual(periods, ["2026-10", "2026-11"]);
  assert.equal(result.granted, 1);
});

test("daily annual run grants due active plans and remains idempotent", async () => {
  const { runAnnualIncludedUsageGrants } = await loadAnnualGrants();
  const grants: unknown[] = [];
  let posted = true;
  const deps = {
    isBillingEnabled: () => true,
    loadCandidates: async () => [
      {
        id: "account-1",
        stripe_subscription_id: "sub-1",
        period_anchor: "2026-08-15",
      },
    ],
    retrieveSubscription: async () => subscription("pro_annual"),
    postBillingPeriodGrant: async (grant: unknown) => {
      grants.push(grant);
      const result = { posted, expiredCents: posted ? 125 : 0 };
      posted = false;
      return result;
    },
  };

  const first = await runAnnualIncludedUsageGrants(
    new Date("2026-09-15T12:00:00Z"),
    deps
  );
  const duplicate = await runAnnualIncludedUsageGrants(
    new Date("2026-09-16T12:00:00Z"),
    deps
  );

  assert.deepEqual(first, {
    scanned: 1,
    granted: 1,
    duplicates: 0,
    skipped: 0,
    errored: 0,
    disabled: false,
  });
  assert.deepEqual(duplicate, {
    scanned: 1,
    granted: 0,
    duplicates: 1,
    skipped: 0,
    errored: 0,
    disabled: false,
  });
  assert.deepEqual(grants[0], {
    accountId: "account-1",
    deltaCents: 2000,
    grantSourceRef: "grant:account-1:2026-09:sub-1",
    expirySourceRef: "grantexp:account-1:2026-09:sub-1",
    period: "2026-09",
    metadata: { source: "annual_schedule", plan: "pro_annual" },
  });
});

test("monthly, unpaid, not-yet-due, and malformed candidates are skipped", async () => {
  const { runAnnualIncludedUsageGrants } = await loadAnnualGrants();
  const candidates = [
    {
      id: "monthly",
      stripe_subscription_id: "sub-m",
      period_anchor: "2026-08-15",
    },
    {
      id: "past-due",
      stripe_subscription_id: "sub-p",
      period_anchor: "2026-08-15",
    },
    {
      id: "early",
      stripe_subscription_id: "sub-e",
      period_anchor: "2026-08-20",
    },
    {
      id: "invalid",
      stripe_subscription_id: "sub-i",
      period_anchor: "not-a-date",
    },
  ];
  const result = await runAnnualIncludedUsageGrants(
    new Date("2026-09-15T12:00:00Z"),
    {
      isBillingEnabled: () => true,
      loadCandidates: async () => candidates,
      retrieveSubscription: async (id: string) =>
        id === "sub-m"
          ? subscription("pro_monthly")
          : id === "sub-p"
            ? subscription("pro_annual", "past_due")
            : subscription("team_annual"),
      postBillingPeriodGrant: async () => {
        throw new Error("should not grant");
      },
    }
  );

  assert.deepEqual(result, {
    scanned: 4,
    granted: 0,
    duplicates: 0,
    skipped: 4,
    errored: 0,
    disabled: false,
  });
});

test("one Stripe failure does not prevent other annual grants", async () => {
  const { runAnnualIncludedUsageGrants } = await loadAnnualGrants();
  const result = await runAnnualIncludedUsageGrants(
    new Date("2026-09-15T12:00:00Z"),
    {
      isBillingEnabled: () => true,
      loadCandidates: async () => [
        {
          id: "bad",
          stripe_subscription_id: "sub-bad",
          period_anchor: "2026-08-15",
        },
        {
          id: "good",
          stripe_subscription_id: "sub-good",
          period_anchor: "2026-08-15",
        },
      ],
      retrieveSubscription: async (id: string) => {
        if (id === "sub-bad") throw new Error("Stripe unavailable");
        return subscription("team_annual");
      },
      postBillingPeriodGrant: async () => ({ posted: true, expiredCents: 0 }),
    }
  );

  assert.equal(result.granted, 1);
  assert.equal(result.errored, 1);
});

test("billing-disabled installs do not load subscriptions", async () => {
  const { runAnnualIncludedUsageGrants } = await loadAnnualGrants();
  let loaded = false;
  const result = await runAnnualIncludedUsageGrants(new Date(), {
    isBillingEnabled: () => false,
    loadCandidates: async () => {
      loaded = true;
      return [];
    },
  });

  assert.equal(loaded, false);
  assert.equal(result.disabled, true);
});
