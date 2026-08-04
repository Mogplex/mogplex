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
