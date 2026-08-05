import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizeSandboxBillingClose,
  prepareSandboxBillingClose,
  presentSandboxBillingAdmissionError,
  readSandboxProviderSession,
  SandboxBillingAdmissionError,
  SANDBOX_BILLING_UNAVAILABLE_MESSAGE,
  syncSandboxBillingSession,
  type ActiveSandboxBillingSession,
} from "@/lib/billing/sandbox-usage";

const STARTED_AT = new Date("2026-08-05T10:00:00.000Z");

function sandbox(sessionId = "provider-session-1", startedAt = STARTED_AT) {
  return {
    name: "provider-sandbox-1",
    currentSession: () => ({
      sessionId,
      status: "running",
      createdAt: startedAt,
      startedAt,
      stoppedAt: undefined,
      updatedAt: startedAt,
    }),
  } as never;
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: "sandbox-record-1",
    sandbox_id: "provider-sandbox-1",
    billing_source: "platform",
    actor_user_id: "actor-1",
    user_id: "owner-1",
    product_team_id: null,
    ...overrides,
  };
}

function active(
  overrides: Partial<ActiveSandboxBillingSession> = {}
): ActiveSandboxBillingSession {
  return {
    id: "billing-session-1",
    sandbox_record_id: "sandbox-record-1",
    vercel_sandbox_id: "provider-sandbox-1",
    vercel_session_id: "provider-session-1",
    account_id: "account-1",
    actor_user_id: "actor-1",
    product_team_id: null,
    state: "open",
    started_at: STARTED_AT.toISOString(),
    metered_through_at: STARTED_AT.toISOString(),
    close_generation: 0,
    close_requested_at: null,
    ...overrides,
  };
}

function baseDeps() {
  return {
    isBillingEnabled: () => true,
    loadExplicitPlatformAccess: async () => ({
      allowPlatformAi: false,
      allowPlatformSandbox: false,
    }),
    findBillingAccountForScope: async () => ({
      id: "account-1",
      owner_type: "user" as const,
      owner_user_id: "actor-1",
      product_team_id: null,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      tier: "free" as const,
      period_anchor: null,
      subscription_checkout_generation: 0,
      status: "active" as const,
    }),
    loadActiveSession: async () => null,
    openSession: async () => "billing-session-new",
    requestClose: async () => 1,
    finalizeMetered: async () => ({ accrued: true, debitedCents: 1 }),
    finalizeUnmetered: async () => true,
    reopen: async () => true,
  };
}

test("readSandboxProviderSession uses the provider start and identifiers", () => {
  assert.deepEqual(readSandboxProviderSession(sandbox()), {
    sessionId: "provider-session-1",
    status: "running",
    startedAt: STARTED_AT,
    stoppedAt: null,
    updatedAt: STARTED_AT,
  });
});

test("metering failures expose a generic 503 message", () => {
  const presented = presentSandboxBillingAdmissionError(
    new SandboxBillingAdmissionError(
      "sandbox record private-id provider id mismatch",
      "metering_failed"
    )
  );

  assert.deepEqual(presented, {
    status: 503,
    message: SANDBOX_BILLING_UNAVAILABLE_MESSAGE,
  });
});

test("syncSandboxBillingSession opens a funded platform provider session", async () => {
  const opened: unknown[] = [];
  const scopes: unknown[] = [];
  const result = await syncSandboxBillingSession(
    { record: record(), sandbox: sandbox() },
    {
      ...baseDeps(),
      findBillingAccountForScope: async (scope) => {
        scopes.push(scope);
        return { ...(await baseDeps().findBillingAccountForScope()), id: "a" };
      },
      openSession: async (input) => {
        opened.push(input);
        return "meter-1";
      },
    }
  );

  assert.deepEqual(scopes, [
    { kind: "personal", userId: "actor-1", productTeamId: null },
  ]);
  assert.deepEqual(opened, [
    {
      sandboxRecordId: "sandbox-record-1",
      vercelSandboxId: "provider-sandbox-1",
      vercelSessionId: "provider-session-1",
      accountId: "a",
      actorUserId: "actor-1",
      productTeamId: null,
      startedAt: STARTED_AT,
    },
  ]);
  assert.deepEqual(result, {
    metered: true,
    reason: "opened",
    sessionId: "meter-1",
  });
});

test("syncSandboxBillingSession resolves team billing from frozen product scope", async () => {
  const scopes: unknown[] = [];
  await syncSandboxBillingSession(
    {
      record: record({ product_team_id: "team-1" }),
      sandbox: sandbox(),
    },
    {
      ...baseDeps(),
      findBillingAccountForScope: async (scope) => {
        scopes.push(scope);
        return {
          ...(await baseDeps().findBillingAccountForScope()),
          id: "team-account",
          owner_type: "team",
          owner_user_id: null,
          product_team_id: "team-1",
          tier: "team",
        };
      },
    }
  );
  assert.deepEqual(scopes, [
    { kind: "team", userId: "actor-1", productTeamId: "team-1" },
  ]);
});

