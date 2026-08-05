import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

async function loadLedger() {
  return import("../../lib/billing/ledger");
}

test("ledger entries use the account-serialized RPC", async () => {
  const { postLedgerEntry } = await loadLedger();
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: true, error: null };
    },
  } as unknown as SupabaseClient;

  assert.deepEqual(
    await postLedgerEntry(
      {
        accountId: "acct-1",
        deltaCents: 2500,
        bucket: "purchased",
        kind: "topup",
        sourceRef: "topup:pi_1",
        metadata: { payment_intent: "pi_1" },
      },
      client
    ),
    { posted: true }
  );
  assert.equal(calls[0]?.name, "post_credit_ledger_entry");
  assert.equal(calls[0]?.args.p_account, "acct-1");
  assert.equal(calls[0]?.args.p_delta, 2500);
});

test("usage debits use the atomic bucket-burning RPC", async () => {
  const { postBillingUsageDebit } = await loadLedger();
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return {
        data: [
          {
            posted: true,
            debited_cents: "125",
            included_debited_cents: "75",
            purchased_debited_cents: "50",
          },
        ],
        error: null,
      };
    },
  };

  const result = await postBillingUsageDebit(
    {
      accountId: "account-1",
      amountCents: 125,
      kind: "usage_tokens",
      sourceRef: "tok:call-1",
      period: "2026-08",
      metadata: { ai_call_id: "call-1" },
    },
    client as never
  );

  assert.deepEqual(result, {
    posted: true,
    debitedCents: 125,
    includedDebitedCents: 75,
    purchasedDebitedCents: 50,
  });
  assert.deepEqual(calls, [
    {
      name: "post_billing_usage_debit",
      args: {
        p_account: "account-1",
        p_amount: 125,
        p_kind: "usage_tokens",
        p_source_ref: "tok:call-1",
        p_period: "2026-08",
        p_metadata: { ai_call_id: "call-1" },
      },
    },
  ]);
});

test("usage debits reject non-positive or fractional cents", async () => {
  const { postBillingUsageDebit } = await loadLedger();
  const client = {
    rpc: async () => {
      throw new Error("rpc should not be called");
    },
  };

  for (const amountCents of [0, -1, 1.5]) {
    await assert.rejects(
      postBillingUsageDebit(
        {
          accountId: "account-1",
          amountCents,
          kind: "usage_tokens",
          sourceRef: "tok:call-1",
          period: "2026-08",
        },
        client as never
      ),
      /positive integer cents/
    );
  }
});

test("period grants use one atomic grant-and-expiry RPC", async () => {
  const { postBillingPeriodGrant } = await loadLedger();
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return {
        data: { posted: true, expired_cents: 350 },
        error: null,
      };
    },
  } as unknown as SupabaseClient;

  assert.deepEqual(
    await postBillingPeriodGrant(
      {
        accountId: "acct-1",
        deltaCents: 2000,
        grantSourceRef: "grant:acct-1:2026-08:sub_1",
        expirySourceRef: "grantexp:acct-1:2026-08:sub_1",
        period: "2026-08",
        metadata: { invoice: "in_1" },
      },
      client
    ),
    { posted: true, expiredCents: 350 }
  );
  assert.equal(calls[0]?.name, "post_billing_period_grant");
});

test("cancellation expiry uses one account-serialized RPC", async () => {
  const { expireIncludedCredit } = await loadLedger();
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: 4200, error: null };
    },
  } as unknown as SupabaseClient;

  assert.equal(
    await expireIncludedCredit(
      {
        accountId: "acct-1",
        sourceRef: "grantexp:acct-1:cancel:sub_1",
      },
      client
    ),
    4200
  );
  assert.deepEqual(calls, [
    {
      name: "expire_billing_included_credit",
      args: {
        p_account: "acct-1",
        p_source_ref: "grantexp:acct-1:cancel:sub_1",
      },
    },
  ]);
});
