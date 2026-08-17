import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import type { BillingAccount } from "../../lib/billing/accounts";
import type {
  BillingAccountEventListener,
  BillingAccountEventRecord,
} from "../../app/api/billing/capacity/events/route";

type MockListener = BillingAccountEventListener & {
  emit: (payload: { accountId: string; sequence: string }) => void;
};

const account: BillingAccount = {
  id: "account-1",
  owner_type: "user",
  owner_user_id: "user-1",
  product_team_id: null,
  stripe_customer_id: null,
  stripe_subscription_id: null,
  tier: "pro",
  period_anchor: "2026-08-16",
  subscription_checkout_generation: 0,
  status: "active",
};

const personalScopeResolution = {
  ok: true as const,
  scope: {
    kind: "personal" as const,
    userId: "user-1",
    productTeamId: null,
  },
};

function createMockListener(onEnd?: () => void): MockListener {
  let handler:
    | ((payload: { accountId: string; sequence: string }) => void)
    | undefined;
  return {
    onNotification: (nextHandler) => {
      handler = nextHandler;
    },
    end: async () => {
      onEnd?.();
    },
    emit: (payload) => handler?.(payload),
  };
}

function eventRow(
  sequence: number,
  overrides: Partial<BillingAccountEventRecord> = {}
): BillingAccountEventRecord {
  return {
    account_id: "account-1",
    sequence: sequence.toString(),
    event_type: "billing.summary.changed",
    source_event_id: `evt-${sequence}`,
    committed_at: `2026-08-17T00:00:0${sequence}.000Z`,
    ...overrides,
  };
}

async function loadRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  process.env.DATABASE_URL_UNPOOLED ||= "postgres://test:test@localhost/test";
  delete process.env.PLAYWRIGHT;
  return import("../../app/api/billing/capacity/events/route");
}

test("billing event stream authenticates before resolving scope", async () => {
  const { createBillingAccountEventsGetHandler } = await loadRoute();
  let scopeCalls = 0;
  const handler = createBillingAccountEventsGetHandler({
    requireUserId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    resolveProductResourceScope: async () => {
      scopeCalls += 1;
      return personalScopeResolution;
    },
  });

  const response = await handler(
    new Request("https://example.com/api/billing/capacity/events?after=0")
  );

  assert.equal(response.status, 401);
  assert.equal(scopeCalls, 0);
});

test("billing event stream rejects an invalid cursor before account access", async () => {
  const { createBillingAccountEventsGetHandler } = await loadRoute();
  let accountCalls = 0;
  const handler = createBillingAccountEventsGetHandler({
    requireUserId: async () => "user-1",
    resolveProductResourceScope: async () => personalScopeResolution,
    getOrCreateBillingAccount: async () => {
      accountCalls += 1;
      return account;
    },
  });

  const response = await handler(
    new Request(
      "https://example.com/api/billing/capacity/events?after=1%20OR%201=1"
    )
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Invalid billing event cursor",
  });
  assert.equal(accountCalls, 0);
});

test("billing event stream replays durable rows then follows only its account", async () => {
  const { createBillingAccountEventsGetHandler } = await loadRoute();
  const listener = createMockListener();
  const calls: Array<{ accountId: string; afterSequence: string }> = [];
  const rows = new Map<string, BillingAccountEventRecord[]>([
    ["4", [eventRow(5, { event_type: "billing.capacity.change_applied" })]],
    ["5", [eventRow(6, { event_type: "billing.hosted_usage.added" })]],
    ["6", []],
  ]);
  const handler = createBillingAccountEventsGetHandler({
    requireUserId: async () => "user-1",
    resolveProductResourceScope: async () => personalScopeResolution,
    getOrCreateBillingAccount: async (scope) => {
      assert.deepEqual(scope, personalScopeResolution.scope);
      return account;
    },
    createListener: async () => listener,
    loadEventsAfter: async (input) => {
      calls.push({
        accountId: input.accountId,
        afterSequence: input.afterSequence,
      });
      return rows.get(input.afterSequence) ?? [];
    },
  });
  const response = await handler(
    new Request("https://example.com/api/billing/capacity/events?after=1", {
      headers: { "Last-Event-ID": "4" },
    })
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/event-stream");
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  assert.equal(decoder.decode((await reader.read()).value), ": connected\n\n");
  const replay = decoder.decode((await reader.read()).value);
  assert.match(replay, /^id: 5\n/);
  assert.match(replay, /event: billing\.capacity\.change_applied/);
  assert.match(replay, /"accountId":"account-1"/);
  assert.match(replay, /"sourceEventId":"evt-5"/);
  assert.deepEqual(calls, [{ accountId: "account-1", afterSequence: "4" }]);

  listener.emit({ accountId: "account-other", sequence: "999" });
  await Promise.resolve();
  assert.equal(calls.length, 1);

  listener.emit({ accountId: "account-1", sequence: "6" });
  const live = decoder.decode((await reader.read()).value);
  assert.match(live, /^id: 6\n/);
  assert.match(live, /event: billing\.hosted_usage\.added/);
  assert.deepEqual(calls.at(-1), {
    accountId: "account-1",
    afterSequence: "5",
  });
  await reader.cancel();
});

test("billing event stream permits a team viewer but binds the team account", async () => {
  const { createBillingAccountEventsGetHandler } = await loadRoute();
  let ended = 0;
  const handler = createBillingAccountEventsGetHandler({
    requireUserId: async () => "viewer-1",
    resolveProductResourceScope: async () => ({
      ok: true,
      scope: {
        kind: "team",
        userId: "viewer-1",
        productTeamId: "team-1",
      },
      capabilities: new Set(),
    }),
    getOrCreateBillingAccount: async (scope) => {
      assert.equal(scope.kind, "team");
      return {
        ...account,
        id: "team-account-1",
        owner_type: "team",
        owner_user_id: null,
        product_team_id: "team-1",
      };
    },
    createListener: async () => createMockListener(() => (ended += 1)),
    loadEventsAfter: async (input) => {
      assert.equal(input.accountId, "team-account-1");
      return [];
    },
  });

  const response = await handler(
    new Request("https://example.com/api/billing/capacity/events?after=0")
  );
  const reader = response.body!.getReader();
  assert.equal(
    new TextDecoder().decode((await reader.read()).value),
    ": connected\n\n"
  );
  await reader.cancel();
  assert.equal(ended, 1);
});

test("billing event stream fails closed if a durable row crosses scope", async (context) => {
  const { createBillingAccountEventsGetHandler } = await loadRoute();
  const logged = context.mock.method(console, "error", () => {});
  let ended = 0;
  const handler = createBillingAccountEventsGetHandler({
    requireUserId: async () => "user-1",
    resolveProductResourceScope: async () => personalScopeResolution,
    getOrCreateBillingAccount: async () => account,
    createListener: async () => createMockListener(() => (ended += 1)),
    loadEventsAfter: async () => [eventRow(1, { account_id: "account-other" })],
  });

  const response = await handler(
    new Request("https://example.com/api/billing/capacity/events?after=0")
  );
  const reader = response.body!.getReader();
  await reader.read();
  const closed = await reader.read();
  assert.equal(closed.done, true);
  assert.equal(ended, 1);
  assert.equal(logged.mock.callCount(), 1);
});