test("syncSandboxBillingSession never opens for disabled, allowlisted, BYO, or missing-account compute", async () => {
  const cases = [
    {
      expected: "billing_disabled",
      record: record(),
      deps: { isBillingEnabled: () => false },
    },
    {
      expected: "allowlisted",
      record: record(),
      deps: {
        loadExplicitPlatformAccess: async () => ({
          allowPlatformAi: false,
          allowPlatformSandbox: true,
        }),
      },
    },
    {
      expected: "not_platform_billed",
      record: record({ billing_source: "user_vercel_project" }),
      deps: {},
    },
    {
      expected: "no_billing_account",
      record: record(),
      deps: { findBillingAccountForScope: async () => null },
    },
  ];
  for (const entry of cases) {
    let opened = false;
    const result = await syncSandboxBillingSession(
      { record: entry.record, sandbox: sandbox() },
      {
        ...baseDeps(),
        ...entry.deps,
        openSession: async () => {
          opened = true;
          return "unexpected";
        },
      }
    );
    assert.equal(result.reason, entry.expected);
    assert.equal(opened, false);
  }
});

test("syncSandboxBillingSession is idempotent for the current provider session", async () => {
  let opened = false;
  const result = await syncSandboxBillingSession(
    { record: record(), sandbox: sandbox() },
    {
      ...baseDeps(),
      loadActiveSession: async () => active(),
      openSession: async () => {
        opened = true;
        return "unexpected";
      },
    }
  );
  assert.deepEqual(result, {
    metered: true,
    reason: "already_open",
    sessionId: "billing-session-1",
  });
  assert.equal(opened, false);
});

test("syncSandboxBillingSession finalizes a rotated provider session before opening the replacement", async () => {
  const events: unknown[] = [];
  const replacementStartedAt = new Date("2026-08-05T10:05:00.000Z");
  const result = await syncSandboxBillingSession(
    {
      record: record(),
      sandbox: sandbox("provider-session-2", replacementStartedAt),
    },
    {
      ...baseDeps(),
      loadActiveSession: async () =>
        active({ vercel_session_id: "provider-session-1" }),
      requestClose: async (sessionId, requestedAt) => {
        events.push(["close", sessionId, requestedAt]);
        return 3;
      },
      finalizeMetered: async (attempt, endedAt) => {
        events.push(["final", attempt, endedAt]);
        return { accrued: true, debitedCents: 2 };
      },
      openSession: async (input) => {
        events.push(["open", input.vercelSessionId, input.startedAt]);
        return "billing-session-2";
      },
    }
  );
  assert.equal(result.sessionId, "billing-session-2");
  assert.deepEqual(events, [
    ["close", "billing-session-1", replacementStartedAt],
    [
      "final",
      {
        sessionId: "billing-session-1",
        closeGeneration: 3,
        actorUserId: "actor-1",
        meteredThroughAt: STARTED_AT,
      },
      replacementStartedAt,
    ],
    ["open", "provider-session-2", replacementStartedAt],
  ]);
});

test("an allowlist transition does not rewrite an already-open paid session", async () => {
  let finalized = false;
  const result = await syncSandboxBillingSession(
    { record: record(), sandbox: sandbox() },
    {
      ...baseDeps(),
      loadActiveSession: async () => active(),
      loadExplicitPlatformAccess: async () => ({
        allowPlatformAi: true,
        allowPlatformSandbox: true,
      }),
      finalizeUnmetered: async () => {
        finalized = true;
        return true;
      },
    }
  );
  assert.equal(result.reason, "already_open");
  assert.equal(finalized, false);
});

test("an allowlisted actor still meters the frozen paid session at final close", async () => {
  let metered = false;
  const attempt = {
    sessionId: "billing-session-1",
    closeGeneration: 1,
    actorUserId: "actor-1",
    meteredThroughAt: STARTED_AT,
  };
  const result = await finalizeSandboxBillingClose(attempt, STARTED_AT, {
    ...baseDeps(),
    loadExplicitPlatformAccess: async () => ({
      allowPlatformAi: true,
      allowPlatformSandbox: true,
    }),
    finalizeMetered: async () => {
      metered = true;
      return { accrued: true, debitedCents: 1 };
    },
  });
  assert.equal(metered, true);
  assert.deepEqual(result, { finalized: true, metered: true });
});

test("prepare and finalize use one close generation and unmeter when billing is disabled", async () => {
  const prepared = await prepareSandboxBillingClose(
    "sandbox-record-1",
    STARTED_AT,
    {
      ...baseDeps(),
      loadActiveSession: async () => active({ close_generation: 2 }),
      requestClose: async () => 3,
    }
  );
  assert.deepEqual(prepared, {
    sessionId: "billing-session-1",
    closeGeneration: 3,
    actorUserId: "actor-1",
    meteredThroughAt: STARTED_AT,
  });

  let finalAttempt: unknown;
  const result = await finalizeSandboxBillingClose(prepared, STARTED_AT, {
    ...baseDeps(),
    isBillingEnabled: () => false,
    finalizeMetered: async (attempt) => {
      finalAttempt = attempt;
      return { accrued: true, debitedCents: 1 };
    },
  });
  assert.deepEqual(finalAttempt, prepared);
  assert.deepEqual(result, { finalized: true, metered: true });
});

test("a transient billing outage never closes an existing paid session unmetered", async () => {
  let finalized = false;
  const result = await syncSandboxBillingSession(
    { record: record(), sandbox: sandbox() },
    {
      ...baseDeps(),
      isBillingEnabled: () => false,
      loadActiveSession: async () => active(),
      finalizeUnmetered: async () => {
        finalized = true;
        return true;
      },
    }
  );
  assert.equal(result.reason, "already_open");
  assert.equal(finalized, false);
});
